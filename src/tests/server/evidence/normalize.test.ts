import assert from "node:assert/strict";
import { test } from "node:test";

import { filingChunks, httpsUrl, newsRow } from "../../../src/server/evidence/normalize";

void test("news remains explicitly headline-only and rejects unsafe URLs", () => {
  const item = {
    title: "A real headline",
    url: "https://news.google.com/article/1",
    published_at_utc: "2026-09-25T12:00:00Z",
  };
  assert.match(newsRow("AAPL", item)?.text ?? "", /headline only/);
  assert.equal(
    newsRow("AAPL", { ...item, url: "http://news.google.com/article/1" }),
    null,
  );
  assert.equal(
    httpsUrl("https://user:password@news.google.com/article/1"),
    null,
  );
});

void test("SEC chunks exclude numeric tables and hidden XBRL", () => {
  const prose =
    "The company reported increased demand across its operating segments and discussed the expected outlook for future periods in its quarterly filing.";
  const text = `ix:contextRef ${"123456789 ".repeat(40)}\n\n${prose}\n\n${"123456789 ".repeat(50)}`;
  assert.deepEqual(filingChunks(text), [prose]);
});
