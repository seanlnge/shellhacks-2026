import {
  experimental_composeSpec,
  experimental_createEvaluator,
  type Experimental_CompositionCandidate,
  type Spec,
} from "@json-render/core";

import { catalog } from "~/lib/generative-catalog";
import type { StoryBundle } from "~/server/data/story-bundle";
import type { EvidenceCandidate } from "~/server/evidence/search";
import { signSeed } from "~/server/generative/compose-token";
import { createDirectJevEvaluator } from "~/server/generative/direct-evaluator";

type Story = {
  title: string;
  summary: string;
  sourceUrl: string;
  assetKey: string;
};

function contextualHighlight(sentence: string) {
  const number =
    /(?:[$€£]\s*)?\d[\d,.]*(?:%|\b(?:million|billion|trillion)\b)?/i.exec(
      sentence,
    );
  if (!number || number.index === undefined)
    return sentence.slice(0, 160).trim();
  const precedingWords = [
    ...sentence.slice(0, number.index).matchAll(/[\p{L}]+/gu),
  ];
  const contextStart = precedingWords.at(-2)?.index ?? number.index;
  return sentence.slice(contextStart, number.index + number[0].length).trim();
}

export function compositionCandidates({
  story,
  bundle,
  evidence,
  scope,
  assetKeys,
}: {
  story: Story;
  bundle: StoryBundle | null;
  evidence: EvidenceCandidate[];
  scope: "story" | "portfolio";
  assetKeys?: string[];
}): Experimental_CompositionCandidate[] {
  const candidates: Experimental_CompositionCandidate[] = [];
  const add = (
    id: string,
    description: string,
    type: string,
    props: Record<string, unknown>,
    options: Pick<
      Experimental_CompositionCandidate,
      "root" | "maxUses" | "resource"
    > = { root: false },
  ) =>
    candidates.push({ id, description, element: { type, props }, ...options });
  const title =
    scope === "story" ? story.title.slice(0, 120) : "Portfolio evidence";
  add(
    "deck",
    "Editorial answer to the user's question",
    "Deck",
    { title },
    {
      root: true,
      resource: "page",
    },
  );
  if (scope === "story" && bundle) {
    add(
      "dashboard",
      "Data dashboard using sourced story metrics or series",
      "Dashboard",
      { title, columns: 2 },
      {
        root: true,
        resource: "page",
      },
    );
  }
  add(
    "slide",
    "Editorial slide grouping sourced facts",
    "StorySlide",
    {
      kicker: "Sourced analysis",
      title:
        scope === "story" ? story.title.slice(0, 120) : "Portfolio evidence",
    },
    { root: false, maxUses: 3 },
  );
  if (scope === "story" && bundle) {
    add(
      "section",
      "Dashboard section for sourced metrics and evidence",
      "Section",
      {
        title: "Reported figures",
        span: 2,
      },
      { root: false, maxUses: 3 },
    );
  }
  if (scope === "story") {
    const storySource = Object.entries(bundle?.story.sources ?? {}).find(
      ([, source]) => source.url === story.sourceUrl,
    )?.[0];
    if (storySource && story.summary.trim()) {
      add(
        "story_summary",
        `Story summary from ${storySource}: ${story.summary.slice(0, 200)}`,
        "Summary",
        {
          text: story.summary.slice(0, 1000),
          sourceIds: [storySource],
        },
      );
      add(
        "story_source",
        `Citation for original story ${storySource}`,
        "SourceChips",
        {
          sourceIds: [storySource],
        },
      );
    }
    for (const [index, [key, metric]] of Object.entries(
      bundle?.story.metrics ?? {},
    )
      .slice(0, 12)
      .entries()) {
      add(
        `metric_${index}`,
        `Reported ${metric.label}: ${metric.display}, as of ${metric.asOf}; source ${metric.sourceId}`,
        "BigNumber",
        {
          label: metric.label.slice(0, 80),
          metricRef: key,
        },
      );
    }
    for (const [index, [key, series]] of Object.entries(
      bundle?.story.series ?? {},
    )
      .slice(0, 8)
      .entries()) {
      add(
        `line_${index}`,
        `Trend ${series.label}, ${series.unit}, source ${series.sourceId}`,
        "LineChart",
        {
          title: series.label.slice(0, 100),
          seriesRefs: [key],
        },
        { root: false, resource: `series_${index}` },
      );
      add(
        `bar_${index}`,
        `Comparison ${series.label}, ${series.unit}, source ${series.sourceId}`,
        "BarChart",
        {
          title: series.label.slice(0, 100),
          seriesRefs: [key],
        },
        { root: false, resource: `series_${index}` },
      );
    }
    if (bundle?.story.events.length)
      add(
        "timeline",
        `Dated sourced story events: ${bundle.story.events
          .slice(0, 8)
          .map((event) => `${event.date} ${event.label}`)
          .join("; ")
          .slice(0, 500)}`,
        "Timeline",
        {},
      );
  }
  const ranges = [
    ["1w", "the past week"],
    ["1mo", "the past month"],
    ["3mo", "the past three months"],
    ["1y", "the past year"],
  ] as const;
  for (const assetKey of [...new Set(assetKeys ?? [story.assetKey])]
    .filter((key) => /^stock:[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(key))
    .slice(0, 8)) {
    const symbol = assetKey.slice("stock:".length);
    for (const [range, period] of ranges)
      add(
        `market_${symbol}_${range}`,
        `Historical ${symbol} closing-price chart for ${period}. Fetch actual daily data only if selected; no prices available in this candidate.`,
        "MarketChart",
        { assetKey, range, title: `${symbol} closing price / ${period}` },
        { root: false, resource: `market_${symbol}_${range}` },
      );
  }
  for (const [index, item] of evidence.slice(0, 8).entries()) {
    const excerpt = item.text.trim().slice(0, 600);
    const text = excerpt || item.title.slice(0, 300);
    const description = `${item.assetKey} ${item.sourceType} ${item.publishedAt}: ${item.title.slice(0, 150)}. ${text.slice(0, 200)} (source ${item.id})`;
    const sentence = excerpt
      .split(/(?<=[.!?])\s+/)
      .find((part) => (part.match(/[A-Za-z]{3,}/g)?.length ?? 0) >= 3);
    const highlight = sentence ? contextualHighlight(sentence) : undefined;
    if (highlight && item.title.trim()) {
      add(`evidence_${index}`, description, "HighlightFact", {
        text,
        highlight,
        sourceId: item.id,
        preview: `${item.title.slice(0, 280)} (${item.publishedAt.slice(0, 10)})`,
      });
    }
    add(
      `citation_${index}`,
      `Citation for ${item.title.slice(0, 150)} (source ${item.id})`,
      "SourceChips",
      {
        sourceIds: [item.id],
      },
    );
  }
  return candidates;
}

export function compositionStream(options: {
  candidates: Experimental_CompositionCandidate[];
  question: string;
  apiKey?: string;
  directApiKey?: string;
  signal: AbortSignal;
  seedScope: string;
  seedSecret: string;
  initialSpec?: Spec;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(45_000)]);
  return new ReadableStream({
    async start(controller) {
      let emittedSpec: Spec | null = null;
      let firstPageSent = false;
      const send = (value: object) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      try {
        if (!options.directApiKey && !options.apiKey)
          throw new Error("Jev evaluator not configured");
        const evaluate = options.directApiKey
          ? createDirectJevEvaluator(options.directApiKey)
          : experimental_createEvaluator({
              model: "typesafe-ai/jev",
              apiKey: options.apiKey!,
            });
        for await (const event of experimental_composeSpec({
          catalog,
          candidates: options.candidates,
          prompt: options.question,
          evaluate,
          ...(options.initialSpec ? { initialSpec: options.initialSpec } : {}),
          maxElements: 16,
          maxSteps: 12,
          maxDepth: 4,
          signal,
        })) {
          if (event.type === "step") {
            const root = event.spec.root
              ? event.spec.elements[event.spec.root]
              : undefined;
            const hasFirstPage = !!root?.children?.some((id) => {
              const page = event.spec.elements[id];
              return root.type === "Deck"
                ? page?.type === "StorySlide" && !!page.children?.length
                : root.type === "Dashboard" &&
                    page?.type === "Section" &&
                    !!page.children?.length;
            });
            if (!firstPageSent && !hasFirstPage) continue;
            firstPageSent = true;
            emittedSpec = event.spec;
            send({
              type: "spec",
              spec: event.spec,
              seedToken: signSeed(
                event.spec,
                options.seedScope,
                options.seedSecret,
              ),
            });
          } else {
            if (event.spec && event.spec !== emittedSpec)
              send({
                type: "spec",
                spec: event.spec,
                seedToken: signSeed(
                  event.spec,
                  options.seedScope,
                  options.seedSecret,
                ),
              });
            send({ type: "complete", stopReason: event.stopReason });
          }
        }
      } catch {
        // Keep the last valid snapshot; never expose provider errors or credentials.
        send({
          type: "complete",
          stopReason: signal.aborted ? "interrupted" : "unavailable",
        });
      } finally {
        controller.close();
      }
    },
  });
}
