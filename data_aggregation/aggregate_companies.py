"""Collect company news, SEC records, and available earnings transcripts as JSON."""

import argparse
import html
import json
import os
import time
import xml.etree.ElementTree as ET
from datetime import UTC, date, datetime, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


COMPANIES = {
    "AAPL": ("Apple", '"Apple" stock'),
    "GOOGL": ("Alphabet (Google)", '"Alphabet" Google stock'),
    "GE": ("GE Aerospace", '"GE Aerospace" stock'),
    "BRK-B": ("Berkshire Hathaway", '"Berkshire Hathaway"'),
    "AVGO": ("Broadcom", '"Broadcom" stock'),
    "NVDA": ("Nvidia", '"Nvidia" stock'),
    "HLT": ("Hilton Worldwide", '"Hilton Worldwide" stock'),
}


def credential(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if value:
        return value
    path = Path(__file__).resolve().parent / ".env"
    if not path.exists():
        return ""
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        key, separator, candidate = line.strip().partition("=")
        if separator and key.strip().removeprefix("export ") == name:
            candidate = candidate.strip()
            if len(candidate) >= 2 and candidate[0] == candidate[-1] and candidate[0] in ("'", '"'):
                candidate = candidate[1:-1]
            return candidate
    return ""


FINANCIAL_TAGS = (
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "NetIncomeLoss",
    "GrossProfit",
    "OperatingIncomeLoss",
    "CostOfRevenue",
    "Assets",
    "Liabilities",
    "StockholdersEquity",
    "AssetsCurrent",
    "LiabilitiesCurrent",
    "CashAndCashEquivalentsAtCarryingValue",
    "LongTermDebtCurrent",
    "LongTermDebtNoncurrent",
    "OperatingExpenses",
    "ResearchAndDevelopmentExpense",
    "EarningsPerShareDiluted",
    "EarningsPerShareBasic",
    "CommonStockSharesOutstanding",
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInInvestingActivities",
    "PaymentsToAcquirePropertyPlantAndEquipment",
)


def fetch(url: str, user_agent: str) -> bytes:
    request = Request(url, headers={"User-Agent": user_agent, "Accept": "application/json, application/xml"})
    with urlopen(request, timeout=25) as response:
        return response.read()


def news(query: str, start: date, end: date, *, window_days: int = 1) -> list[dict]:
    if window_days < 1:
        raise ValueError("window_days must be positive")
    articles = {}
    cursor = start
    while cursor <= end:
        window_end = min(cursor + timedelta(days=window_days - 1), end)
        terms = f"{query} after:{cursor.isoformat()} before:{(window_end + timedelta(days=1)).isoformat()}"
        url = "https://news.google.com/rss/search?" + urlencode(
            {"q": terms, "hl": "en-US", "gl": "US", "ceid": "US:en"}
        )
        root = ET.fromstring(fetch(url, "Mozilla/5.0"))
        for item in root.findall("./channel/item"):
            published = parsedate_to_datetime(item.findtext("pubDate", "")).astimezone(UTC)
            if not cursor <= published.date() <= window_end:
                continue
            link = item.findtext("link", "")
            if link:
                articles[link] = {
                    "title": html.unescape(item.findtext("title", "")),
                    "url": link,
                    "publisher": item.findtext("source"),
                    "published_at_utc": published.isoformat(),
                }
        cursor = window_end + timedelta(days=1)
    return sorted(articles.values(), key=lambda article: article["published_at_utc"], reverse=True)


def finnhub_news(symbol: str, token: str, start: date, end: date) -> list[dict]:
    url = "https://finnhub.io/api/v1/company-news?" + urlencode(
        {"symbol": symbol, "from": start.isoformat(), "to": end.isoformat(), "token": token}
    )
    rows = json.loads(fetch(url, "Shellhacks market research"))
    if not isinstance(rows, list):
        raise ValueError("Finnhub company news returned an unexpected response")
    return [
        {
            "title": row["headline"], "url": row["url"],
            "publisher": row.get("source"),
            "published_at_utc": datetime.fromtimestamp(row["datetime"], UTC).isoformat(),
            "summary": row.get("summary"),
        }
        for row in rows
        if isinstance(row, dict) and row.get("headline") and row.get("url") and row.get("datetime")
        and start <= datetime.fromtimestamp(row["datetime"], UTC).date() <= end
    ]


def sec_submissions(cik: int, agent: str, start: date, end: date) -> tuple[list[dict], list[dict]]:
    payload = json.loads(fetch(f"https://data.sec.gov/submissions/CIK{cik:010d}.json", agent))
    recent = payload["filings"]["recent"]
    filings = []
    latest_reports = []
    for i, filed in enumerate(recent["filingDate"]):
        form = recent["form"][i]
        accession = recent["accessionNumber"][i]
        primary = recent["primaryDocument"][i]
        record = {
            "form": form,
            "filed_at": filed,
            "report_date": recent["reportDate"][i],
            "accession_number": accession,
            "url": f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession.replace('-', '')}/{quote(primary)}",
        }
        if start.isoformat() <= filed <= end.isoformat():
            filings.append(record)
        if form in ("10-K", "10-Q") and filed <= end.isoformat() and len(latest_reports) < 2:
            latest_reports.append(record)
    return filings, latest_reports


