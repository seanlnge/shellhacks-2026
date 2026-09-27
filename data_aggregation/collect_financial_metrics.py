"""Collect as-of-week valuation and distribution metrics for listed holdings."""

import argparse
import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode

from data_aggregation.aggregate_companies import credential, fetch


def year_chart(symbol: str, end: date) -> dict:
    start = datetime.combine(end - timedelta(days=365), datetime.min.time(), UTC)
    exclusive_end = datetime.combine(end + timedelta(days=1), datetime.min.time(), UTC)
    url = "https://query1.finance.yahoo.com/v8/finance/chart/" + quote(symbol, safe="")
    url += "?" + urlencode({"period1": int(start.timestamp()), "period2": int(exclusive_end.timestamp()), "interval": "1d", "events": "div"})
    result = json.loads(fetch(url, "Mozilla/5.0"))["chart"]["result"][0]
    bars = result["indicators"]["quote"][0]
    distributions = sorted(
        ({"date": datetime.fromtimestamp(row["date"], UTC).date().isoformat(), "amount": row["amount"]}
         for row in result.get("events", {}).get("dividends", {}).values()
         if datetime.fromtimestamp(row["date"], UTC).date() <= end),
        key=lambda row: row["date"],
    )
    return {"high": max(value for value in bars["high"] if value is not None),
            "low": min(value for value in bars["low"] if value is not None),
            "cash_distributions": distributions}


def quarterly_amount(distributions: list[dict]) -> float | None:
    if len(distributions) < 3:
        return None
    recent = distributions[-3:]
    intervals = [(date.fromisoformat(b["date"]) - date.fromisoformat(a["date"])).days for a, b in zip(recent, recent[1:])]
    return recent[-1]["amount"] if all(60 <= days <= 120 for days in intervals) else None


def fmp_data(symbol: str, key: str, endpoint: str) -> tuple[dict | None, str | None]:
    url = f"https://financialmodelingprep.com/stable/{endpoint}?" + urlencode({"symbol": symbol, "apikey": key})
    try:
        rows = json.loads(fetch(url, "Shellhacks market research"))
        if isinstance(rows, list) and rows and isinstance(rows[0], dict):
            return rows[0], None
        return None, f"FMP {endpoint} returned no usable records"
    except HTTPError as exc:
        return None, f"FMP {endpoint} HTTP {exc.code}"
    except (URLError, TimeoutError, ValueError):
        # Never expose a request URL containing the FMP key.
        return None, f"FMP {endpoint} request failed"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", help="Date-window folder name")
    args = parser.parse_args()
    snapshot = Path(__file__).resolve().parent / "data" / args.snapshot
    prices = json.loads((snapshot / "weekly_market_data.json").read_text(encoding="utf-8"))
    end = date.fromisoformat(prices["date_range_utc"]["end"])
    key = credential("FMP_API_KEY")
    metrics = {}
    for group, assets in prices["assets"].items():
        for asset in assets:
            symbol = asset["symbol"]
            row = {
                "symbol": symbol, "asset_class": group, "as_of": asset["weekly"]["last_trading_date"],
                "currency": asset["currency"], "market_price": asset["weekly"]["close"],
                "market_price_source": "Yahoo Finance last trading close",
                "market_cap": None, "market_cap_source": None,
                "pe_ratio": None, "pe_ratio_source": None,
                "dividend_history": [], "latest_dividend_amount": None,
                "latest_quarterly_dividend_amount": None,
                "fifty_two_week_high": None, "fifty_two_week_low": None,
                "notes": [],
            }
            try:
                annual = year_chart(symbol, end)
                row["fifty_two_week_high"] = annual["high"]
                row["fifty_two_week_low"] = annual["low"]
                row["dividend_history"] = annual["cash_distributions"]
                if annual["cash_distributions"]:
                    row["latest_dividend_amount"] = annual["cash_distributions"][-1]["amount"]
                    row["latest_quarterly_dividend_amount"] = quarterly_amount(annual["cash_distributions"])
                row["fifty_two_week_source"] = "Yahoo Finance daily highs/lows for trailing 365 calendar days"
            except (HTTPError, URLError, TimeoutError, ValueError, KeyError, IndexError) as exc:
                row["notes"].append(f"Annual chart unavailable ({type(exc).__name__})")
            if group == "companies":
                if key:
                    profile, error = fmp_data(symbol.replace("-", "."), key, "profile")
                    if profile:
                        market_cap = profile.get("marketCap") or profile.get("mktCap")
                        pe = profile.get("pe") or profile.get("priceEarningsRatio")
                        if isinstance(market_cap, (int, float)) and market_cap > 0:
                            row["market_cap"] = market_cap
                            row["market_cap_source"] = "FMP current company profile (retrieval-time value)"
                        if isinstance(pe, (int, float)) and pe > 0:
                            row["pe_ratio"] = pe
                            row["pe_ratio_source"] = "FMP current company profile (retrieval-time value)"
                    elif error:
                        row["notes"].append(error)
                    ratios, ratio_error = fmp_data(symbol.replace("-", "."), key, "ratios-ttm")
                    if ratios:
                        pe = ratios.get("priceToEarningsRatioTTM") or ratios.get("priceEarningsRatioTTM")
                        if isinstance(pe, (int, float)) and pe > 0:
                            row["pe_ratio"] = pe
                            row["pe_ratio_source"] = "FMP current trailing-twelve-month ratios (retrieval-time value)"
                    elif ratio_error:
                        row["notes"].append(ratio_error)
                if row["market_cap"] is None:
                    row["notes"].append("Market cap unavailable from accessible provider data")
                if row["pe_ratio"] is None:
                    row["notes"].append("P/E unavailable from accessible provider data")
            else:
                row["notes"].append("Market cap and P/E not applicable or not requested for this index/ETF")
            if group == "real_estate_etfs":
                row["notes"].append("Cash distributions may include capital gains or return of capital; not necessarily dividends")
            metrics[symbol] = row
    output = {"date_range_utc": prices["date_range_utc"], "retrieved_at_utc": datetime.now(UTC).isoformat(), "metrics": metrics}
    destination = snapshot / "financial_metrics.json"
    destination.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"Saved metrics for {len(metrics)} assets to {destination}")


if __name__ == "__main__":
    main()
