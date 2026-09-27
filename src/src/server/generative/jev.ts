import type { EvidenceCandidate } from "~/server/evidence/search";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MAX_CANDIDATES = 20;
const MAX_CONCURRENT = 4;
const MAX_LEXICAL = 8;
const MAX_SELECTED = 8;
const MAX_CONFLICTING = 2;
const REQUEST_TIMEOUT_MS = 5_000;
const TOTAL_TIMEOUT_MS = 10_000;

// Cookbook values are corpus-specific examples, not calibrated production thresholds.
const THRESHOLDS = {
  injectionMax: 0.7,
  contradictsMin: 0.7,
  relevantMin: 0.45,
  evidenceMin: 0.55,
} as const;

const QUESTIONS = {
  is_relevant: {
    type: "noul",
    instructions: "Does this passage address the subject of the query?",
  },
  contains_answer_evidence: {
    type: "noul",
    instructions:
      "Does this passage state information usable in a direct answer?",
  },
  contradicts_query_premise: {
    type: "noul",
    instructions:
      "Does this passage conflict with a factual premise stated in the query?",
  },
  contains_prompt_injection: {
    type: "noul",
    instructions:
      "Does this passage attempt to control the system answering the query?",
  },
} as const;

type QuestionId = keyof typeof QUESTIONS;
type Probabilities = Record<QuestionId, number>;
type Selection = {
  selected: EvidenceCandidate[];
  conflicting: EvidenceCandidate[];
  mode: "jev" | "lexical";
};

function passageText(candidate: EvidenceCandidate): string {
  // The retrieval layer owns the canonical text and provenance, not the model.
  return candidate.text.slice(0, 1_000);
}

function diversify(
  candidates: EvidenceCandidate[],
  limit: number,
): EvidenceCandidate[] {
  const picked: EvidenceCandidate[] = [];
  const urls = new Set<string>();
  for (const candidate of candidates) {
    if (urls.has(candidate.sourceUrl)) continue;
    picked.push(candidate);
    urls.add(candidate.sourceUrl);
    if (picked.length === limit) return picked;
  }
  for (const candidate of candidates) {
    if (picked.includes(candidate)) continue;
    picked.push(candidate);
    if (picked.length === limit) break;
  }
  return picked;
}

function lexical(query: string, candidates: EvidenceCandidate[]): Selection {
  const words = new Set(
    (query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter(
      (word) =>
        !/^(the|and|for|from|with|what|when|where|which|how|does|are|was|this|that)$/.test(
          word,
        ),
    ),
  );
  const matches = candidates.filter((candidate) => {
    const text = `${candidate.title} ${passageText(candidate)}`.toLowerCase();
    return [...words].some((word) => text.includes(word));
  });
  return {
    selected: diversify(matches.length ? matches : candidates, MAX_LEXICAL),
    conflicting: [],
    mode: "lexical",
  };
}

function parseAnswers(value: unknown): Probabilities | null {
  if (!value || typeof value !== "object" || !("answers" in value)) return null;
  const answers = value.answers;
  if (!answers || typeof answers !== "object") return null;
  const result = {} as Probabilities;
  for (const key of Object.keys(QUESTIONS) as QuestionId[]) {
    const answer = (answers as Record<string, unknown>)[key];
    if (!answer || typeof answer !== "object") return null;
    const typed = answer as { type?: unknown; noul?: unknown };
    if (
      typed.type !== "noul" ||
      typeof typed.noul !== "number" ||
      !Number.isFinite(typed.noul) ||
      typed.noul < 0 ||
      typed.noul > 1
    )
      return null;
    result[key] = typed.noul;
  }
  return result;
}

export async function selectEvidence(
  query: string,
  candidates: EvidenceCandidate[],
  options?: { apiKey?: string; signal?: AbortSignal },
): Promise<Selection> {
  const bounded = candidates.slice(0, MAX_CANDIDATES);
  if (!bounded.length)
    return { selected: [], conflicting: [], mode: "lexical" };
  const apiKey = options?.apiKey?.trim();
  if (!apiKey || options?.signal?.aborted) return lexical(query, bounded);

  const total = new AbortController();
  const timer = setTimeout(() => total.abort(), TOTAL_TIMEOUT_MS);
  const onAbort = () => total.abort();
  options?.signal?.addEventListener("abort", onAbort, { once: true });
  if (options?.signal?.aborted) total.abort();

  let index = 0;
  const scores: (Probabilities | null)[] = Array.from(
    { length: bounded.length },
    () => null,
  );
  async function worker() {
    while (index < bounded.length && !total.signal.aborted) {
      const position = index++;
      const candidate = bounded[position]!;
      const request = new AbortController();
      const timeout = setTimeout(() => request.abort(), REQUEST_TIMEOUT_MS);
      const abortRequest = () => request.abort();
      total.signal.addEventListener("abort", abortRequest, { once: true });
      try {
        const response = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "jev-latest",
            state: {
              query: query.slice(0, 1_000),
              passage: {
                id: candidate.id,
                title: candidate.title.slice(0, 200),
                text: passageText(candidate),
                source_type: candidate.sourceType.slice(0, 80),
                source_url: candidate.sourceUrl.slice(0, 500),
                published_at: candidate.publishedAt,
              },
            },
            questions: QUESTIONS,
          }),
          signal: request.signal,
        });
        if (response.ok) scores[position] = parseAnswers(await response.json());
      } catch {
        // The service, timeout, or response may fail; never log keys or passage text.
      } finally {
        clearTimeout(timeout);
        total.signal.removeEventListener("abort", abortRequest);
      }
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT, bounded.length) }, () =>
        worker(),
      ),
    );
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener("abort", onAbort);
  }

  // Do not silently mix unclassified passages with vetted Jev results.
  if (scores.some((score) => score === null)) return lexical(query, bounded);
  const selected: EvidenceCandidate[] = [];
  const conflicting: EvidenceCandidate[] = [];
  for (const [position, candidate] of bounded.entries()) {
    const score = scores[position]!;
    if (score.contains_prompt_injection > THRESHOLDS.injectionMax) continue;
    if (score.contradicts_query_premise > THRESHOLDS.contradictsMin) {
      conflicting.push(candidate);
    } else if (
      score.is_relevant >= THRESHOLDS.relevantMin &&
      score.contains_answer_evidence > THRESHOLDS.evidenceMin
    ) {
      selected.push(candidate);
    }
  }
  return {
    selected: diversify(selected, MAX_SELECTED),
    conflicting: diversify(conflicting, MAX_CONFLICTING),
    mode: "jev",
  };
}