def financial_facts(payload: dict, end: date) -> dict:
    facts = payload.get("facts", {}).get("us-gaap", {})
    selected = {}
    history = {}
    earliest = (end - timedelta(days=5 * 366)).isoformat()
    for tag in FINANCIAL_TAGS:
        if tag not in facts:
            continue
        observations = []
        historical = []
        for unit, rows in facts[tag].get("units", {}).items():
            for row in rows:
                if (row.get("form") in ("10-K", "10-Q") and
                        row.get("end", "") <= end.isoformat() and
                        row.get("filed", "9999") <= end.isoformat()):
                    fact = {**{key: row[key] for key in ("val", "start", "end", "filed", "form", "accn", "fy", "fp", "frame") if key in row}, "unit": unit}
                    observations.append(fact)
                    if row.get("end", "") >= earliest:
                        historical.append(fact)
        if observations:
            selected[tag] = max(observations, key=lambda row: (row["end"], row["filed"], row.get("start", "")))
        if historical:
            historical.sort(key=lambda row: (row["end"], row["filed"], row.get("start", ""), row.get("accn", "")))
            history[tag] = list({(row.get("accn"), row.get("start"), row["end"], row["unit"], row["val"]): row for row in historical}.values())
    return {"latest_reported_facts": selected, "historical_facts": history}


