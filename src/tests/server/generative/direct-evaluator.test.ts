import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { createDirectJevEvaluator } from "../../../src/server/generative/direct-evaluator";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const request = {
  state: { question: "Which view shows a trend?" },
  questions: {
    layout: {
      type: "choice" as const,
      instructions: "Choose a chart",
      criteria: { line: "Trend", bar: "Categories" },
    },
  },
  signal: new AbortController().signal,
};

test("accepts only offered Jev choices", async () => {
  globalThis.fetch = async (_url, init) => {
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer test-key",
    );
    assert.deepEqual(
      JSON.parse(String(init?.body)).questions,
      request.questions,
    );
    return Response.json({
      answers: { layout: { type: "choice", choice: "line", confidence: 0.91 } },
      usage: { input_tokens: 123 },
    });
  };
  assert.deepEqual(await createDirectJevEvaluator("test-key")(request), {
    answers: { layout: { choice: "line", confidence: 0.91 } },
    usage: { inputTokens: 123 },
  });
});

test("rejects responses that invent candidates", async () => {
  globalThis.fetch = async () =>
    Response.json({
      answers: { layout: { type: "choice", choice: "pie", confidence: 0.99 } },
    });
  await assert.rejects(
    createDirectJevEvaluator("test-key")(request),
    /unoffered choice/,
  );
});
