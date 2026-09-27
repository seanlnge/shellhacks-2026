"""Cache public macro/crypto series and optional Finnhub demo calendars."""

import argparse
import csv
import io
import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode

from data_aggregation.aggregate_companies import credential, fetch


FRED_SERIES = {"DGS10": "10-year Treasury constant maturity rate", "FEDFUNDS": "Effective federal funds rate", "CPIAUCSL": "Consumer Price Index, all urban consumers"}
CRYPTO = {"bitcoin": "BTC", "ethereum": "ETH"}


def fred_series(series: str, start: date, end: date) -> list[dict]:
    url = "https://fred.stlouisfed.org/graph/fredgraph.csv?" + urlencode(
        {"id": series, "cosd": start.isoformat(), "coed": end.isoformat()}
    )
    rows = csv.DictReader(io.StringIO(fetch(url, "Mozilla/5.0").decode("utf-8-sig")))
    return [{"date": row["observation_date"], "value": float(row[series])}
            for row in rows if row.get(series) not in (None, "", ".")]


def crypto_series(asset_id: str, start: date, end: date) -> list[dict]:
    from_time = int(datetime.combine(start, datetime.min.time(), UTC).timestamp())
    to_time = int(datetime.combine(end + timedelta(days=1), datetime.min.time(), UTC).timestamp())
    url = f"https://api.coingecko.com/api/v3/coins/{asset_id}/market_chart/range?" + urlencode(
        {"vs_currency": "usd", "from": from_time, "to": to_time}
    )
    payload = json.loads(fetch(url, "Shellhacks demo data cache"))
    by_day = {}
    for timestamp, price in payload["prices"]:
        instant = datetime.fromtimestamp(timestamp / 1000, UTC)
        day = instant.date().isoformat()
        if start.isoformat() <= day <= end.isoformat():
            by_day[day] = {"date": day, "price_usd": price, "observed_at_utc": instant.isoformat()}
    return [by_day[day] for day in sorted(by_day)]


def finnhub_calendar(kind: str, start: date, end: date, token: str) -> list[dict]:
    url = f"https://finnhub.io/api/v1/calendar/{kind}?" + urlencode(
        {"from": start.isoformat(), "to": end.isoformat(), "token": token}
    )
    payload = json.loads(fetch(url, "Shellhacks demo data cache"))
    key = "ipoCalendar" if kind == "ipo" else "earningsCalendar"
    if not isinstance(payload.get(key), list):
        raise ValueError("Finnhub calendar response missing rows")
    return payload[key]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", help="Date-window folder name")
    args = parser.parse_args()
    snapshot = Path(__file__).resolve().parent / "data" / args.snapshot
    prices = json.loads((snapshot / "weekly_market_data.json").read_text(encoding="utf-8"))
    start = date.fromisoformat(prices["date_range_utc"]["start"])
    end = date.fromisoformat(prices["date_range_utc"]["end"])
    result = {"date_range_utc": prices["date_range_utc"], "retrieved_at_utc": datetime.now(UTC).isoformat(),
              "macro": {}, "crypto": {}, "calendars": {}, "private_funds": {}, "sources": {}}
    for series, title in FRED_SERIES.items():
        # CPI and the funds rate are monthly, so fetch enough history for the latest observation.
        beginning = start - timedelta(days=100) if series != "DGS10" else start
        try:
            observations = fred_series(series, beginning, end)
            result["macro"][series] = {"title": title, "observations": observations,
                                       "source_url": f"https://fred.stlouisfed.org/series/{series}",
                                       "last_observation": observations[-1] if observations else None}
            result["sources"][f"fred_{series}"] = "cached" if observations else "no observations"
        except (HTTPError, URLError, TimeoutError, ValueError, KeyError) as exc:
            result["sources"][f"fred_{series}"] = f"unavailable ({type(exc).__name__})"
    for asset_id, ticker in CRYPTO.items():
        try:
            observations = crypto_series(asset_id, start, end)
            result["crypto"][ticker] = {"asset_id": asset_id, "daily": observations,
                                        "source_url": f"https://www.coingecko.com/en/coins/{asset_id}"}
            result["sources"][f"coingecko_{ticker}"] = "cached" if observations else "no observations"
        except (HTTPError, URLError, TimeoutError, ValueError, KeyError) as exc:
            result["sources"][f"coingecko_{ticker}"] = f"unavailable ({type(exc).__name__})"
    token = credential("FINNHUB_API_KEY")
    for kind in ("ipo", "earnings"):
        if not token:
            result["sources"][f"finnhub_{kind}"] = "not configured (FINNHUB_API_KEY)"
            continue
        try:
            rows = finnhub_calendar(kind, start, end, token)
            result["calendars"][kind] = rows
            result["sources"][f"finnhub_{kind}"] = "cached"
        except (HTTPError, URLError, TimeoutError, ValueError, KeyError) as exc:
            # Do not serialize HTTPError URLs: Finnhub puts the token in the query string.
            result["sources"][f"finnhub_{kind}"] = f"unavailable ({type(exc).__name__})"
    for fund in ("BREIT", "BCRED"):
        result["private_funds"][fund] = {"nav": None, "distribution": None, "as_of": None,
                                          "source_url": None, "status": "awaiting verified published or manual source"}
    sec_manifest = snapshot / "sec_documents" / "manifest.json"
    sec_cached = 0
    if sec_manifest.exists():
        sec_cached = sum(bool(row.get("path")) for row in json.loads(sec_manifest.read_text(encoding="utf-8"))["documents"])
    result["sources"].update({"sec_filings": f"cached metadata and {sec_cached} document texts/chunks; embeddings not configured",
                              "sec_companyfacts": "cached", "prices": "cached Yahoo Finance daily",
                              "news": "cached Google News RSS; Finnhub news needs FINNHUB_API_KEY",
                              "portfolio": "see local SQLite sample portfolio"})
    output = snapshot / "demo_sources.json"
    output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"Saved public-source cache to {output}")
    print("Availability:", result["sources"])


if __name__ == "__main__":
    main()
