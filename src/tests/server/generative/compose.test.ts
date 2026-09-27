import assert from "node:assert/strict";
import test from "node:test";

import { experimental_composeSpec } from "@json-render/core";

import { compositionCandidates } from "../../../src/server/generative/compose";
import {
  signSeed,
  verifySeed,
} from "../../../src/server/generative/compose-token";
import type { StoryBundle } from "../../../src/server/data/story-bundle";
import { catalog } from "../../../src/lib/generative-catalog";

const story = {
  title: "Company results",
  summary: "Revenue was reported in the filing.",
  sourceUrl: "https://example.com/filing",
  assetKey: "stock:TEST",
};
const bundle = {
  story: {
    id: 1,
    assetKey: "stock:TEST",
    holding: { ticker: "TEST", name: "Test" },
    metrics: {
      revenue: {
        label: "Revenue",
        display: "$10",
        value: 10,
        asOf: "2026-01-01T00:00:00Z",
        sourceId: "filing",
      },
    },
    series: {},
    events: [],
    sources: {
      filing: {
        label: "Filing",
        url: story.sourceUrl,
        publishedAt: "2026-01-01T00:00:00Z",
        accessedAt: "2026-01-01T00:00:00Z",
      },
    },
  },
} satisfies StoryBundle;
const evidence = [
  {
    id: "evidence1",
    assetKey: story.assetKey,
    text: "Revenue was $10 in the filing.",
    title: "Results",
    sourceUrl: "https://example.com/results",
    sourceType: "filing",
    publishedAt: "2026-01-01T00:00:00Z",
    score: 1,
  },
];

void test("only story scope offers original story metrics and sourced facts", () => {
  const storyCandidates = compositionCandidates({
    story,
    bundle,
    evidence,
    scope: "story",
  });
  assert.ok(
    storyCandidates.some((candidate) => candidate.element.type === "Dashboard"),
  );
  assert.deepEqual(
    storyCandidates.find((candidate) => candidate.id === "metric_0")?.element
      .props,
    {
      label: "Revenue",
      metricRef: "revenue",
    },
  );
  assert.deepEqual(
    storyCandidates.find((candidate) => candidate.id === "evidence_0")?.element
      .props,
    {
      text: evidence[0]!.text,
      highlight: "Revenue was $10",
      sourceId: "evidence1",
      preview: "Results (2026-01-01)",
    },
  );
  const portfolioCandidates = compositionCandidates({
    story,
    bundle,
    evidence,
    scope: "portfolio",
  });
  assert.equal(
    portfolioCandidates.some(
      (candidate) =>
        candidate.id === "metric_0" || candidate.id === "story_summary",
    ),
    false,
  );
  assert.ok(
    portfolioCandidates.some((candidate) => candidate.id === "evidence_0"),
  );
});

void test("date-only evidence is not offered as a highlighted fact", () => {
  const candidates = compositionCandidates({
    story,
    bundle: null,
    evidence: [{ ...evidence[0]!, text: "2026-09-25." }],
    scope: "portfolio",
  });
  assert.equal(
    candidates.some((candidate) => candidate.element.type === "HighlightFact"),
    false,
  );
});

void test("question-relevant metrics and series outrank bundle insertion order", () => {
  const metrics = Object.fromEntries(
    Array.from({ length: 14 }, (_, i) => [
      `metric_${i}`,
      {
        label: `Unrelated ${i}`,
        display: "$1",
        value: 1,
        asOf: "2026-01-01T00:00:00Z",
        sourceId: "filing",
      },
    ]),
  );
  metrics.revenue = {
    label: "Revenue",
    display: "$10",
    value: 10,
    asOf: "2026-01-01T00:00:00Z",
    sourceId: "filing",
  };
  const candidates = compositionCandidates({
    story,
    bundle: { story: { ...bundle.story, metrics } },
    evidence: [],
    scope: "story",
    question: "How did revenue change?",
  });
  assert.equal(
    candidates.find((candidate) => candidate.id === "metric_0")?.element.props
      .metricRef,
    "revenue",
  );
});

void test("numeric highlights include their immediate sentence context", () => {
  const candidates = compositionCandidates({
    story,
    bundle: null,
    evidence: [
      {
        ...evidence[0]!,
        text: "Apple stock Monday opened at $273.10 after a volatile session.",
      },
    ],
    scope: "portfolio",
  });
  const fact = candidates.find(
    (candidate) => candidate.element.type === "HighlightFact",
  );
  assert.equal(fact?.element.props.highlight, "opened at $273.10");
});

