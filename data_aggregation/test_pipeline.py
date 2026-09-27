import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

from data_aggregation.pipeline import cluster, event, load, normalize, parse_snapshot, save, stories
from data_aggregation.portfolio_db import connect, portfolio, set_holding
from data_aggregation.cache_sec_documents import chunks, extract


class PipelineTests(unittest.TestCase):
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

    def test_filing_text_extraction_and_chunks(self):
        text = extract(b"<html><style>hide</style><p>Revenue rose</p><script>ignore</script><p>$20</p></html>")
        self.assertIn("Revenue rose", text)
        self.assertNotIn("hide", text)
        self.assertNotIn("ignore", text)
        self.assertEqual(chunks("abcdefgh", size=5, overlap=2)[1]["text"], "defgh")

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
