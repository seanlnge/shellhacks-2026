import assert from "node:assert/strict";
import test from "node:test";

import { briefingSpec, generatedCopy } from "../../src/lib/briefing";

const validCopy = {
  title: "Quarterly results",
  subtitle: "Revenue grew while margins narrowed.",
  insights: [
    { heading: "Revenue growth", body: "Revenue increased year over year." },
    { heading: "Margin pressure", body: "Costs grew faster than sales." },
  ],
};

test("generatedCopy accepts one to three concise insights", () => {
  assert.equal(generatedCopy.safeParse(validCopy).success, true);
  assert.equal(
    generatedCopy.safeParse({ ...validCopy, insights: [] }).success,
    false,
  );
  assert.equal(
    generatedCopy.safeParse({
      ...validCopy,
      insights: [...validCopy.insights, ...validCopy.insights.slice(0, 2)],
    }).success,
    false,
  );
});

test("generatedCopy enforces field length limits", () => {
  assert.equal(
    generatedCopy.safeParse({ ...validCopy, title: "t".repeat(121) }).success,
    false,
  );
  assert.equal(
    generatedCopy.safeParse({
      ...validCopy,
      insights: [{ heading: "h".repeat(101), body: "Body" }],
    }).success,
    false,
  );
});

test("briefingSpec builds ordered slides and preserves source attribution", () => {
  const spec = briefingSpec(validCopy, {
    name: "Example News",
    url: "https://example.com/story",
  });

  assert.equal(spec.root, "deck");
  assert.deepEqual(spec.elements.deck.children, [
    "cover",
    "insight-0",
    "insight-1",
    "source",
  ]);
  assert.deepEqual(
    (spec.elements as Record<string, unknown>)["insight-0"],
    {
    type: "Insight",
    props: {
      number: "01",
      heading: "Revenue growth",
      body: "Revenue increased year over year.",
    },
    children: [],
    },
  );
  assert.deepEqual(spec.elements.source.props, {
    label: "Example News",
    url: "https://example.com/story",
  });
});
