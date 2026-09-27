import { z } from "zod";

import { accessError, authorizedStory } from "~/server/generative/access";
import {
  fetchYahooSeries,
  MarketSeriesError,
  type MarketRange,
} from "~/server/market/yahoo-series";

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
};

const cache = new Map<string, { expires: number; payload: Payload }>();
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

  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = `${access.portfolio.userId}:${access.portfolio.id}:${assetKey}:${input.data.range}:${today}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return Response.json(cached.payload, { headers });
  }
  try {
    const fetched = await fetchYahooSeries(holding.symbol, input.data.range);
    const payload: Payload = {
      series: {
        label: `${holding.name} daily closing price (adjusted when available)`,
        unit: fetched.currency,
        points: fetched.points,
        sourceId: `market:${assetKey}:${input.data.range}`,
        asOf: fetched.lastTimestamp,
      },
      source: {
        label: "Yahoo Finance daily chart",
        url: fetched.url,
        publishedAt: fetched.lastTimestamp,
        accessedAt: fetched.accessedAt,
      },
      assetKey,
      range: input.data.range,
    };
    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    cache.set(cacheKey, { payload, expires: Date.now() + 60_000 });
    return Response.json(payload, { headers });
  } catch (error) {
    const failure =
      error instanceof MarketSeriesError
        ? error
        : new MarketSeriesError("Yahoo chart data unavailable", 503);
    return Response.json(
      { error: failure.message },
      { status: failure.status, headers },
    );
  }
}
