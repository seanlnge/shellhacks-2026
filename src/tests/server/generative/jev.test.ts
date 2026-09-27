import assert from "node:assert/strict";
import test from "node:test";

import { selectEvidence } from "../../../src/server/generative/jev";
import type { EvidenceCandidate } from "../../../src/server/evidence/search";

function candidate(id: string): EvidenceCandidate {
  return {
    id,
    assetKey: "stock:AAPL",
    title: `Apple ${id}`,
    text: `Apple revenue ${id}`,
    sourceUrl: `https://example.com/${id}`,
    sourceType: "filing",
    publishedAt: "2025-07-31T00:00:00Z",
    score: 1,
  };
}

function answers(overrides: Record<string, number> = {}) {
  return {
    model: "jev-1.13.0",
    answers: Object.fromEntries(
      Object.entries({
        is_relevant: 0.9,
        contains_answer_evidence: 0.9,
        contradicts_query_premise: 0.1,
        contains_prompt_injection: 0.1,
        ...overrides,
      }).map(([key, noul]) => [key, { type: "noul", noul }]),
    ),
  };
}

void test("Jev routes evidence, conflicts, and injection using only original IDs", async () => {
  const originals = [
    candidate("keep"),
    candidate("conflict"),
    candidate("inject"),
  ];
  const previousFetch = globalThis.fetch;
  const requests: Array<{
    body: Record<string, unknown>;
    authorization: string;
  }> = [];
  globalThis.fetch = async (_input, init) => {
    const requestBody = init?.body;
    if (typeof requestBody !== "string")
      throw new Error("Expected JSON request");
    const body = JSON.parse(requestBody) as {
      state: { passage: { id: string; text: string; source_url: string } };
      model: string;
      questions: Record<string, { type: string }>;
    };
    requests.push({
      body,
      authorization: new Headers(init?.headers).get("Authorization") ?? "",
    });
    assert.equal(body.model, "jev-latest");
    assert.equal(
      body.state.passage.source_url,
      `https://example.com/${body.state.passage.id}`,
    );
    assert.ok(body.state.passage.text.length <= 1_000);
    assert.equal(Object.keys(body.questions).length, 4);
    assert.ok(
      Object.values(body.questions).every(
        (question) => question.type === "noul",
      ),
    );
    const overrides: Record<string, number> =
      body.state.passage.id === "conflict"
        ? { contradicts_query_premise: 0.95 }
        : body.state.passage.id === "inject"
          ? { contradicts_query_premise: 0.95, contains_prompt_injection: 0.98 }
          : {};
    return Response.json({
      ...answers(overrides),
      fabricated_url: "https://attacker.invalid",
    });
  };
  try {
    const result = await selectEvidence("Apple revenue", originals, {
      apiKey: "test-key",
    });
    assert.equal(result.mode, "jev");
    assert.deepEqual(result.selected, [originals[0]]);
    assert.deepEqual(result.conflicting, [originals[1]]);
    assert.equal(result.selected[0], originals[0]);
    assert.equal(requests.length, 3);
    assert.ok(
      requests.every((request) => request.authorization === "Bearer test-key"),
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

void test("missing key returns bounded lexical candidates without calling Jev", async () => {
  const originals = Array.from({ length: 30 }, (_, i) => candidate(String(i)));
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("must not fetch");
  };
  try {
    const result = await selectEvidence("Apple revenue", originals);
    assert.equal(result.mode, "lexical");
    assert.deepEqual(result.selected, originals.slice(0, 8));
    assert.deepEqual(result.conflicting, []);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

void test("lexical selection favors distinct source URLs before extra passages", async () => {
  const originals = Array.from({ length: 12 }, (_, i) => ({
    ...candidate(String(i)),
    sourceUrl: `https://example.com/document-${Math.floor(i / 3)}`,
  }));
  const result = await selectEvidence("Apple revenue", originals);
  assert.equal(result.selected.length, 8);
  assert.deepEqual(
    result.selected.slice(0, 4).map((item) => item.id),
    ["0", "3", "6", "9"],
  );
  assert.equal(new Set(result.selected.map((item) => item.sourceUrl)).size, 4);
});

void test("Jev selection keeps four independent relevant sources in its budget", async () => {
  const originals = Array.from({ length: 12 }, (_, i) => ({
    ...candidate(String(i)),
    sourceUrl: `https://example.com/document-${Math.floor(i / 3)}`,
  }));
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(answers());
  try {
    const result = await selectEvidence("Apple revenue", originals, {
      apiKey: "test-key",
    });
    assert.equal(result.mode, "jev");
    assert.equal(
      new Set(result.selected.map((item) => item.sourceUrl)).size,
      4,
    );
    assert.deepEqual(
      result.selected.slice(0, 4).map((item) => item.id),
      ["0", "3", "6", "9"],
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

void test("bad or unavailable Jev responses fall back instead of claiming Jev", async () => {
  const original = candidate("keep");
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(answers({ is_relevant: 2 }));
  try {
    const result = await selectEvidence("Apple", [original], {
      apiKey: "test-key",
    });
    assert.deepEqual(result, {
      selected: [original],
      conflicting: [],
      mode: "lexical",
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
