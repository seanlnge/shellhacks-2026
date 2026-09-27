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
  const [market, companyManifest] = await Promise.all([
    json(resolve(root, "weekly_market_data.json")),
    json(resolve(root, "companies/manifest.json")),
  ]);
  const companies = new Map<string, Row>();
  for (const group of Object.values(market.assets) as Row[][])
    for (const asset of group) companies.set(asset.symbol, asset);

  const range = market.date_range_utc as { start: string; end: string };
  const fetchedAt = new Date(market.retrieved_at_utc).toISOString();
  const result: { ticker: string; storyId: number; events: number }[] = [];
  for (const [ticker] of Object.entries(
    companyManifest.companies as Record<string, Row>,
  )) {
    const asset = companies.get(ticker);
    if (!asset) throw new Error(`Missing market data for ${ticker}`);
    const daily = (asset.daily as Row[]).filter(
      (bar) =>
        bar.close != null && bar.date >= range.start && bar.date <= range.end,
    );
    if (!daily.length) throw new Error(`No daily prices for ${ticker}`);

    const marketUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/history?window=${range.start}_to_${range.end}`;
    const assetKey = `stock:${ticker}`;
    await db
      .delete(stories)
      .where(and(eq(stories.assetKey, assetKey), eq(stories.sourceUrl, marketUrl)));
    const closes = daily.map((bar) => ({
      date: bar.date as string,
      value: Number(bar.adjusted_close ?? bar.close),
    }));
    const first = closes[0]!;
    const last = closes.at(-1)!;
    const changePercent = (last.value / first.value - 1) * 100;
    const company = await json(resolve(root, `companies/${ticker}.json`));
    const name = String(asset.name).split(/\s|\(/)[0]!.toLowerCase();
    const relevant = new RegExp(
      `\\b(${ticker.replace(/[-.]/g, "[.-]")}|${name}${ticker === "GOOGL" ? "|google" : ""})\\b`,
      "i",
    );
    const news = (company.news as Row[])
      .filter(
        (item) =>
          typeof item.title === "string" &&
          typeof item.summary === "string" &&
          item.summary.trim().length >= 60 &&
          typeof item.url === "string" &&
          item.url.startsWith("https://") &&
          typeof item.published_at_utc === "string" &&
          !Number.isNaN(Date.parse(item.published_at_utc)) &&
          item.published_at_utc.slice(0, 10) >= range.start &&
          item.published_at_utc.slice(0, 10) <= range.end &&
          relevant.test(item.title) &&
          !/\b(?:stock|shares) (?:rises|falls|gains|slides|ends|closes|outperforms)\b|\b(?:surpasses market returns|higher than market|stock price|trading day)\b/i.test(
            item.title,
          ),
      )
      .filter(
        (item, index, items) =>
          items.findIndex((other) => other.url === item.url) === index,
      )
      .sort((a, b) => {
        const significance = (item: Row) =>
          /\b(earnings|revenue|results|acqui|merger|deal|partnership|launch|regulat|lawsuit|investment|forecast|guidance|dividend|ceo)\w*/i.test(
            `${item.title} ${item.summary}`,
          )
            ? 1
            : 0;
        return (
          significance(b) - significance(a) ||
          String(b.published_at_utc).localeCompare(String(a.published_at_utc))
        );
      });
    const days = new Set<string>();
    const selected = news.filter((item) => {
      const day = String(item.published_at_utc).slice(0, 10);
      if (days.has(day) || days.size >= 6) return false;
      days.add(day);
      return true;
    });

    for (const item of selected) {
      const publishedAt = new Date(item.published_at_utc);
      const sourceUrl = String(item.url);
      const title = String(item.title).slice(0, 300);
      const summary = String(item.summary).trim();
      const storyContent = `${title}. Publisher abstract: ${summary} [news]. ${ticker} adjusted close moved from ${first.value} on ${first.date} to ${last.value} on ${last.date} (${changePercent.toFixed(2)}%) across the snapshot window [market]. The price change is context, not a claimed effect of this news.`;
      const sources: StoryBundle["story"]["sources"] = {
        news: {
          label:
            typeof item.publisher === "string"
              ? item.publisher
              : "Finnhub news",
          url: sourceUrl,
          publishedAt: publishedAt.toISOString(),
          accessedAt: fetchedAt,
        },
        market: {
          label: "Yahoo Finance daily price history",
          url: marketUrl,
          publishedAt: new Date(`${range.end}T23:59:59.000Z`).toISOString(),
          accessedAt: fetchedAt,
        },
      };
      const events: StoryBundle["story"]["events"] = [
        {
          id: `${ticker}_news_${item.provider_id ?? publishedAt.getTime()}`,
          date: publishedAt.toISOString().slice(0, 10),
          label: title,
          sourceId: "news",
        },
      ];

      const [existing] = await db
        .select({ id: stories.id })
        .from(stories)
        .where(
          and(eq(stories.assetKey, assetKey), eq(stories.sourceUrl, sourceUrl)),
        );
      const story = existing
        ? (
            await db
              .update(stories)
              .set({
                title,
                summary,
                content: storyContent,
                sourceName:
                  typeof item.publisher === "string"
                    ? item.publisher
                    : "Finnhub news",
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
                title,
                summary,
                content: storyContent,
                sourceName:
                  typeof item.publisher === "string"
                    ? item.publisher
                    : "Finnhub news",
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
              label: `${ticker} adjusted-close change across snapshot window (context only)`,
              value: changePercent,
              display: `${changePercent.toFixed(2)}%`,
              sourceId: "market",
              asOf: new Date(`${range.end}T23:59:59.000Z`).toISOString(),
            },
          },
          series: {
            snapshot_close: {
              label: `${ticker} daily adjusted close`,
              unit: asset.currency ?? asset.unit,
              points: closes,
              sourceId: "market",
              asOf: new Date(`${range.end}T23:59:59.000Z`).toISOString(),
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

    // SEC reports are first-class sourced stories, not just links on news stories.
    if (ticker === "AAPL" || ticker === "AVGO") {
      const filings = [
        ...((company.sec_filings_in_window as Row[]) ?? []),
        ...((company.latest_sec_reports as Row[]) ?? []),
      ].filter(
        (item, index, items) =>
          typeof item.summary === "string" &&
          item.summary.trim() &&
          (item.form === "10-Q" || item.form.startsWith("8-K")) &&
          items.findIndex((other) => other.url === item.url) === index,
      );
      for (const filing of filings) {
        const sourceUrl = String(filing.url);
        const publishedAt = new Date(`${filing.filed_at}T00:00:00.000Z`);
        const title = `${asset.name}: SEC ${filing.form} filed ${filing.filed_at}`;
        const summary = String(filing.summary);
        const content = `${summary} [filing].`;
        const [existing] = await db
          .select({ id: stories.id })
          .from(stories)
          .where(
            and(
              eq(stories.assetKey, assetKey),
              eq(stories.sourceUrl, sourceUrl),
            ),
          );
        const story = existing
          ? (
              await db
                .update(stories)
                .set({
                  title,
                  summary,
                  content,
                  sourceName: "SEC EDGAR",
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
                  title,
                  summary,
                  content,
                  sourceName: "SEC EDGAR",
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
            metrics: {},
            series: {},
            events: [
              {
                id: `${ticker}_filing_${filing.accession_number}`,
                date: filing.filed_at,
                label: summary,
                sourceId: "filing",
              },
            ],
            sources: {
              filing: {
                label: `SEC Form ${filing.form}`,
                url: sourceUrl,
                publishedAt: publishedAt.toISOString(),
                accessedAt: fetchedAt,
              },
            },
          },
        };
        await db
          .insert(storyData)
          .values({ storyId: story.id, bundle, importedAt: new Date() })
          .onConflictDoUpdate({
            target: storyData.storyId,
            set: { bundle, importedAt: new Date() },
          });
        result.push({ ticker, storyId: story.id, events: 1 });
      }
    }
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
    console.info(
      JSON.stringify(await seedSnapshotStories(resolve(root)), null, 2),
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