def sec_financials(cik: int, agent: str, end: date) -> dict:
    payload = json.loads(fetch(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json", agent))
    return {"cik": cik, "source": f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json", **financial_facts(payload, end)}


def fmp_transcript(symbol: str, key: str, end: date) -> dict | None:
    base = "https://financialmodelingprep.com/stable/"
    dates = json.loads(fetch(base + "earning-call-transcript-dates?" + urlencode({"symbol": symbol, "apikey": key}), "Shellhacks market research"))
    if not isinstance(dates, list):
        raise ValueError("FMP transcript dates require a subscription or returned an unexpected response")
    eligible = [row for row in dates if str(row.get("date", ""))[:10] <= end.isoformat()]
    if not eligible:
        return None
    ref = max(eligible, key=lambda row: str(row.get("date", "")))
    params = {"symbol": symbol, "year": ref.get("year"), "quarter": ref.get("quarter"), "apikey": key}
    transcript = json.loads(fetch(base + "earning-call-transcript?" + urlencode(params), "Shellhacks market research"))
    record = transcript[0] if isinstance(transcript, list) and transcript else transcript
    if not isinstance(record, dict) or not (record.get("content") or record.get("transcript")):
        raise ValueError("FMP did not provide transcript content for this subscription")
    return {
        "fiscal_year": ref.get("year"), "fiscal_quarter": ref.get("quarter"),
        "published_at": ref.get("date"), "source": "Financial Modeling Prep",
        "text": record.get("content") or record.get("transcript"),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--end-date", type=date.fromisoformat, default=datetime.now(UTC).date() - timedelta(days=1))
    parser.add_argument("--days", type=int, default=30, help="Calendar days of news and filings (default: 30)")
    parser.add_argument("--include-transcripts", action="store_true", help="Request FMP earnings transcripts (requires subscription access)")
    parser.add_argument("--newsdata-content", action="store_true", help="Request NewsData archive article content; requires NEWSDATA_API_KEY and storage rights")
    args = parser.parse_args()
    if not 1 <= args.days <= 365:
        parser.error("--days must be between 1 and 365")
    end = args.end_date
    start = end - timedelta(days=args.days - 1)
    sec_agent = credential("SEC_USER_AGENT")
    fmp_key = credential("FMP_API_KEY") if args.include_transcripts else ""
    finnhub_key = credential("FINNHUB_API_KEY")
    newsdata_key = credential("NEWSDATA_API_KEY") if args.newsdata_content else ""
    if args.newsdata_content and not newsdata_key:
        parser.error("--newsdata-content requires NEWSDATA_API_KEY and permission to retain provider content")
    out = Path(__file__).resolve().parent / "data" / f"{start}_to_{end}" / "companies"
    out.mkdir(parents=True, exist_ok=True)
    cik_map = {}
    sec_mapping_error = None
    if sec_agent:
        try:
            mappings = json.loads(fetch("https://www.sec.gov/files/company_tickers.json", sec_agent))
            cik_map = {row["ticker"].upper(): int(row["cik_str"]) for row in mappings.values()}
        except (OSError, ValueError, KeyError, TypeError) as exc:
            sec_mapping_error = f"SEC ticker lookup failed: {exc}"

    summary = {}
    for symbol, (name, query) in COMPANIES.items():
        record = {
            "company": name, "symbol": symbol,
            "date_range_utc": {"start": start.isoformat(), "end": end.isoformat()},
            "retrieved_at_utc": datetime.now(UTC).isoformat(),
            "news_source": "Google News RSS (headline metadata, not full article text)",
            "news": [], "sec_filings_in_window": [], "latest_sec_reports": [],
            "financials": None, "latest_earnings_transcript": None, "unavailable": {},
        }
        try:
            if finnhub_key:
                try:
                    record["news"] = finnhub_news(symbol.replace("-", "."), finnhub_key, start, end)
                    record["news_source"] = "Finnhub company news (headline and supplied summary)"
                except (OSError, ValueError, KeyError, TypeError) as exc:
                    # HTTP errors may contain the Finnhub token in their URL.
                    record["unavailable"]["finnhub"] = f"Finnhub request failed ({type(exc).__name__}); using public RSS"
                    record["news"] = news(query, start, end)
            else:
                record["news"] = news(query, start, end)
        except (OSError, ValueError, ET.ParseError) as exc:
            record["unavailable"]["news"] = str(exc)
        if newsdata_key:
            try:
                import httpx
                from data_aggregation.market_data.newsdata import NewsDataClient

                with httpx.Client(timeout=25) as http:
                    articles = NewsDataClient(newsdata_key, http).search_archive(
                        query=query, from_date=start.isoformat(), to_date=end.isoformat(), max_articles=500,
                    )
                existing = {item["url"] for item in record["news"]}
                for article in articles:
                    if not article.link or not start <= article.published_at.date() <= end:
                        continue
                    item = {"title": article.title, "url": article.link,
                            "publisher": article.source_name, "published_at_utc": article.published_at.isoformat(),
                            "summary": article.description, "content": article.content,
                            "content_scope": "provider article content" if article.content else "headline and optional publisher abstract",
                            "provider": "NewsData.io", "provider_id": article.article_id}
                    if article.link in existing:
                        record["news"] = [row for row in record["news"] if row["url"] != article.link]
                    record["news"].append(item)
                    existing.add(article.link)
            except (ImportError, OSError, ValueError, RuntimeError) as exc:
                record["unavailable"]["newsdata"] = f"NewsData archive unavailable ({type(exc).__name__}); existing headlines retained"
        if not sec_agent:
            record["unavailable"]["sec_filings_and_financials"] = "Set SEC_USER_AGENT to an identifiable organization and contact email, per SEC fair-access guidance"
        elif sec_mapping_error or symbol not in cik_map:
            record["unavailable"]["sec_filings_and_financials"] = sec_mapping_error or "No SEC ticker mapping"
        else:
            try:
                cik = cik_map[symbol]
                record["cik"] = cik
                record["sec_filings_in_window"], record["latest_sec_reports"] = sec_submissions(cik, sec_agent, start, end)
                time.sleep(0.2)
                record["financials"] = sec_financials(cik, sec_agent, end)
                time.sleep(0.2)
            except (OSError, ValueError, KeyError, TypeError) as exc:
                record["unavailable"]["sec_filings_and_financials"] = str(exc)
        if not args.include_transcripts:
            record["unavailable"]["earnings_transcript"] = "Skipped by default; use --include-transcripts to request FMP transcripts"
        elif not fmp_key:
            record["unavailable"]["earnings_transcript"] = "Set FMP_API_KEY with transcript subscription access"
        else:
            try:
                record["latest_earnings_transcript"] = fmp_transcript(symbol, fmp_key, end)
            except (OSError, ValueError, KeyError, TypeError) as exc:
                # HTTP errors include the request URL, which contains the FMP API key.
                reason = f"HTTP {exc.code}" if isinstance(exc, HTTPError) else type(exc).__name__
                record["unavailable"]["earnings_transcript"] = f"FMP request failed ({reason}); check key and subscription"
        (out / f"{symbol}.json").write_text(json.dumps(record, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
        summary[symbol] = {"news": len(record["news"]), "filings": len(record["sec_filings_in_window"]), "financials": bool(record["financials"]), "transcript": bool(record["latest_earnings_transcript"]), "unavailable": record["unavailable"]}
    (out / "manifest.json").write_text(json.dumps({"date_range_utc": {"start": start.isoformat(), "end": end.isoformat()}, "companies": summary}, indent=2) + "\n", encoding="utf-8")
    print(f"Saved {len(summary)} company files to {out}")
    print("News articles:", {symbol: row["news"] for symbol, row in summary.items()})


if __name__ == "__main__":
    main()
