export type MarketRange = "1w" | "1mo" | "3mo" | "1y";

export type MarketPoint = { date: string; value: number };

export class MarketSeriesError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 429 | 503,
  ) {
    super(message);
  }
}

export function marketWindow(range: MarketRange, now = new Date()) {
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const endExclusive = new Date(today);
  const start = new Date(today);
  if (range === "1w") start.setUTCDate(start.getUTCDate() - 7);
  if (range === "1mo") {
    start.setUTCDate(1);
    start.setUTCMonth(start.getUTCMonth() - 1);
    start.setUTCDate(
      Math.min(
        today.getUTCDate(),
        new Date(
          Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
        ).getUTCDate(),
      ),
    );
  }
  if (range === "3mo") {
    start.setUTCDate(1);
    start.setUTCMonth(start.getUTCMonth() - 3);
    start.setUTCDate(
      Math.min(
        today.getUTCDate(),
        new Date(
          Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
        ).getUTCDate(),
      ),
    );
  }
  if (range === "1y") {
    start.setUTCDate(1);
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    start.setUTCDate(
      Math.min(
        today.getUTCDate(),
        new Date(
          Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
        ).getUTCDate(),
      ),
    );
  }
  return { start, endExclusive };
}

export function yahooChartUrl(symbol: string, start: Date, endExclusive: Date) {
  if (!/^[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(symbol)) {
    throw new Error("Invalid stock symbol");
  }
  const url = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
  );
  url.searchParams.set("period1", String(Math.floor(start.getTime() / 1000)));
  url.searchParams.set(
    "period2",
    String(Math.floor(endExclusive.getTime() / 1000)),
  );
  url.searchParams.set("interval", "1d");
  return url.toString();
}

export function parseYahooChart(
  value: unknown,
  start: Date,
  endExclusive: Date,
): { points: MarketPoint[]; currency: string; lastTimestamp: string } {
  if (!value || typeof value !== "object" || !("chart" in value)) {
    throw new MarketSeriesError("Yahoo chart data unavailable", 503);
  }
  const chart = value.chart;
  if (!chart || typeof chart !== "object" || !("result" in chart)) {
    throw new MarketSeriesError("Yahoo chart data unavailable", 503);
  }
  if ("error" in chart && chart.error) {
    throw new MarketSeriesError("Yahoo chart data unavailable", 503);
  }
  const result: unknown = Array.isArray(chart.result)
    ? (chart.result as unknown[])[0]
    : null;
  if (!result || typeof result !== "object") {
    throw new MarketSeriesError("No daily prices in the requested range", 404);
  }
  const data = result as {
    timestamp?: unknown;
    indicators?: {
      quote?: { close?: unknown }[];
      adjclose?: { adjclose?: unknown }[];
    };
    meta?: { currency?: unknown };
  };
  const timestamps = data.timestamp;
  const close = data.indicators?.quote?.[0]?.close;
  const adjusted = data.indicators?.adjclose?.[0]?.adjclose;
  if (!Array.isArray(timestamps) || !Array.isArray(close)) {
    throw new MarketSeriesError("Yahoo chart data unavailable", 503);
  }
  const dates = timestamps as unknown[];
  const closes = close as unknown[];
  const adjustedCloses = Array.isArray(adjusted)
    ? (adjusted as unknown[])
    : null;
  const byDate = new Map<string, { value: number; timestamp: number }>();
  for (const [index, timestamp] of dates.entries()) {
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) continue;
    const ms = timestamp * 1000;
    if (ms < start.getTime() || ms >= endExclusive.getTime()) continue;
    const candidate: unknown = adjustedCloses?.[index];
    const raw: unknown =
      typeof candidate === "number" && Number.isFinite(candidate)
        ? candidate
        : closes[index];
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    const date = new Date(ms).toISOString().slice(0, 10);
    const previous = byDate.get(date);
    if (!previous || timestamp > previous.timestamp) {
      byDate.set(date, { value: Math.round(raw * 100) / 100, timestamp });
    }
  }
  const points = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { value }]) => ({ date, value }));
  if (!points.length) {
    throw new MarketSeriesError("No daily prices in the requested range", 404);
  }
  const currency = data.meta?.currency;
  return {
    points,
    currency:
      typeof currency === "string" && /^[A-Z]{3}$/.test(currency)
        ? currency
        : "price",
    lastTimestamp: new Date(
      byDate.get(points[points.length - 1]!.date)!.timestamp * 1000,
    ).toISOString(),
  };
}

export async function fetchYahooSeries(
  symbol: string,
  range: MarketRange,
  now = new Date(),
) {
  const { start, endExclusive } = marketWindow(range, now);
  const url = yahooChartUrl(symbol, start, endExclusive);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8000),
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    throw new MarketSeriesError("Yahoo chart data unavailable", 503);
  }
  if (response.status === 429)
    throw new MarketSeriesError("Yahoo rate limit reached", 429);
  if (!response.ok)
    throw new MarketSeriesError("Yahoo chart data unavailable", 503);
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new MarketSeriesError("Yahoo chart data unavailable", 503);
  }
  return {
    ...parseYahooChart(data, start, endExclusive),
    url,
    accessedAt: new Date().toISOString(),
  };
}
