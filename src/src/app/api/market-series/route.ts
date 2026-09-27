import { z } from "zod";
import { and, asc, eq, gte, lt } from "drizzle-orm";

import { db } from "~/server/db";
import { priceBars } from "~/server/db/schema";
import { accessError, authorizedStory } from "~/server/generative/access";
import { marketWindow, type MarketRange } from "~/server/market/yahoo-series";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  portfolioId: z.coerce.number().int().positive(),
  storyId: z.coerce.number().int().positive(),
  range: z.enum(["1w", "1mo", "3mo", "1y"]),
  assetKey: z.string().max(128).optional(),
});

type Payload = {
  series: {
    label: string;
    unit: string;
    points: { date: string; value: number }[];
    sourceId: string;
    asOf: string;
  };
  source: {
    label: string;
    url: string;
    publishedAt: string;
    accessedAt: string;
  };
  assetKey: string;
  range: MarketRange;
  stale: boolean;
};

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (
    [...params.keys()].some(
      (key) => !["portfolioId", "storyId", "range", "assetKey"].includes(key),
    ) ||
    [...params.keys()].some((key) => params.getAll(key).length !== 1)
  ) {
    return Response.json(
      { error: "Invalid request" },
      { status: 400, headers },
    );
  }
  const input = inputSchema.safeParse(Object.fromEntries(params));
  if (!input.success) {
    return Response.json(
      { error: "Invalid request" },
      { status: 400, headers },
    );
  }
  const access = await authorizedStory(
    input.data.portfolioId,
    input.data.storyId,
  );
  if ("error" in access && access.error) return accessError(access.error);

  const assetKey = input.data.assetKey ?? access.story.assetKey;
  const holding = access.portfolio.holdings.find(
    (item) => item.kind === "stock" && `stock:${item.symbol}` === assetKey,
  );
  if (!holding || !/^[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(holding.symbol)) {
    return Response.json(
      { error: "Stock holding not found" },
      { status: 404, headers },
    );
  }

  try {
    const { start, endExclusive } = marketWindow(input.data.range);
    const rows = await db
      .select()
      .from(priceBars)
      .where(
        and(
          eq(priceBars.assetKey, assetKey),
          gte(priceBars.date, start.toISOString().slice(0, 10)),
          lt(priceBars.date, endExclusive.toISOString().slice(0, 10)),
        ),
      )
      .orderBy(asc(priceBars.date));
    if (!rows.length)
      return Response.json(
        {
          error: "No imported daily prices in the requested range",
          coverage: "no data",
        },
        { status: 404, headers },
      );
    // A single provider must supply the full series; never mix adjusted and raw
    // observations from independent vendors under one citation.
    const provider = rows[0]!.provider;
    const bars = rows.filter((bar) => bar.provider === provider);
    const last = bars.at(-1)!;
    const asOf = `${last.date}T00:00:00.000Z`;
    const fetchedAt = bars.reduce(
      (latest, bar) => (bar.fetchedAt > latest ? bar.fetchedAt : latest),
      bars[0]!.fetchedAt,
    );
    const stale = Date.now() - new Date(asOf).getTime() > 4 * 86_400_000;
    const payload: Payload = {
      series: {
        label: `${holding.name} daily closing price (adjusted when available)`,
        unit: last.currency ?? "price",
        points: bars.map((bar) => ({
          date: bar.date,
          value: Number(bar.adjustedClose ?? bar.close),
        })),
        sourceId: `market:${assetKey}:${input.data.range}`,
        asOf,
      },
      source: {
        label: `${provider} imported daily chart`,
        url: last.sourceUrl,
        publishedAt: asOf,
        accessedAt: fetchedAt.toISOString(),
      },
      assetKey,
      range: input.data.range,
      stale,
    };
    return Response.json(payload, { headers });
  } catch {
    return Response.json(
      { error: "Imported daily prices unavailable" },
      { status: 503, headers },
    );
  }
}
