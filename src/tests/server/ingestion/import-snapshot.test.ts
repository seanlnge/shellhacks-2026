import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { loadSnapshot } from "../../../src/server/ingestion/import-snapshot";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "src-ingestion-"));
  roots.push(root);
  await mkdir(join(root, "companies"));
  await mkdir(join(root, "sec_documents"));
  const save = (file: string, value: unknown) =>
    writeFile(join(root, file), JSON.stringify(value));
  await save("companies/manifest.json", { companies: { AAPL: { news: 2 } } });
  const company = {
    symbol: "AAPL",
    retrieved_at_utc: "2026-09-25T00:00:00Z",
    news_source: "Google News RSS",
    unavailable: {},
    news: [
      {
        title: "Headline",
        url: "https://news.google.com/item",
        published_at_utc: "2026-09-24T00:00:00Z",
      },
      {
        title: "Body",
        url: "https://example.com/body",
        content: "Licensed full article",
        published_at_utc: "2026-09-24T00:00:00Z",
        provider: "NewsData.io",
      },
    ],
    financials: {
      source: "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",
      historical_facts: {
        Revenues: [
          {
            val: 10,
            unit: "USD",
            start: "2026-01-01",
            end: "2026-03-31",
            filed: "2026-04-20",
            form: "10-Q",
            accn: "first",
          },
          {
            val: 12,
            unit: "USD",
            start: "2026-01-01",
            end: "2026-03-31",
            filed: "2026-08-20",
            form: "10-Q",
            accn: "restated",
          },
        ],
      },
    },
  };
  await save("companies/AAPL.json", company);
  await save("price_history.json", {
    source: "Yahoo Finance public chart endpoint",
    retrieved_at_utc: "2026-09-25T00:00:00Z",
    date_range_utc: { start: "2026-01-01", end: "2026-09-25" },
    assets: {
      companies: [
        {
          symbol: "AAPL",
          currency: "USD",
          unit: "price",
          daily: [
            {
              date: "2026-09-24",
              open: 10,
              high: 12,
              low: 9,
              close: 11,
              adjusted_close: 8,
              volume: 100,
            },
          ],
        },
      ],
    },
    errors: [],
  });
  const sourceUrl = "https://www.sec.gov/Archives/edgar/data/320193/filing.htm";
  const documentId = hash(sourceUrl).slice(0, 16);
  const text = "SEC document text";
  const filename = `sec_documents/AAPL-${documentId}.json`;
  const document = {
    document_id: documentId,
    source_url: sourceUrl,
    text,
    text_sha256: hash(text),
    chunks: [{ index: 0, start: 0, end: text.length, text }],
  };
  const entry = {
    holding: "AAPL",
    form: "10-Q",
    filed_at: "2026-09-24",
    source_url: sourceUrl,
    document_id: documentId,
    path: filename,
    status: "text cached; not embedded",
    chunks: 1,
  };
  await save(filename, document);
  await save("sec_documents/manifest.json", {
    retrieved_at_utc: "2026-09-25T00:00:00Z",
    documents: [entry],
  });
  return { root, company, document, entry, save, filename };
}

test("imports history with adjusted close, restatements, scopes, chunks and deterministic identity", async () => {
  const { root } = await fixture();
  const first = await loadSnapshot(root),
    second = await loadSnapshot(root);
  assert.equal(first.snapshotHash, second.snapshotHash);
  assert.deepEqual(first.counts, {
    documents: 3,
    chunks: 1,
    originals: 0,
    bars: 1,
    facts: 2,
  });
  assert.equal(first.bars[0]?.close, "11");
  assert.equal(first.bars[0]?.adjustedClose, "8");
  assert.notEqual(first.facts[0]?.id, first.facts[1]?.id);
  assert.equal(first.documents[0]?.contentScope, "headline only");
  assert.notEqual(first.documents[1]?.text, "Licensed full article");
  const permitted = await loadSnapshot(root, { allowArticleContent: true });
  assert.equal(permitted.documents[1]?.text, "Licensed full article");
});

test("changed article keeps stable identity and updates content hash", async () => {
  const { root, company, save } = await fixture();
  const before = await loadSnapshot(root);
  company.news[0]!.title = "Updated headline";
  await save("companies/AAPL.json", company);
  const after = await loadSnapshot(root);
  assert.equal(after.documents[0]?.id, before.documents[0]?.id);
  assert.notEqual(
    after.documents[0]?.contentHash,
    before.documents[0]?.contentHash,
  );
});

test("rejects corrupted SEC text and escaping original paths", async () => {
  const { root, document, entry, save, filename } = await fixture();
  await save(filename, { ...document, text: "corrupt" });
  await assert.rejects(loadSnapshot(root), /SEC text hash mismatch/);
  await save(filename, { ...document, original_path: "../secret" });
  await save("sec_documents/manifest.json", {
    retrieved_at_utc: "2026-09-25T00:00:00Z",
    documents: [{ ...entry, original_path: "../secret" }],
  });
  await assert.rejects(loadSnapshot(root), /SEC original path mismatch/);
});

test("verifies original hash without claiming restricted durability by default", async () => {
  const { root, document, entry, save, filename } = await fixture();
  const originalPath = filename.replace(/\.json$/, ".source");
  const original_sha256 = hash("original bytes");
  await writeFile(join(root, originalPath), "original bytes");
  await save(filename, {
    ...document,
    original_path: originalPath,
    original_sha256,
  });
  await save("sec_documents/manifest.json", {
    retrieved_at_utc: "2026-09-25T00:00:00Z",
    documents: [{ ...entry, original_path: originalPath, original_sha256 }],
  });
  const result = await loadSnapshot(root);
  assert.equal(result.originals.length, 0);
  assert.equal(
    result.documents[2]?.originalStatus,
    "restricted storage unavailable",
  );
  await writeFile(join(root, originalPath), "tampered");
  await assert.rejects(loadSnapshot(root), /SEC original hash mismatch/);
});
