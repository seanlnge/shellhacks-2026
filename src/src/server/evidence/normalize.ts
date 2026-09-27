import { createHash } from "node:crypto";

export type EvidenceRow = {
  id: string;
  assetKey: string;
  title: string;
  text: string;
  sourceUrl: string;
  sourceType: "news" | "filing";
  contentScope: string;
  publishedAt: Date;
};

export function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function dateUtc(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\d(?:T.*)?$/.test(value))
    return null;
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

export function stableId(...parts: string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function newsRow(
  symbol: string,
  item: Record<string, unknown>,
): EvidenceRow | null {
  const title = typeof item.title === "string" ? item.title.trim() : "";
  const sourceUrl = httpsUrl(item.url);
  const publishedAt = dateUtc(item.published_at_utc);
  if (!/^[A-Z0-9-]{1,16}$/.test(symbol) || !title || !sourceUrl || !publishedAt)
    return null;
  return {
    id: stableId(`stock:${symbol}`, "news", sourceUrl),
    assetKey: `stock:${symbol}`,
    title,
    text: `Content scope: headline only. Headline: ${title}`,
    sourceUrl,
    sourceType: "news",
    contentScope: "headline only",
    publishedAt,
  };
}

// SEC visible-text extraction can include inline XBRL and concatenated numeric cells.
// Retain only prose-like paragraphs; never index raw hidden tags or table debris.
export function filingChunks(text: string): string[] {
  const paragraphs = text
    .replace(/<[^>]*>/g, " ")
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => {
      if (part.length < 90 || part.length > 2500) return false;
      const words = part.match(/[A-Za-z]{3,}/g) ?? [];
      const digits = (part.match(/\d/g) ?? []).length;
      return (
        words.length >= 12 &&
        digits / part.length < 0.18 &&
        !/\b(?:ix:|xbrli:|contextref|schemaref)\b/i.test(part)
      );
    });
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length > 1600) {
      chunks.push(current);
      current = "";
    }
    current += (current ? "\n\n" : "") + paragraph;
  }
  if (current) chunks.push(current);
  return chunks;
}
