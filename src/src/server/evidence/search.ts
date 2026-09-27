import { sql } from "drizzle-orm";

import { db } from "~/server/db";

export type EvidenceCandidate = {
  id: string;
  assetKey: string;
  title: string;
  text: string;
  sourceUrl: string;
  sourceType: string;
  contentScope?: string;
  publishedAt: string;
  score: number;
};

type SearchRow = Omit<EvidenceCandidate, "publishedAt" | "score"> & {
  publishedAt: Date;
  score: number;
};

export async function retrieveEvidence({
  assetKeys,
  query,
  topic = "",
  limit = 32,
}: {
  assetKeys: string[];
  query: string;
  topic?: string;
  limit?: number;
}): Promise<EvidenceCandidate[]> {
  const keys = [...new Set(assetKeys)].filter((key) =>
    /^(stock|alternative):[A-Za-z0-9._-]{1,32}$/.test(key),
  );
  if (!keys.length) return [];
  const count = Math.max(
    1,
    Math.min(40, Math.floor(Number.isFinite(limit) ? limit : 32)),
  );
  const meaningful = (text: string) =>
    (text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter(
      (term) =>
        !/^(what|which|when|where|with|from|this|that|about|show|tell|explain|across|portfolio|holdings|changed|stock|shares|company)$/.test(
          term,
        ),
    );
  const terms = [
    ...new Set([
      ...meaningful(query).slice(0, 6),
      ...meaningful(topic).slice(0, 8),
    ]),
  ].slice(0, 12);
  const search = terms.join(" OR ");
  // A lexical match is preferred, but fill the shortlist with recent, varied sources
  // when the question has no matching vocabulary (or is empty).
  const result = await db.execute<SearchRow>(sql`
    WITH corpus AS (
      SELECT id, "assetKey", title, text, "sourceUrl", "sourceType", "contentScope", "publishedAt"
      FROM src_evidence WHERE "assetKey" IN ${sql`(${sql.join(
        keys.map((key) => sql`${key}`),
        sql`, `,
      )})`}
      UNION ALL
      SELECT d.id || ':' || c.ordinal::text AS id, d."assetKey", d.title,
        c.text, d."sourceUrl", d.type AS "sourceType", d."contentScope", d."publishedAt"
      FROM src_document_chunk c JOIN src_source_document d ON d.id = c."documentId"
      WHERE d."assetKey" IN ${sql`(${sql.join(
        keys.map((key) => sql`${key}`),
        sql`, `,
      )})`}
      UNION ALL
      SELECT d.id, d."assetKey", d.title, d.text, d."sourceUrl",
        d.type AS "sourceType", d."contentScope", d."publishedAt"
      FROM src_source_document d
      WHERE d."assetKey" IN ${sql`(${sql.join(
        keys.map((key) => sql`${key}`),
        sql`, `,
      )})`}
        AND NOT EXISTS (SELECT 1 FROM src_document_chunk c WHERE c."documentId" = d.id)
    ), matched_scored AS (
      SELECT id, "assetKey", title, text, "sourceUrl", "sourceType", "contentScope", "publishedAt",
        ts_rank_cd(to_tsvector('english', title || ' ' || text), websearch_to_tsquery('english', ${search})) AS score
      FROM corpus
      WHERE to_tsvector('english', title || ' ' || text) @@ websearch_to_tsquery('english', ${search})
    ), matched_ranked AS (
      SELECT *, row_number() OVER (PARTITION BY "assetKey", "sourceUrl" ORDER BY score DESC, "publishedAt" DESC, id) AS document_rank
      FROM matched_scored
    ), matched AS (
      SELECT id, "assetKey", title, text, "sourceUrl", "sourceType", "contentScope", "publishedAt", score
      FROM matched_ranked WHERE document_rank <= 2
      ORDER BY score DESC, "publishedAt" DESC LIMIT ${count * 4}
    ), recent AS (
      SELECT id, "assetKey", title, text, "sourceUrl", "sourceType", "contentScope", "publishedAt", 0::real AS score
      FROM (
        SELECT *, row_number() OVER (PARTITION BY "assetKey", "sourceType" ORDER BY "publishedAt" DESC, id) AS recency_rank
        FROM corpus
      ) recent_rows WHERE recency_rank <= ${Math.max(8, Math.ceil(count / 2))}
    ), ranked AS (
      SELECT *, row_number() OVER (PARTITION BY id ORDER BY score DESC) AS duplicate_rank,
        row_number() OVER (PARTITION BY "assetKey", "sourceType", "sourceUrl" ORDER BY score DESC, "publishedAt" DESC, id) AS source_rank
      FROM (SELECT * FROM matched UNION ALL SELECT * FROM recent) pool
    )
    SELECT id, "assetKey", title, text, "sourceUrl", "sourceType", "contentScope", "publishedAt", score
    FROM ranked WHERE duplicate_rank = 1 AND source_rank <= 3
    ORDER BY (CASE WHEN score > 0 THEN 1 ELSE 0 END) DESC, score DESC,
      "publishedAt" DESC, "assetKey", id
    LIMIT ${count * (keys.length + 4)}
  `);
  const rows = result as unknown as SearchRow[];
  const picked: SearchRow[] = [];
  const used = new Set<string>();
  const usedUrls = new Set<string>();
  // Represent each holding before spending the remaining budget on distinct URLs.
  for (const key of keys) {
    const item = rows.find((row) => row.assetKey === key && row.score > 0);
    if (item && picked.length < count) {
      picked.push(item);
      used.add(item.id);
      usedUrls.add(item.sourceUrl);
    }
  }
  // Spend the remaining budget on independent documents before extra chunks
  // of documents already represented in the result.
  for (const item of rows) {
    if (picked.length >= count) break;
    if (!used.has(item.id) && !usedUrls.has(item.sourceUrl)) {
      picked.push(item);
      used.add(item.id);
      usedUrls.add(item.sourceUrl);
    }
  }
  for (const item of rows) {
    if (picked.length >= count) break;
    if (!used.has(item.id)) {
      picked.push(item);
      used.add(item.id);
    }
  }
  return picked.map((row) => ({
    ...row,
    text: /^(headline|abstract)/i.test(row.contentScope ?? "")
      ? `[${row.contentScope}] ${row.text}`
      : row.text,
    publishedAt: new Date(row.publishedAt).toISOString(),
    score: Number(row.score),
  }));
}
