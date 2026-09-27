import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchYahooSeries,
  marketWindow,
  parseYahooChart,
  yahooChartUrl,
} from "../../../src/server/market/yahoo-series";

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;

test("one month is a trailing UTC month with leap-day clamping", () => {
  const window = marketWindow("1mo", new Date("2024-03-15T19:00:00Z"));
  assert.equal(window.start.toISOString(), "2024-02-15T00:00:00.000Z");
  assert.equal(window.endExclusive.toISOString(), "2024-03-15T00:00:00.000Z");
  assert.equal(
    marketWindow("3mo", new Date("2026-05-31T12:00:00Z")).start.toISOString(),
    "2026-02-28T00:00:00.000Z",
  );
});

test("Yahoo URL uses only fixed HTTPS host, chart path, daily interval and bounded dates", () => {
  const { start, endExclusive } = marketWindow(
    "1mo",
    new Date("2024-03-15T12:00:00Z"),
  );
  const url = new URL(yahooChartUrl("BRK-B", start, endExclusive));
  assert.equal(url.origin, "https://query1.finance.yahoo.com");
  assert.equal(url.pathname, "/v8/finance/chart/BRK-B");
  assert.deepEqual(
    [...url.searchParams.keys()],
    ["period1", "period2", "interval"],
  );
  assert.equal(url.searchParams.get("period1"), String(day("2024-02-15")));
  assert.equal(url.searchParams.get("period2"), String(day("2024-03-15")));
  assert.equal(url.searchParams.get("interval"), "1d");
  assert.throws(() => yahooChartUrl("../../evil", start, endExclusive));
});

test("parser sorts, deduplicates, filters bounds and invalid prices, prefers adjusted close", () => {
  const window = {
    start: new Date("2024-02-01T00:00:00Z"),
    endExclusive: new Date("2024-03-01T00:00:00Z"),
  };
  const response = {
    chart: {
      error: null,
      result: [
        {
          timestamp: [
            day("2024-02-02"),
            day("2024-01-31"),
            day("2024-02-01"),
            day("2024-02-02") + 60,
            day("2024-02-03"),
            day("2024-02-04"),
            day("2024-03-01"),
          ],
          indicators: {
            quote: [{ close: [20, 2, 10, 21, null, 50, 60] }],
            adjclose: [
              {
                adjclose: [19, 1, null, 18, null, Number.POSITIVE_INFINITY, 59],
              },
            ],
          },
          meta: { currency: "USD" },
        },
      ],
    },
  };
  assert.deepEqual(
    parseYahooChart(response, window.start, window.endExclusive),
    {
      points: [
        { date: "2024-02-01", value: 10 },
        { date: "2024-02-02", value: 18 },
        { date: "2024-02-04", value: 50 },
      ],
      currency: "USD",
      lastTimestamp: "2024-02-04T00:00:00.000Z",
    },
  );
});

test("mocked Yahoo fetch reports no points and rate limiting distinctly", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        chart: {
          result: [{ timestamp: [], indicators: { quote: [{ close: [] }] } }],
        },
      }),
      { status: 200 },
    );
  await assert.rejects(fetchYahooSeries("AAPL", "1w"), { status: 404 });
  globalThis.fetch = async () => new Response(null, { status: 429 });
  await assert.rejects(fetchYahooSeries("AAPL", "1w"), { status: 429 });
});

test("Yahoo chart errors are unavailable even if a result is supplied", () => {
  const { start, endExclusive } = marketWindow(
    "1w",
    new Date("2024-03-15T00:00:00Z"),
  );
  assert.throws(
    () =>
      parseYahooChart(
        { chart: { error: { code: "Not Found" }, result: [{}] } },
        start,
        endExclusive,
      ),
    { status: 503 },
  );
});

test("mocked Yahoo fetch produces sourced daily values without following redirects", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.host, "query1.finance.yahoo.com");
    assert.equal(options?.redirect, "manual");
    assert.equal(options?.cache, "no-store");
    return Response.json({
      chart: {
        error: null,
        result: [
          {
            timestamp: [day("2024-02-29")],
            indicators: {
              quote: [{ close: [102] }],
              adjclose: [{ adjclose: [99.504] }],
            },
            meta: { currency: "USD" },
          },
        ],
      },
    });
  };
  const result = await fetchYahooSeries(
    "AAPL",
    "1mo",
    new Date("2024-03-15T00:00:00Z"),
  );
  assert.deepEqual(result.points, [{ date: "2024-02-29", value: 99.5 }]);
  assert.equal(result.lastTimestamp, "2024-02-29T00:00:00.000Z");
  assert.match(
    result.url,
    /^https:\/\/query1\.finance\.yahoo\.com\/v8\/finance\/chart\/AAPL\?/,
  );
});
