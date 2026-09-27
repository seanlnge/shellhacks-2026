import "dotenv/config";

import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { eq } from "drizzle-orm";
import {
  documentChunks,
  financialFacts,
  ingestionRuns,
  priceBars,
  sourceDocuments,
  sourceOriginals,
} from "../db/schema";

type Row = Record<string, unknown>;
const object = (v: unknown): Row => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Expected object");
  return v as Row;
};
const array = (v: unknown): unknown[] => {
  if (!Array.isArray(v)) throw new Error("Expected array");
  return v;
};
const string = (v: unknown): string => {
  if (typeof v !== "string" || !v.trim())
    throw new Error("Expected nonempty string");
  return v;
};
const date = (v: unknown): string => {
  const value = string(v);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw new Error(`Invalid date: ${value}`);
  return value;
};
const instant = (v: unknown): Date => {
  const value = string(v);
  const parsed = new Date(value);
  if (
    !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    Number.isNaN(parsed.getTime())
  )
    throw new Error(`Invalid timestamp: ${value}`);
  return parsed;
};
const digest = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
const hash = (v: unknown) => {
  const value = string(v);
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid SHA-256");
  return value;
};
const symbol = (v: unknown) => {
  const value = string(v);
  if (!/^[A-Z0-9^][A-Z0-9.^-]{0,31}$/.test(value))
    throw new Error(`Invalid symbol: ${value}`);
  return value;
};
const url = (v: unknown, host?: string) => {
  const value = string(v);
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (host && parsed.hostname !== host)
  )
    throw new Error(`Invalid source URL: ${value}`);
  return value;
};
const number = (v: unknown, nullable = false): string | null => {
  if (v == null && nullable) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) >= 1e23)
    throw new Error("Invalid numeric value");
  return String(v);
};
const optional = (v: unknown) => (v == null ? null : string(v));
const id = (...parts: string[]) => digest(parts.join("\0"));

async function safeFile(root: string, relative: string): Promise<Buffer> {
  if (
    !/^[A-Za-z0-9_./^-]+$/.test(relative) ||
    relative.includes("..") ||
    relative.startsWith("/") ||
    relative.includes("\\")
  )
    throw new Error(`Unsafe snapshot path: ${relative}`);
  const path = resolve(root, relative);
  const actual = await realpath(path);
  if (!actual.startsWith(root + sep))
    throw new Error(`Snapshot path escapes root: ${relative}`);
  return readFile(actual);
}
async function json(root: string, relative: string): Promise<Row> {
  return object(
    JSON.parse((await safeFile(root, relative)).toString("utf8")) as unknown,
  );
}

