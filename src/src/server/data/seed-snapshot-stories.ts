import "dotenv/config";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";

import { db, closeDb } from "~/server/db";
import { stories, storyData } from "~/server/db/schema";
import type { StoryBundle } from "./story-bundle";

type Row = Record<string, any>;
const json = async (path: string): Promise<Row> =>
  JSON.parse(await readFile(path, "utf8")) as Row;

async function seedSnapshotStories(root: string) {
  const [market, companyManifest, secManifest] = await Promise.all([
    json(resolve(root, "weekly_market_data.json")),
    json(resolve(root, "companies/manifest.json")),
    json(resolve(root, "sec_documents/manifest.json")),
  ]);
  const companies = new Map<string, Row>();
  for (const group of Object.values(market.assets) as Row[][])
    for (const asset of group) companies.set(asset.symbol, asset);

  const range = market.date_range_utc as { start: string; end: string };
  const fetchedAt = new Date(market.retrieved_at_utc).toISOString();
  const result: { ticker: string; storyId: number; events: number }[] = [];
  for (const [ticker, coverage] of Object.entries(
    companyManifest.companies as Record<string, Row>,
  )) {
    const asset = companies.get(ticker);
    if (!asset) throw new Error(`Missing market data for ${ticker}`);
    const daily = (asset.daily as Row[]).filter(
      (bar) => bar.close != null && bar.date >= range.start && bar.date <= range.end,
    );
    if (!daily.length) throw new Error(`No daily prices for ${ticker}`);

    const sourceUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/history?window=${range.start}_to_${range.end}`;
    const assetKey = `stock:${ticker}`;
    const publishedAt = new Date(`${range.end}T23:59:59.000Z`);
    const closes = daily.map((bar) => ({
      date: bar.date as string,
      value: Number(bar.adjusted_close ?? bar.close),
    }));
    const first = closes[0]!;
    const last = closes.at(-1)!;
    const changePercent = ((last.value / first.value) - 1) * 100;
    const storyContent = [
      `Market-data snapshot for ${asset.name} (${ticker}) from ${range.start} through ${range.end}.`,
      `The first available adjusted close was ${first.value} on ${first.date}; the last was ${last.value} on ${last.date}, a change of ${changePercent.toFixed(2)}% across the observed bars.`,
      `The collected snapshot contains ${coverage.news} news headlines and ${coverage.filings} SEC filing records. Headlines and filing passages are separately indexed for sourced deep-dive retrieval; headline records are not full article text.`,
    ].join(" ");
    const summary = `${asset.name} (${ticker}) adjusted close changed ${changePercent.toFixed(2)}% across ${daily.length} daily bars from ${range.start} to ${range.end}. Snapshot coverage includes ${coverage.news} headlines and ${coverage.filings} SEC filing records.`;

    const company = await json(resolve(root, `companies/${ticker}.json`));
    const news = (company.news as Row[])
      .filter((item) => typeof item.title === "string" && typeof item.url === "string")
      .slice(0, 5);
    const filings = (secManifest.documents as Row[])
      .filter((item) => item.holding === ticker)
      .slice(0, 5);
    const sources: StoryBundle["story"]["sources"] = {
      market: {
        label: "Yahoo Finance daily price history",
        url: sourceUrl,
        publishedAt: publishedAt.toISOString(),
        accessedAt: fetchedAt,
      },
    };
    const events: StoryBundle["story"]["events"] = [];
    for (const [index, item] of news.entries()) {
      const id = `news_${index + 1}`;
      const date = new Date(item.published_at_utc).toISOString();
      sources[id] = {
        label: typeof item.publisher === "string" ? item.publisher : "News headline",
        url: item.url,
        publishedAt: date,
        accessedAt: fetchedAt,
      };
      events.push({
        id: `${ticker}_news_${index + 1}`,
        date: date.slice(0, 10),
        label: item.title,
        sourceId: id,
      });
    }
    for (const [index, item] of filings.entries()) {
      const id = `filing_${index + 1}`;
      const date = new Date(`${item.filed_at}T00:00:00.000Z`).toISOString();
      sources[id] = {
        label: `SEC Form ${item.form}`,
        url: item.source_url,
        publishedAt: date,
        accessedAt: fetchedAt,
      };
      events.push({
        id: `${ticker}_filing_${index + 1}`,
        date: date.slice(0, 10),
        label: `SEC Form ${item.form} filed`,
        sourceId: id,
      });
    }

    const [existing] = await db
      .select({ id: stories.id })
      .from(stories)
      .where(and(eq(stories.assetKey, assetKey), eq(stories.sourceUrl, sourceUrl)));
    const story = existing
      ? (
          await db
            .update(stories)
            .set({
              title: `${asset.name}: market and company activity (${range.start} to ${range.end})`,
              summary,
              content: storyContent,
              sourceName: "Yahoo Finance and collected company filings/news",
              publishedAt,
            })
            .where(eq(stories.id, existing.id))
            .returning({ id: stories.id })
        )[0]!
      : (
          await db
            .insert(stories)
            .values({
              assetKey,
              title: `${asset.name}: market and company activity (${range.start} to ${range.end})`,
              summary,
              content: storyContent,
              sourceName: "Yahoo Finance and collected company filings/news",
              sourceUrl,
              publishedAt,
            })
            .returning({ id: stories.id })
        )[0]!;

    const bundle: StoryBundle = {
      story: {
        id: story.id,
        assetKey,
        holding: { ticker, name: asset.name },
        metrics: {
          window_return: {
            label: `${ticker} adjusted-close change across snapshot window`,
            value: changePercent,
            display: `${changePercent.toFixed(2)}%`,
            sourceId: "market",
            asOf: publishedAt.toISOString(),
          },
        },
        series: {
          snapshot_close: {
            label: `${ticker} daily adjusted close`,
            unit: asset.currency ?? asset.unit,
            points: closes,
            sourceId: "market",
            asOf: publishedAt.toISOString(),
          },
        },
        events,
        sources,
      },
    };
    await db
      .insert(storyData)
      .values({ storyId: story.id, bundle, importedAt: new Date() })
      .onConflictDoUpdate({
        target: storyData.storyId,
        set: { bundle, importedAt: new Date() },
      });
    result.push({ ticker, storyId: story.id, events: events.length });
  }
  return result;
}

const root = process.argv[2];
if (!root) {
  console.error(
    "Usage: npm run stories:seed -- ../data_aggregation/data/<snapshot>",
  );
  process.exitCode = 1;
} else {
  try {
    console.info(JSON.stringify(await seedSnapshotStories(resolve(root)), null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
