import tempfile
import json
import unittest
from datetime import UTC, date, datetime
from pathlib import Path
from unittest.mock import patch

from data_aggregation.aggregate_companies import enrich_finnhub, finnhub_news, news, prioritize_news
from data_aggregation.pipeline import cluster, event, load, normalize, parse_snapshot, save, stories
from data_aggregation.portfolio_db import connect, portfolio, set_holding
from data_aggregation.cache_sec_documents import chunks, extract
from data_aggregation.aggregate_companies import financial_facts
from data_aggregation.aggregate_weekly import event_window


class PipelineTests(unittest.TestCase):
    def test_prioritize_news_keeps_summaries_and_small_headline_fallback(self):
        articles = [
            {"published_at_utc": f"2026-09-{day:02d}T00:00:00+00:00", "title": str(day)}
            for day in range(1, 10)
        ]
        articles[0]["summary"] = "Detailed reporting"
        articles[1]["content"] = "Licensed article"
        kept = prioritize_news(articles, headline_limit=2)
        self.assertEqual([item["title"] for item in kept], ["9", "8", "2", "1"])

    def test_finnhub_enrichment_retains_existing_news_and_summaries(self):
        record = {"symbol": "BRK-B", "news_source": "Google News RSS", "news": [
            {"title": "RSS", "url": "https://example.com/rss", "published_at_utc": "2026-09-25T12:00:00+00:00"},
        ], "unavailable": {}}
        article = {"headline": "Finnhub headline", "url": "https://example.com/finnhub",
                   "datetime": 1789905600, "summary": "Publisher abstract", "id": 42}

        def response(url, _agent):
            if "company-news" in url:
                return json.dumps([article]).encode()
            return b"[]" if "recommendation" in url or "earnings" in url else b'{"metric": {"marketCapitalization": 10}}'

        with patch("data_aggregation.aggregate_companies.fetch", side_effect=response) as request:
            enrich_finnhub(record, "test-key", date(2026, 9, 1), date(2026, 9, 26))
            enrich_finnhub(record, "test-key", date(2026, 9, 1), date(2026, 9, 26))
        self.assertEqual(len(record["news"]), 2)
        self.assertEqual(record["news"][1]["summary"], "Publisher abstract")
        self.assertEqual(record["news"][1]["provider_id"], 42)
        self.assertEqual(record["finnhub"]["basic_financials"]["metric"]["marketCapitalization"], 10)
        self.assertTrue(all("BRK.B" in call.args[0] for call in request.call_args_list))

    def test_finnhub_news_rejects_error_response(self):
        with patch("data_aggregation.aggregate_companies.fetch", return_value=b'{"error": "rate limit"}'):
            with self.assertRaises(ValueError):
                finnhub_news("AAPL", "test-key", date(2026, 9, 1), date(2026, 9, 26))

    def test_news_search_slices_and_retains_full_window(self):
        def rss(url, _agent):
            day = "2026-08-28" if "after%3A2026-08-28" in url else "2026-08-31"
            published = "Fri, 28 Aug 2026 12:00:00 GMT" if day.endswith("28") else "Mon, 31 Aug 2026 12:00:00 GMT"
            return f"<rss><channel><item><title>{day}</title><link>https://example.com/{day}</link><pubDate>{published}</pubDate></item></channel></rss>".encode()

        with patch("data_aggregation.aggregate_companies.fetch", side_effect=rss) as request:
            rows = news("Example", datetime(2026, 8, 28).date(), datetime(2026, 9, 2).date(), window_days=3)
        self.assertEqual(request.call_count, 2)
        self.assertEqual(len(rows), 2)
        with patch("data_aggregation.aggregate_companies.fetch", side_effect=rss) as daily_requests:
            news("Example", datetime(2026, 8, 28).date(), datetime(2026, 9, 2).date(), window_days=1)
        self.assertEqual(daily_requests.call_count, 6)

    def test_cluster_same_holding_similar_news_within_48_hours(self):
        rows = [
            event("AAPL", "news", "2026-09-25T12:00:00+00:00", "https://a", "Apple announces major new iPhone launch"),
            event("AAPL", "news", "2026-09-24T12:00:00+00:00", "https://b", "Apple announces major new iPhone launch today"),
            event("NVDA", "news", "2026-09-25T12:00:00+00:00", "https://c", "Apple announces major new iPhone launch"),
        ]
        groups = cluster(rows)
        self.assertEqual([len(group) for group in groups], [2, 1])
        result = stories(rows, {"AAPL": 0.4, "NVDA": 0.3}, 5, datetime(2026, 9, 26, tzinfo=UTC))
        self.assertEqual(result[0]["event_count"], 2)
        self.assertEqual(len(result[0]["source_urls"]), 2)

    def test_stories_prioritize_relevant_summaries_over_prices_and_unrelated_news(self):
        reference = datetime(2026, 9, 27, tzinfo=UTC)
        rows = [
            event("AAPL", "price", "2026-09-26T00:00:00+00:00", "https://price", "AAPL rose 2%", price_move_percent=2),
            event("AAPL", "news", "2026-09-25T12:00:00+00:00", "https://unrelated", "Unrelated chip story", headline="Chip story", abstract="A chip maker announced a partnership", company="Apple"),
            event("AAPL", "news", "2026-09-24T12:00:00+00:00", "https://apple", "Apple launches new hardware. Apple announced a new product", headline="Apple launches new hardware", abstract="Apple announced a new product", company="Apple"),
            event("AAPL", "news", "2026-09-26T12:00:00+00:00", "https://headline", "Apple stock changed", headline="Apple stock changed", company="Apple"),
        ]
        result = stories(rows, {"AAPL": 1}, 10, reference)
        self.assertEqual([row["headline"] for row in result], ["Apple launches new hardware"])
        self.assertEqual(result[0]["summary_3_lines"], ["Apple announced a new product"])

    def test_normalize_existing_snapshot(self):
        snapshot = Path(__file__).resolve().parent / "data" / "2026-09-19_to_2026-09-25"
        if not snapshot.exists():
            self.skipTest("Collected snapshot not available")
        rows = normalize(snapshot, {"AAPL": 0.5})
        self.assertEqual(sum(row["type"] == "price" for row in rows), 5)
        self.assertTrue(any(row["type"] == "news" for row in rows))
        self.assertTrue(all(row["holding"] == "AAPL" for row in rows))

    def test_parse_all_collected_sources_without_portfolio(self):
        snapshot = Path(__file__).resolve().parent / "data" / "2026-09-19_to_2026-09-25"
        if not snapshot.exists():
            self.skipTest("Collected snapshot not available")
        parsed = parse_snapshot(snapshot)
        self.assertEqual(parsed["counts"]["weekly_assets"], 18)
        self.assertEqual(parsed["counts"]["price"], 90)
        self.assertEqual(parsed["counts"]["news"], 321)
        self.assertEqual(parsed["counts"]["filing"], 14)
        self.assertEqual(parsed["counts"]["market_metrics"], 18)
        self.assertEqual(parsed["counts"]["sec_documents_cached"], 21)
        self.assertEqual(parsed["market_metrics"]["AAPL"]["latest_quarterly_dividend_amount"], 0.27)
        self.assertIsNone(parsed["market_metrics"]["BRK-B"]["market_cap"])
        self.assertTrue(parsed["financial_facts"])
        self.assertTrue(all("period_end" in fact and "source_url" in fact for fact in parsed["financial_facts"]))
        self.assertTrue(any(fact["older_than_two_years"] for fact in parsed["financial_facts"]))
        self.assertTrue(all(item["document_path"] for item in parsed["events"] if item["type"] == "filing"))

    def test_month_snapshot_covers_entire_window(self):
        snapshot = Path(__file__).resolve().parent / "data" / "2026-08-28_to_2026-09-26"
        if not snapshot.exists():
            self.skipTest("Month snapshot not available")
        parsed = parse_snapshot(snapshot)
        self.assertEqual(parsed["date_range_utc"], {"start": "2026-08-28", "end": "2026-09-26"})
        self.assertEqual(parsed["counts"]["price"], 360)
        self.assertGreater(parsed["counts"]["news"], 321)
        self.assertGreater(parsed["counts"]["filing"], 14)
        self.assertEqual(parsed["counts"]["sec_documents_cached"], 73)
        self.assertTrue(all("2026-08-28" <= item["ts"][:10] <= "2026-09-26" for item in parsed["events"]))

    def test_filing_text_extraction_and_chunks(self):
        text = extract(b"<html><style>hide</style><p>Revenue rose</p><script>ignore</script><p>$20</p></html>")
        self.assertIn("Revenue rose", text)
        self.assertNotIn("hide", text)
        self.assertNotIn("ignore", text)
        self.assertEqual(chunks("abcdefgh", size=5, overlap=2)[1]["text"], "defgh")

    def test_event_window_retains_price_history_and_recomputes_summary(self):
        full = {"symbol": "AAPL", "daily": [
            {"date": "2026-08-01", "open": 10, "high": 12, "low": 9, "close": 11, "volume": 100},
            {"date": "2026-09-01", "open": 20, "high": 23, "low": 18, "close": 22, "volume": 200},
            {"date": "2026-09-02", "open": 22, "high": 26, "low": 21, "close": 25, "volume": 300},
        ]}
        window = event_window(full, date(2026, 9, 1))
        self.assertEqual(len(full["daily"]), 3)
        self.assertEqual(len(window["daily"]), 2)
        self.assertEqual(window["weekly"]["close"], 25)
        self.assertEqual(window["weekly"]["volume"], 500)
        self.assertEqual(window["weekly"]["open_to_close_change_percent"], 25)

    def test_historical_sec_facts_preserve_periods_and_exclude_future_filings(self):
        payload = {"facts": {"us-gaap": {"Revenues": {"units": {"USD": [
            {"val": 10, "start": "2025-01-01", "end": "2025-03-31", "filed": "2025-05-01", "form": "10-Q", "accn": "a"},
            {"val": 12, "start": "2025-04-01", "end": "2025-06-30", "filed": "2025-08-01", "form": "10-Q", "accn": "b"},
            {"val": 99, "end": "2025-06-30", "filed": "2026-10-01", "form": "10-K", "accn": "c"},
        ]}}}}}
        facts = financial_facts(payload, date(2026, 9, 25))
        self.assertEqual([row["val"] for row in facts["historical_facts"]["Revenues"]], [10, 12])
        self.assertEqual(facts["latest_reported_facts"]["Revenues"]["accn"], "b")

    def test_parse_snapshot_exposes_content_and_history_without_inventing_articles(self):
        with tempfile.TemporaryDirectory() as directory:
            snapshot = Path(directory)
            companies = snapshot / "companies"
            companies.mkdir()
            save(snapshot / "weekly_market_data.json", {"date_range_utc": {"start": "2026-09-01", "end": "2026-09-30"}, "assets": {}})
            save(snapshot / "price_history.json", {"date_range_utc": {"start": "2025-10-01", "end": "2026-09-30"}, "assets": {}})
            save(companies / "AAPL.json", {"symbol": "AAPL", "news_source": "RSS", "news": [
                {"title": "Headline", "url": "https://example.com/news", "published_at_utc": "2026-09-28T12:00:00+00:00"},
                {"title": "Licensed", "url": "https://example.com/article", "published_at_utc": "2026-09-29T12:00:00+00:00", "content": "Provider text", "content_scope": "provider article content"},
            ], "financials": {"cik": 1, "source": "https://data.sec.gov/facts", "latest_reported_facts": {}, "historical_facts": {
                "Revenues": [{"val": 10, "unit": "USD", "end": "2026-06-30", "filed": "2026-08-01", "form": "10-Q", "accn": "a"}]
            }}})
            parsed = parse_snapshot(snapshot)
            self.assertIsNone(parsed["news_articles"][0]["content"])
            self.assertEqual(parsed["news_articles"][0]["content_scope"], "headline only")
            self.assertEqual(parsed["news_articles"][1]["content"], "Provider text")
            self.assertEqual(parsed["historical_financial_facts"][0]["accession_number"], "a")
            self.assertEqual(parsed["price_history"]["date_range_utc"]["start"], "2025-10-01")

    def test_json_roundtrip(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "portfolio.json"
            save(path, {"AAPL": 0.5})
            self.assertEqual(load(path), {"AAPL": 0.5})

    def test_portfolio_crud_weight_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            db = connect(Path(directory) / "portfolios.sqlite3")
            try:
                with db:
                    db.execute("INSERT INTO portfolios(name) VALUES (?)", ("Test",))
                    set_holding(db, "Test", "aapl", 0.6)
                    set_holding(db, "Test", "nvda", 0.4)
                    self.assertEqual(len(portfolio(db, "Test")["holdings"]), 2)
                    with self.assertRaises(ValueError):
                        set_holding(db, "Test", "GE", 0.1)
                    db.execute("DELETE FROM holdings WHERE asset_id = ?", ("NVDA",))
                    self.assertEqual(len(portfolio(db, "Test")["holdings"]), 1)
            finally:
                db.close()


if __name__ == "__main__":
    unittest.main()
