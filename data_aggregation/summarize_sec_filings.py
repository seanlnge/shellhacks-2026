"""Enrich existing company snapshots with facts from cached SEC filings."""

import argparse
import json
import re
from datetime import date
from pathlib import Path


METRICS = (
    ("Revenue", ("RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues")),
    ("Net income", ("NetIncomeLoss",)),
    ("Operating income", ("OperatingIncomeLoss",)),
)
BALANCE_METRICS = (("Total assets", "Assets"), ("Total liabilities", "Liabilities"))


def quarterly_facts(company: dict, filing: dict) -> list[str]:
    financials = company.get("financials") or {}
    history = financials.get("historical_facts", {})
    details = []
    for label, tags in METRICS:
        for tag in tags:
            candidates = history.get(tag, []) or [financials.get("latest_reported_facts", {}).get(tag, {})]
            rows = [row for row in candidates
                    if row.get("accn") == filing["accession_number"]
                    and row.get("end") == filing.get("report_date")
                    and row.get("unit") == "USD"
                    and row.get("start")
                    and 70 <= (date.fromisoformat(row["end"]) - date.fromisoformat(row["start"])).days <= 110]
            if rows:
                row = max(rows, key=lambda item: item["start"])
                details.append(f"{label}: ${row['val'] / 1_000_000_000:,.2f} billion for the quarter ended {row['end']}")
                break
    latest = financials.get("latest_reported_facts", {})
    for label, tag in BALANCE_METRICS:
        row = latest.get(tag, {})
        if row.get("accn") == filing["accession_number"] and row.get("end") == filing.get("report_date") and row.get("unit") == "USD":
            details.append(f"{label}: ${row['val'] / 1_000_000_000:,.2f} billion as of {row['end']}")
    eps = latest.get("EarningsPerShareDiluted", {})
    if eps.get("accn") == filing["accession_number"] and eps.get("end") == filing.get("report_date") and eps.get("unit") == "USD/shares" and eps.get("start") and 70 <= (date.fromisoformat(eps["end"]) - date.fromisoformat(eps["start"])).days <= 110:
        details.append(f"Diluted EPS: ${eps['val']:,.2f} for the quarter")
    return details


def current_report_detail(text: str) -> str | None:
    if "Results of Operations and Financial Condition" in text and "Exhibit 99.1" in text:
        return "Furnishes a press release as Exhibit 99.1 under results of operations; the exhibit is separate from this primary filing."
    if "Departure of Directors or Certain Officers" in text:
        return "Discloses director or officer changes and related compensation arrangements."
    # Ignore cover-page checkbox references and the table of contents.
    normalized = re.sub(r"\s+", " ", text)
    matches = list(re.finditer(r"\bItem\s+(?:[1-9]\.\d{2})\s*[.:-]?\s*", normalized, re.I))
    for match in matches:
        section = normalized[match.end():match.end() + 1600]
        section = re.split(r"\bItem\s+[1-9]\.\d{2}\b|\bSIGNATURES\b", section, maxsplit=1, flags=re.I)[0]
        # A short heading with no explanatory passage is not a filing summary.
        if len(section) < 100:
            continue
        sentences = re.split(r"(?<=[.!?])\s+", section)
        excerpt = " ".join(sentences[:2]).strip()
        if len(excerpt) >= 100:
            return excerpt[:500].rsplit(" ", 1)[0] + ("..." if len(excerpt) > 500 else "")
    return None


def summarize(company: dict, filing: dict, document: dict) -> dict:
    form = filing["form"]
    text = document.get("text", "")
    result = {"content_scope": "cached SEC filing text", "document_id": document["document_id"]}
    if form in ("10-Q", "10-K"):
        facts = quarterly_facts(company, filing) if form == "10-Q" else []
        result["summary"] = (f"Quarterly report for the period ended {filing['report_date']}: " + "; ".join(facts) + ".") if facts else f"{form} report for the period ended {filing['report_date']}; full filing text is cached."
        result["key_details"] = facts
    elif form.startswith("8-K"):
        detail = current_report_detail(text)
        result["summary"] = f"Current report{' amendment' if form.endswith('/A') else ''}: {detail}" if detail else "Current report; see the linked filing for the reported event."
        result["key_details"] = [detail] if detail else []
    elif form in ("3", "4", "5"):
        person = re.search(r"Name and Address of Reporting Person\*?\s*([^\n]+)", text, re.I)
        name = person.group(1).strip() if person else None
        result["summary"] = (f"Beneficial ownership filing by {name}." if name else "Beneficial ownership filing; see filing for transaction details.")
        result["key_details"] = [f"Reporting person: {name}"] if name else []
    elif form == "144":
        result["summary"] = "Notice of proposed sale of securities; this is not confirmation that a sale occurred."
        result["key_details"] = []
    elif form == "EFFECT":
        result["summary"] = "SEC notice of effectiveness for a registration statement."
        result["key_details"] = []
    else:
        result["summary"] = f"Form {form} filing; full filing text is cached for review."
        result["key_details"] = []
    return result


def enrich(snapshot: Path, symbols: list[str]) -> None:
    manifest = json.loads((snapshot / "sec_documents" / "manifest.json").read_text(encoding="utf-8"))
    documents = {row["source_url"]: row for row in manifest["documents"] if row.get("path")}
    for symbol in symbols:
        path = snapshot / "companies" / f"{symbol}.json"
        company = json.loads(path.read_text(encoding="utf-8"))
        for filing in company.get("sec_filings_in_window", []) + company.get("latest_sec_reports", []):
            cached = documents.get(filing["url"])
            if not cached:
                continue
            document = json.loads((snapshot / cached["path"]).read_text(encoding="utf-8"))
            if document.get("source_url") != filing["url"]:
                continue
            filing.update(summarize(company, filing, document))
        path.write_text(json.dumps(company, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
        for filing in company.get("sec_filings_in_window", []) + company.get("latest_sec_reports", [])[:1]:
            print(f"{symbol} {filing['form']} {filing['filed_at']}: {filing.get('summary', 'No cached text')}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("symbols", nargs="+", help="Company tickers to enrich")
    arguments = parser.parse_args()
    enrich(arguments.snapshot, arguments.symbols)
