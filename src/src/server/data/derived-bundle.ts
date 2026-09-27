import { and, asc, eq, gte } from "drizzle-orm";

import type { StoryBundle } from "~/server/data/story-bundle";
import { db } from "~/server/db";
import { financialFacts, priceBars } from "~/server/db/schema";

type Story = { id: number; assetKey: string; title: string };

const annualTags = [
  ["Revenues", "Revenue"],
  ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenue"],
  ["NetIncomeLoss", "Net income"],
  ["EarningsPerShareDiluted", "Diluted EPS"],
  ["NetCashProvidedByUsedInOperatingActivities", "Operating cash flow"],
] as const;

export async function integratedStoryBundle(
  story: Story,
  existing: StoryBundle | null,
): Promise<StoryBundle | null> {
  const cutoff = new Date();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  const [bars, facts] = await Promise.all([
    db
      .select()
      .from(priceBars)
      .where(
        and(
          eq(priceBars.assetKey, story.assetKey),
          gte(priceBars.date, cutoff.toISOString().slice(0, 10)),
        ),
      )
      .orderBy(asc(priceBars.date)),
    db
      .select()
      .from(financialFacts)
      .where(eq(financialFacts.assetKey, story.assetKey)),
  ]);
  if (!bars.length && !facts.length) return existing;
  const symbol = story.assetKey.split(":").slice(1).join(":");
  const data: StoryBundle = existing
    ? structuredClone(existing)
    : {
        story: {
          id: story.id,
          assetKey: story.assetKey,
          holding: { ticker: symbol, name: symbol },
          metrics: {},
          series: {},
          events: [],
          sources: {},
        },
      };
  if (bars.length) {
    const provider = bars[0]!.provider;
    const selected = bars.filter((bar) => bar.provider === provider);
    const last = selected.at(-1)!;
    const sourceId = `imported_price_${provider.replace(/[^a-zA-Z0-9]/g, "_")}`;
    data.story.sources[sourceId] = {
      label: `${provider} daily chart`,
      url: last.sourceUrl,
      publishedAt: `${last.date}T00:00:00.000Z`,
      accessedAt: last.fetchedAt.toISOString(),
    };
    data.story.series.imported_close = {
      label: `${symbol} daily closing price (adjusted when available)`,
      unit: last.currency ?? last.unit,
      points: selected.map((bar) => ({
        date: bar.date,
        value: Number(bar.adjustedClose ?? bar.close),
      })),
      sourceId,
      asOf: `${last.date}T00:00:00.000Z`,
    };
    data.story.series.imported_volume = {
      label: `${symbol} daily volume`,
      unit: "shares",
      points: selected
        .filter((bar) => bar.volume !== null)
        .map((bar) => ({
          date: bar.date,
          value: bar.volume!,
        })),
      sourceId,
      asOf: `${last.date}T00:00:00.000Z`,
    };
    if (!data.story.series.imported_volume.points.length)
      delete data.story.series.imported_volume;
  }
  for (const [tag, label] of annualTags) {
    if (label === "Revenue" && data.story.series.imported_revenue) continue;
    const byPeriod = new Map<string, (typeof facts)[number]>();
    for (const fact of facts) {
      if (
        fact.tag !== tag ||
        fact.form !== "10-K" ||
        fact.fiscalPeriod !== "FY" ||
        !fact.periodStart
      )
        continue;
      const duration =
        (Date.parse(fact.periodEnd) - Date.parse(fact.periodStart)) /
        86_400_000;
      if (duration < 300 || duration > 380) continue;
      const current = byPeriod.get(fact.periodEnd);
      if (
        !current ||
        fact.filedAt > current.filedAt ||
        (fact.filedAt === current.filedAt && fact.accession > current.accession)
      )
        byPeriod.set(fact.periodEnd, fact);
    }
    const observations = [...byPeriod.values()].sort((a, b) =>
      a.periodEnd.localeCompare(b.periodEnd),
    );
    if (!observations.length) continue;
    const last = observations.at(-1)!;
    const sourceId = `imported_fact_${tag}`;
    data.story.sources[sourceId] = {
      label: `SEC company facts: ${tag}`,
      url: last.sourceUrl,
      publishedAt: `${last.filedAt}T00:00:00.000Z`,
      accessedAt: `${last.filedAt}T00:00:00.000Z`,
    };
    const key = label === "Revenue" ? "imported_revenue" : `imported_${tag}`;
    data.story.metrics[key] = {
      label: `${label} (${last.unit}, FY ${last.periodEnd.slice(0, 4)})`,
      value: Number(last.value),
      display: `${Number(last.value).toLocaleString("en-US")} ${last.unit}`,
      sourceId,
      asOf: `${last.filedAt}T00:00:00.000Z`,
    };
    if (
      observations.length >= 2 &&
      observations.every((fact) => fact.unit === last.unit)
    ) {
      data.story.series[key] = {
        label: `${label} (annual, as filed)`,
        unit: last.unit,
        points: observations.map((fact) => ({
          date: fact.periodEnd,
          value: Number(fact.value),
        })),
        sourceId,
        asOf: `${last.filedAt}T00:00:00.000Z`,
      };
    }
  }
  return Object.keys(data.story.metrics).length ||
    Object.keys(data.story.series).length ||
    data.story.events.length
    ? data
    : null;
}
