import "dotenv/config";

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

import { db, closeDb } from "~/server/db";
import { evidence } from "~/server/db/schema";
import {
  dateUtc,
  filingChunks,
  httpsUrl,
  newsRow,
  stableId,
} from "./normalize";

type FilingManifest = {
  holding: string;
  form: string;
  filed_at: string;
  source_url: string;
  document_id: string;
  path: string;
};

async function jsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function importSnapshot(root: string) {
  const counts = { news: 0, filing: 0, rejected: 0 };
  const companies = resolve(root, "companies");
  for (const filename of (await readdir(companies)).filter((name) =>
    /^[A-Z0-9-]+\.json$/.test(name),
  )) {
    const company = object(await jsonFile(resolve(companies, filename)));
    const symbol = company?.symbol;
    if (
      typeof symbol !== "string" ||
      `${symbol}.json` !== filename ||
      !Array.isArray(company?.news)
    ) {
      counts.rejected++;
      continue;
    }
    for (const item of company.news) {
      const row = object(item) && newsRow(symbol, object(item)!);
      if (!row) {
        counts.rejected++;
        console.warn(`Skipped invalid headline in ${filename}`);
        continue;
      }
      await db
        .insert(evidence)
        .values(row)
        .onConflictDoUpdate({
          target: evidence.id,
          set: {
            title: row.title,
            text: row.text,
            publishedAt: row.publishedAt,
            contentScope: row.contentScope,
          },
        });
      counts.news++;
    }
  }

  const manifest = object(
    await jsonFile(resolve(root, "sec_documents", "manifest.json")),
  );
  if (!Array.isArray(manifest?.documents))
    throw new Error("SEC manifest has no documents");
  for (const entry of manifest.documents) {
    const item = object(entry) as FilingManifest | null;
    if (
      !item ||
      !/^[A-Z0-9-]{1,16}$/.test(item.holding) ||
      !/^sec_documents\/[A-Z0-9-]+-[a-f0-9]{16}\.json$/.test(item.path) ||
      !/^[a-f0-9]{16}$/.test(item.document_id) ||
      !/^[A-Z0-9]{1,3}(?:-[A-Z]+)?$/.test(item.form)
    ) {
      counts.rejected++;
      console.warn("Skipped invalid SEC manifest entry");
      continue;
    }
    const url = httpsUrl(item.source_url);
    const date = dateUtc(item.filed_at);
    if (!url || !date || new URL(url).hostname !== "www.sec.gov") {
      counts.rejected++;
      console.warn(`Skipped invalid SEC URL/date: ${item.path}`);
      continue;
    }
    const document = object(await jsonFile(resolve(root, item.path)));
    const text = document?.text;
    if (
      document?.document_id !== item.document_id ||
      document.source_url !== item.source_url ||
      typeof text !== "string" ||
      (typeof document.text_sha256 === "string" &&
        createHash("sha256").update(text).digest("hex") !==
          document.text_sha256)
    ) {
      counts.rejected++;
      console.warn(`Skipped mismatched SEC document: ${item.path}`);
      continue;
    }
    for (const [index, chunk] of filingChunks(text).entries()) {
      const row = {
        id: stableId(item.document_id, String(index), chunk),
        assetKey: `stock:${item.holding}`,
        title: `${item.holding} SEC Form ${item.form} filed ${item.filed_at}`,
        text: `Content scope: excerpt from cached SEC visible text. ${chunk}`,
        sourceUrl: url,
        sourceType: "filing" as const,
        contentScope: "cached SEC visible-text excerpt",
        publishedAt: date,
      };
      await db
        .insert(evidence)
        .values(row)
        .onConflictDoUpdate({
          target: evidence.id,
          set: {
            text: row.text,
            title: row.title,
            publishedAt: row.publishedAt,
          },
        });
      counts.filing++;
    }
  }
  return counts;
}

if (
  process.argv[1]
    ?.replaceAll("\\", "/")
    .endsWith("/evidence/import-snapshot.ts")
) {
  const root = process.argv[2];
  if (!root) {
    console.error(
      "Usage: npm run evidence:import -- ../data_aggregation/data/2026-09-19_to_2026-09-25",
    );
    process.exitCode = 1;
  } else {
    try {
      console.info(await importSnapshot(resolve(root)));
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      await closeDb();
    }
  }
}