export async function loadSnapshot(
  path: string,
  options: { allowArticleContent?: boolean } = {},
) {
  const root = await realpath(resolve(path));
  const companyManifest = await json(root, "companies/manifest.json");
  const manifestCompanies = object(companyManifest.companies);
  let historyFile = "price_history.json";
  try {
    await realpath(join(root, historyFile));
  } catch {
    historyFile = "weekly_market_data.json";
  }
  const history = await json(root, historyFile);
  const sec = await json(root, "sec_documents/manifest.json");
  const documents: (typeof sourceDocuments.$inferInsert)[] = [];
  const chunks: (typeof documentChunks.$inferInsert)[] = [];
  const originals: (typeof sourceOriginals.$inferInsert)[] = [];
  const bars: (typeof priceBars.$inferInsert)[] = [];
  const facts: (typeof financialFacts.$inferInsert)[] = [];
  const errors: string[] = [];
  const files: string[] = [
    "companies/manifest.json",
    historyFile,
    "sec_documents/manifest.json",
  ];
  const assets = object(history.assets);
  const fetchedPrices = instant(history.retrieved_at_utc);
  if (string(history.source) !== "Yahoo Finance public chart endpoint")
    throw new Error("Unsupported price provider");
  const range = object(history.date_range_utc);
  const rangeStart = date(range.start),
    rangeEnd = date(range.end);
  const seenBars = new Set<string>();
  for (const [group, entries] of Object.entries(assets)) {
    if (!/^[a-z_]+$/.test(group)) throw new Error("Invalid asset group");
    for (const raw of array(entries)) {
      const asset = object(raw),
        ticker = symbol(asset.symbol);
      const assetKey = `stock:${ticker}`;
      const unit = string(asset.unit);
      if (
        !["price", "index points", "yield percent (Yahoo ^TNX quote)"].includes(
          unit,
        )
      )
        throw new Error(`Invalid price unit: ${unit}`);
      const currency = optional(asset.currency);
      if (currency && !/^[A-Z]{3}$/.test(currency))
        throw new Error("Invalid currency");
      for (const rawBar of array(asset.daily)) {
        const bar = object(rawBar),
          day = date(bar.date);
        if (day < rangeStart || day > rangeEnd)
          throw new Error("Bar outside history range");
        const key = `${assetKey}:${day}`;
        if (seenBars.has(key)) throw new Error(`Duplicate bar: ${key}`);
        seenBars.add(key);
        const volume = bar.volume == null ? null : bar.volume;
        if (
          volume !== null &&
          (typeof volume !== "number" ||
            !Number.isSafeInteger(volume) ||
            volume < 0)
        )
          throw new Error("Invalid volume");
        bars.push({
          assetKey,
          date: day,
          provider: "Yahoo Finance",
          open: number(bar.open, true),
          high: number(bar.high, true),
          low: number(bar.low, true),
          close: number(bar.close)!,
          adjustedClose: number(bar.adjusted_close, true),
          volume,
          currency,
          unit,
          sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/history`,
          fetchedAt: fetchedPrices,
        });
      }
    }
  }
  for (const entry of array(history.errors ?? []))
    errors.push(JSON.stringify(object(entry)));
  const seenDocuments = new Set<string>();
  for (const ticker of Object.keys(manifestCompanies)) {
    symbol(ticker);
    const expected = object(manifestCompanies[ticker]);
    const filename = `companies/${ticker}.json`;
    files.push(filename);
    const company = await json(root, filename);
    if (symbol(company.symbol) !== ticker)
      throw new Error(`Company symbol mismatch: ${filename}`);
    const fetchedAt = instant(company.retrieved_at_utc);
    const unavailable = object(company.unavailable ?? {});
    for (const [source, reason] of Object.entries(unavailable))
      errors.push(`${ticker}/${source}: ${string(reason)}`);
    for (const raw of array(company.news)) {
      const item = object(raw),
        sourceUrl = url(item.url),
        title = string(item.title);
      const provider =
        optional(item.provider) ??
        (new URL(sourceUrl).hostname === "news.google.com"
          ? "Google News RSS"
          : string(company.news_source).includes("Finnhub")
            ? "Finnhub"
            : "Google News RSS");
      const providerId =
        (typeof item.provider_id === "number" &&
        Number.isSafeInteger(item.provider_id) &&
        item.provider_id >= 0
          ? String(item.provider_id)
          : optional(item.provider_id)) ?? sourceUrl;
      const content = optional(item.content)?.trim() ?? "";
      const summary = optional(item.summary)?.trim() ?? "";
      const retained = !!content && !!options.allowArticleContent;
      const text = retained ? content : summary || title;
      const contentScope = retained
        ? "provider article content"
        : summary
          ? "headline and publisher abstract"
          : "headline only";
      const docId = id(`stock:${ticker}`, provider, providerId);
      if (seenDocuments.has(docId))
        throw new Error(`Duplicate article: ${docId}`);
      seenDocuments.add(docId);
      documents.push({
        id: docId,
        assetKey: `stock:${ticker}`,
        provider,
        providerId,
        sourceUrl,
        type: "news",
        title,
        text,
        contentScope,
        contentHash: digest(text),
        originalStatus: content
          ? retained
            ? "retained text only"
            : "retention not permitted"
          : "not supplied",
        licensePolicy: retained
          ? "Article retention explicitly permitted by importer operator"
          : "Headline/abstract only; article body not retained",
        publishedAt: instant(item.published_at_utc),
        fetchedAt,
      });
    }
    if (expected.news !== array(company.news).length) {
      throw new Error(`Company news count mismatch: ${ticker}`);
    }
    if (company.financials != null) {
      const financials = object(company.financials);
      const sourceUrl = url(financials.source, "data.sec.gov");
      const historyFacts = financials.historical_facts
        ? object(financials.historical_facts)
        : Object.fromEntries(
            Object.entries(object(financials.latest_reported_facts ?? {})).map(
              ([tag, fact]) => [tag, [fact]],
            ),
          );
      for (const [tag, rows] of Object.entries(historyFacts)) {
        if (!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(tag))
          throw new Error(`Invalid fact tag: ${tag}`);
        for (const raw of array(rows)) {
          const fact = object(raw),
            unit = string(fact.unit);
          if (!/^(?:[A-Z]{3}|shares|pure|[A-Z]{3}\/shares)$/.test(unit))
            throw new Error(`Invalid fact unit: ${unit}`);
          const accession = string(fact.accn),
            periodEnd = date(fact.end),
            periodStart = fact.start == null ? null : date(fact.start);
          if (periodStart && periodStart > periodEnd)
            throw new Error("Invalid fact period");
          const filedAt = date(fact.filed),
            form = string(fact.form),
            value = number(fact.val)!;
          if (
            !/^(10-K|10-Q)$/.test(form) ||
            !/^[A-Za-z0-9-]{1,32}$/.test(accession)
          )
            throw new Error("Invalid SEC fact identity");
          const fiscalYear = fact.fy == null ? null : fact.fy;
          if (
            fiscalYear !== null &&
            (typeof fiscalYear !== "number" || !Number.isInteger(fiscalYear))
          )
            throw new Error("Invalid fiscal year");
          const fiscalPeriod = optional(fact.fp),
            frame = optional(fact.frame);
          facts.push({
            id: id(
              `stock:${ticker}`,
              tag,
              unit,
              accession,
              periodStart ?? "",
              periodEnd,
              value,
            ),
            assetKey: `stock:${ticker}`,
            tag,
            unit,
            value,
            periodStart,
            periodEnd,
            filedAt,
            form,
            accession,
            fiscalYear,
            fiscalPeriod,
            frame,
            sourceUrl,
          });
        }
      }
    }
  }
  const secFetched = instant(sec.retrieved_at_utc);
  for (const raw of array(sec.documents)) {
    const entry = object(raw),
      ticker = symbol(entry.holding),
      sourceUrl = url(entry.source_url, "www.sec.gov");
    if (!new URL(sourceUrl).pathname.startsWith("/Archives/edgar/data/"))
      throw new Error("Invalid SEC archive URL");
    const status = string(entry.status);
    if (status === "unavailable") {
      errors.push(
        `${ticker}/SEC ${sourceUrl}: ${optional(entry.reason) ?? "unavailable"}`,
      );
      continue;
    }
    if (status !== "text cached; not embedded")
      throw new Error(`Unsupported SEC status: ${status}`);
    const providerId = string(entry.document_id);
    if (
      !/^[a-f0-9]{16}$/.test(providerId) ||
      digest(sourceUrl).slice(0, 16) !== providerId
    )
      throw new Error("Invalid SEC document ID");
    const file = `sec_documents/${ticker}-${providerId}.json`;
    if (entry.path !== file) throw new Error("SEC manifest path mismatch");
    files.push(file);
    const document = await json(root, file);
    if (
      document.document_id !== providerId ||
      document.source_url !== sourceUrl
    )
      throw new Error("SEC document provenance mismatch");
    const text = string(document.text),
      contentHash = hash(document.text_sha256);
    if (digest(text) !== contentHash)
      throw new Error(`SEC text hash mismatch: ${file}`);
    let originalStatus = "original unavailable in snapshot",
      originalHash: string | null = null;
    if (entry.original_path != null || document.original_path != null) {
      const originalPath = `sec_documents/${ticker}-${providerId}.source`;
      if (
        entry.original_path !== originalPath ||
        document.original_path !== originalPath
      )
        throw new Error("SEC original path mismatch");
      originalHash = hash(entry.original_sha256);
      if (originalHash !== hash(document.original_sha256))
        throw new Error("SEC original hash metadata mismatch");
      const bytes = await safeFile(root, originalPath);
      if (digest(bytes) !== originalHash)
        throw new Error(`SEC original hash mismatch: ${originalPath}`);
      if (process.env.INGESTION_RESTRICTED_ORIGINALS === "database")
        originals.push({
          documentId: id(`stock:${ticker}`, "SEC", providerId),
          bytes,
        });
      else
        errors.push(
          `${ticker}/SEC ${sourceUrl}: original verified but restricted database storage not configured`,
        );
      files.push(originalPath);
      originalStatus =
        process.env.INGESTION_RESTRICTED_ORIGINALS === "database"
          ? "stored in restricted DB table"
          : "restricted storage unavailable";
    } else
      errors.push(
        `${ticker}/SEC ${sourceUrl}: original unavailable in snapshot`,
      );
    const docId = id(`stock:${ticker}`, "SEC", providerId);
    if (seenDocuments.has(docId)) throw new Error("Duplicate SEC document");
    seenDocuments.add(docId);
    documents.push({
      id: docId,
      assetKey: `stock:${ticker}`,
      provider: "SEC",
      providerId,
      sourceUrl,
      type: "filing",
      title: `${ticker} SEC Form ${string(entry.form)} filed ${date(entry.filed_at)}`,
      text,
      contentScope: "extracted SEC visible text",
      contentHash,
      originalHash,
      originalStatus,
      licensePolicy:
        "Public SEC filing; original access restricted to holdings",
      publishedAt: new Date(`${date(entry.filed_at)}T00:00:00Z`),
      fetchedAt: secFetched,
    });
    const rows = array(document.chunks);
    if (rows.length !== entry.chunks)
      throw new Error("SEC chunk count mismatch");
    for (const [ordinal, rawChunk] of rows.entries()) {
      const chunk = object(rawChunk),
        startOffset = chunk.start,
        endOffset = chunk.end;
      if (
        chunk.index !== ordinal ||
        typeof startOffset !== "number" ||
        typeof endOffset !== "number" ||
        !Number.isInteger(startOffset) ||
        !Number.isInteger(endOffset) ||
        startOffset < 0 ||
        endOffset > text.length ||
        startOffset >= endOffset ||
        chunk.text !== text.slice(startOffset, endOffset)
      )
        throw new Error("SEC chunk offsets/text mismatch");
      chunks.push({
        documentId: docId,
        ordinal,
        startOffset,
        endOffset,
        text: string(chunk.text),
      });
    }
  }
  const snapshotHash = digest(
    (
      await Promise.all(
        files
          .sort()
          .map(async (file) => `${file}:${digest(await safeFile(root, file))}`),
      )
    ).join("\n"),
  );
  return {
    documents,
    chunks,
    originals,
    bars,
    facts,
    errors,
    snapshotHash,
    coverage: {
      snapshot: basename(root),
      assets: Object.keys(manifestCompanies),
      priceRange: { start: rangeStart, end: rangeEnd },
      priceFetchedAt: fetchedPrices.toISOString(),
      secFetchedAt: secFetched.toISOString(),
      unavailable: errors,
    },
    counts: {
      documents: documents.length,
      chunks: chunks.length,
      originals: originals.length,
      bars: bars.length,
      facts: facts.length,
    },
  };
}

export async function importSnapshot(
  path: string,
  options: { allowArticleContent?: boolean } = {},
) {
  const snapshot = await loadSnapshot(path, options);
  const { db } = await import("../db");
  await db.transaction(async (tx) => {
    await tx
      .insert(ingestionRuns)
      .values({
        id: snapshot.snapshotHash,
        snapshotHash: snapshot.snapshotHash,
        status: "completed",
        completedAt: new Date(),
        coverage: snapshot.coverage,
        counts: snapshot.counts,
        errors: snapshot.errors,
      })
      .onConflictDoUpdate({
        target: ingestionRuns.id,
        set: {
          coverage: snapshot.coverage,
          counts: snapshot.counts,
          errors: snapshot.errors,
        },
      });
    for (const row of snapshot.documents)
      await tx
        .insert(sourceDocuments)
        .values(row)
        .onConflictDoUpdate({
          target: sourceDocuments.id,
          set: {
            title: row.title,
            text: row.text,
            contentScope: row.contentScope,
            contentHash: row.contentHash,
            originalHash: row.originalHash,
            originalStatus: row.originalStatus,
            licensePolicy: row.licensePolicy,
            publishedAt: row.publishedAt,
            fetchedAt: row.fetchedAt,
          },
        });
    for (const row of snapshot.originals)
      await tx
        .insert(sourceOriginals)
        .values(row)
        .onConflictDoUpdate({
          target: sourceOriginals.documentId,
          set: { bytes: row.bytes },
        });
    // A changed filing can produce fewer or differently segmented chunks.
    // Replace the complete set within this transaction so old excerpts cannot survive.
    for (const row of snapshot.documents)
      if (row.type === "filing")
        await tx
          .delete(documentChunks)
          .where(eq(documentChunks.documentId, row.id));
    for (const row of snapshot.chunks)
      await tx
        .insert(documentChunks)
        .values(row)
        .onConflictDoUpdate({
          target: [documentChunks.documentId, documentChunks.ordinal],
          set: {
            startOffset: row.startOffset,
            endOffset: row.endOffset,
            text: row.text,
          },
        });
    for (const row of snapshot.bars)
      await tx
        .insert(priceBars)
        .values(row)
        .onConflictDoUpdate({
          target: [priceBars.assetKey, priceBars.date, priceBars.provider],
          set: {
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.close,
            adjustedClose: row.adjustedClose,
            volume: row.volume,
            currency: row.currency,
            fetchedAt: row.fetchedAt,
          },
        });
    for (const row of snapshot.facts)
      await tx
        .insert(financialFacts)
        .values(row)
        .onConflictDoUpdate({
          target: financialFacts.id,
          set: {
            filedAt: row.filedAt,
            form: row.form,
            fiscalYear: row.fiscalYear,
            fiscalPeriod: row.fiscalPeriod,
            frame: row.frame,
          },
        });
  });
  return snapshot;
}

export async function getHoldingSource(documentId: string) {
  const { auth } = await import("../auth");
  const userId = (await auth())?.user?.id;
  if (!userId) return null;
  const { db } = await import("../db");
  const { portfolios } = await import("../db/schema");
  const holdings = await db
    .select({ holdings: portfolios.holdings })
    .from(portfolios)
    .where(eq(portfolios.userId, userId));
  const [document] = await db
    .select()
    .from(sourceDocuments)
    .where(eq(sourceDocuments.id, documentId));
  if (
    !document ||
    !holdings.some((portfolio) =>
      portfolio.holdings.some(
        (holding) => `${holding.kind}:${holding.symbol}` === document.assetKey,
      ),
    )
  )
    return null;
  const [original] = await db
    .select({ bytes: sourceOriginals.bytes })
    .from(sourceOriginals)
    .where(eq(sourceOriginals.documentId, documentId));
  const excerpts = await db
    .select()
    .from(documentChunks)
    .where(eq(documentChunks.documentId, documentId));
  const originalBytes = original?.bytes ?? null;
  return {
    document,
    original:
      document.originalStatus === "stored in restricted DB table" &&
      originalBytes &&
      document.originalHash === digest(originalBytes)
        ? originalBytes
        : null,
    chunks: excerpts,
  };
}

if (
  process.argv[1]
    ?.replaceAll("\\", "/")
    .endsWith("/ingestion/import-snapshot.ts")
) {
  const path = process.argv[2];
  if (!path) {
    console.error(
      "Usage: npm run ingestion:import -- <snapshot-directory> [--allow-article-content]",
    );
    process.exitCode = 1;
  } else
    try {
      const result = await importSnapshot(join(process.cwd(), path), {
        allowArticleContent: process.argv.includes("--allow-article-content"),
      });
      console.info(
        JSON.stringify(
          {
            counts: result.counts,
            coverage: result.coverage,
            errors: result.errors,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      if (process.env.DATABASE_URL) await (await import("../db")).closeDb();
    }
}