void test("pinned experimental composer emits a valid full spec from prepared recipes", async () => {
  const candidates = compositionCandidates({
    story,
    bundle,
    evidence,
    scope: "story",
  });
  const events = [];
  for await (const event of experimental_composeSpec({
    catalog,
    candidates,
    prompt: "Describe the filing",
    evaluate: async ({ questions }) => ({
      answers: Object.fromEntries(
        Object.entries(questions).map(([key, question]) => [
          key,
          {
            choice:
              key === "root" && "deck" in question.criteria
                ? "deck"
                : (Object.keys(question.criteria).find(
                    (choice) => choice === "none" || choice === "off",
                  ) ?? Object.keys(question.criteria)[0]!),
          },
        ]),
      ),
    }),
    maxElements: 16,
    maxSteps: 12,
  }))
    events.push(event);
  const final = events.at(-1)!;
  assert.equal(final.type, "complete");
  assert.ok(final.spec);
  assert.equal(catalog.validate(final.spec).success, true);
  assert.equal(
    final.spec.root && final.spec.elements[final.spec.root]?.type,
    "Deck",
  );
});

void test("Expand accepts a signed prior page when current evidence candidates change", async () => {
  const previous = {
    root: "root",
    elements: {
      root: {
        type: "Deck",
        props: { title: "Original title" },
        children: ["fact"],
      },
      fact: {
        type: "HighlightFact",
        props: {
          text: "Sourced earlier finding",
          highlight: "earlier finding",
          sourceId: "evidence1",
          preview: "Earlier filing detail",
        },
        children: [],
      },
    },
  };
  const initialSpec = verifySeed(
    previous,
    signSeed(previous, "1:1:story", "test-secret"),
    "1:1:story",
    "test-secret",
  );
  const candidates = compositionCandidates({
    story,
    bundle,
    evidence: [],
    scope: "story",
  });
  let result = null;
  for await (const event of experimental_composeSpec({
    catalog,
    candidates,
    initialSpec,
    prompt: "Expand this page with another sourced detail",
    evaluate: async ({ questions }) => ({
      answers: Object.fromEntries(
        Object.entries(questions).map(([key, question]) => [
          key,
          {
            choice:
              Object.keys(question.criteria).find(
                (item) => item === "none" || item === "off",
              ) ?? Object.keys(question.criteria)[0]!,
          },
        ]),
      ),
    }),
    maxElements: 16,
    maxSteps: 4,
  }))
    if (event.type === "complete") result = event.spec;
  assert.ok(result);
  assert.equal(catalog.validate(result).success, true);
});

void test("signed seed permits prior page edits but rejects modified facts and wrong scope", () => {
  const candidates = compositionCandidates({
    story,
    bundle,
    evidence,
    scope: "story",
  });
  const deck = candidates.find((candidate) => candidate.id === "deck")!.element;
  const fact = candidates.find(
    (candidate) => candidate.id === "evidence_0",
  )!.element;
  const seed = {
    root: "root",
    elements: {
      root: { ...deck, children: ["fact"] },
      fact: { ...fact, children: [] },
    },
  };
  assert.equal(catalog.validate(seed).success, true);
  const now = 1_700_000_000_000;
  const token = signSeed(seed, "1:1:story", "test-secret", now);
  assert.deepEqual(
    verifySeed(seed, token, "1:1:story", "test-secret", now + 1),
    seed,
  );
  assert.throws(
    () =>
      verifySeed(
        {
          ...seed,
          elements: {
            ...seed.elements,
            fact: {
              ...fact,
              children: [],
              props: { ...fact.props, text: "Invented profit" },
            },
          },
        },
        token,
        "1:1:story",
        "test-secret",
        now + 1,
      ),
    /Invalid initial spec/,
  );
  assert.throws(
    () =>
      verifySeed(
        {
          ...seed,
          elements: {
            ...seed.elements,
            hidden: { ...fact, children: [] },
          },
        },
        token,
        "1:1:story",
        "test-secret",
        now + 1,
      ),
    /Invalid initial spec/,
  );
  assert.throws(
    () => verifySeed(seed, token, "2:1:story", "test-secret", now + 1),
    /Invalid initial spec/,
  );
  assert.throws(
    () => verifySeed(seed, token, "1:1:story", "test-secret", now + 3_600_001),
    /Invalid initial spec/,
  );
});
