import assert from "node:assert/strict";
import test from "node:test";

import {
  parseStoryBundle,
  type StoryBundle,
} from "../../../src/server/data/story-bundle";

const validBundle: StoryBundle = {
  story: {
    id: 7,
    assetKey: "stock:ACME",
    holding: { ticker: "ACME", name: "Acme Corporation" },
    metrics: {
      revenue: {
        label: "Revenue",
        value: 120,
        display: "$120M",
        sourceId: "filing",
        asOf: "2025-09-30T00:00:00Z",
      },
    },
    series: {
      sharePrice: {
        label: "Share price",
        unit: "USD",
        points: [{ date: "2025-09-30", value: 42.5 }],
        sourceId: "filing",
        asOf: "2025-09-30T00:00:00Z",
      },
    },
    events: [
      {
        id: "earnings",
        date: "2025-09-30",
        label: "Quarterly results announced",
        sourceId: "filing",
      },
    ],
    sources: {
      filing: {
        label: "Company filing",
        url: "https://example.com/filing",
        publishedAt: "2025-09-30T12:00:00Z",
        accessedAt: "2025-10-01T12:00:00Z",
      },
    },
  },
};

test("parseStoryBundle accepts sourced metrics, series, and events", () => {
  assert.deepEqual(parseStoryBundle(validBundle), validBundle);
});

test("parseStoryBundle rejects bundles without sourced evidence", () => {
  const empty = structuredClone(validBundle);
  empty.story.metrics = {};
  empty.story.series = {};
  empty.story.events = [];

  assert.throws(() => parseStoryBundle(empty), /at least one sourced metric/);
});

test("parseStoryBundle rejects evidence with an unknown source", () => {
  const missingSource = structuredClone(validBundle);
  missingSource.story.metrics.revenue!.sourceId = "missing";

  assert.throws(() => parseStoryBundle(missingSource), /Missing source missing/);
});

test("parseStoryBundle requires HTTPS source URLs", () => {
  const insecure = structuredClone(validBundle);
  insecure.story.sources.filing!.url = "http://example.com/filing";

  assert.throws(() => parseStoryBundle(insecure));
});

test("parseStoryBundle requires a matching holding ticker", () => {
  const mismatched = structuredClone(validBundle);
  mismatched.story.holding.ticker = "OTHER";

  assert.throws(() => parseStoryBundle(mismatched), /ticker must match/);
});

test("parseStoryBundle rejects invalid dates and non-finite values", () => {
  const invalidDate = structuredClone(validBundle);
  invalidDate.story.series.sharePrice!.points[0]!.date = "2025-13-40";
  assert.throws(() => parseStoryBundle(invalidDate));

  const invalidValue = structuredClone(validBundle);
  invalidValue.story.metrics.revenue!.value = Number.NaN;
  assert.throws(() => parseStoryBundle(invalidValue));
});
