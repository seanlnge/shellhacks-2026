import unittest

from data_aggregation.summarize_sec_filings import current_report_detail, quarterly_facts, summarize


class SecSummaryTests(unittest.TestCase):
    def test_quarterly_facts_match_accession_and_quarter_not_ytd(self):
        filing = {"form": "10-Q", "report_date": "2026-06-27", "accession_number": "correct"}
        company = {"financials": {"historical_facts": {"Revenues": [
            {"accn": "wrong", "start": "2026-03-29", "end": "2026-06-27", "unit": "USD", "val": 9000000000},
            {"accn": "correct", "start": "2025-09-28", "end": "2026-06-27", "unit": "USD", "val": 6000000000},
            {"accn": "correct", "start": "2026-03-29", "end": "2026-06-27", "unit": "USD", "val": 2000000000},
        ]}}}
        self.assertEqual(quarterly_facts(company, filing), ["Revenue: $2.00 billion for the quarter ended 2026-06-27"])

    def test_current_report_selects_substantive_item(self):
        text = "Item 5.02\n Item 9.01\n Item 5.02 Departure of Directors. The board appointed a new chief financial officer effective October 1, 2026. The appointee previously served as controller. Item 9.01 Financial Statements and Exhibits."
        self.assertIn("appointed a new chief financial officer", current_report_detail(text))

    def test_latest_facts_supply_figure_when_history_is_not_stored(self):
        filing = {"form": "10-Q", "report_date": "2026-08-02", "accession_number": "report"}
        company = {"financials": {"latest_reported_facts": {
            "RevenueFromContractWithCustomerExcludingAssessedTax": {
                "accn": "report", "start": "2026-05-04", "end": "2026-08-02", "unit": "USD", "val": 29591000000,
            },
            "Assets": {"accn": "report", "end": "2026-08-02", "unit": "USD", "val": 188148000000},
            "NetIncomeLoss": {"accn": "older", "start": "2026-05-04", "end": "2026-08-02", "unit": "USD", "val": 999},
        }}}
        self.assertEqual(quarterly_facts(company, filing), [
            "Revenue: $29.59 billion for the quarter ended 2026-08-02",
            "Total assets: $188.15 billion as of 2026-08-02",
        ])

    def test_proposed_sale_is_not_recorded_as_completed(self):
        filing = {"form": "144"}
        result = summarize({}, filing, {"text": "", "document_id": "abc"})
        self.assertIn("not confirmation", result["summary"])
        self.assertEqual(result["document_id"], "abc")


if __name__ == "__main__":
    unittest.main()
