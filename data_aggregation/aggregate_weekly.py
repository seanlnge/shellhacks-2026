"""Collect a rolling window of daily market prices as JSON."""

import argparse
import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


ASSETS = {
    "companies": {
        "Apple": "AAPL",
        "Google (Alphabet)": "GOOGL",
        "General Electric": "GE",
        "Berkshire Hathaway Class B": "BRK-B",
        "Broadcom": "AVGO",
        "Nvidia": "NVDA",
        "Hilton": "HLT",
    },
    "indices": {
        "S&P 500": "^GSPC",
        "Nasdaq-100": "^NDX",
        "Dow Jones Industrial Average": "^DJI",
        "10-year Treasury yield index": "^TNX",
        "US Dollar Index (DXY)": "DX-Y.NYB",
    },
    "real_estate_etfs": {
        "Vanguard Real Estate ETF": "VNQ",
        "Real Estate Select Sector SPDR Fund": "XLRE",
        "Pacer Data & Infrastructure Real Estate ETF": "SRVR",
        "Pacer Industrial Real Estate ETF": "INDS",
        "iShares Residential and Multisector Real Estate ETF": "REZ",
        "iShares Mortgage Real Estate ETF": "REM",
    },
}


def fetch_asset(name: str, symbol: str, start: date, end: date) -> dict:
    start_time = datetime.combine(start, datetime.min.time(), UTC)
    end_time = datetime.combine(end + timedelta(days=1), datetime.min.time(), UTC)
    url = "https://query1.finance.yahoo.com/v8/finance/chart/" + quote(symbol, safe="")
    url += "?" + urlencode(
        {
            "period1": int(start_time.timestamp()),
            "period2": int(end_time.timestamp()),
            "interval": "1d",
        }
    )
    request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(request, timeout=20) as response:
        chart = json.load(response)["chart"]
    if chart["error"] or not chart["result"]:
        raise ValueError(f"Yahoo Finance returned: {chart['error']}")

    result = chart["result"][0]
    quote_data = result["indicators"]["quote"][0]
    adjusted = result["indicators"].get("adjclose", [{}])[0].get("adjclose", [])
    bars = []
    for i, timestamp in enumerate(result.get("timestamp", [])):
        day = datetime.fromtimestamp(timestamp, UTC).date()
        if not start <= day <= end or quote_data["close"][i] is None:
            continue
        bar = {"date": day.isoformat()}
        for field in ("open", "high", "low", "close", "volume"):
            value = quote_data[field][i]
            bar[field] = round(value, 6) if isinstance(value, float) else value
        value = adjusted[i] if i < len(adjusted) else None
        bar["adjusted_close"] = round(value, 6) if value is not None else None
        bars.append(bar)

    if not bars:
        raise ValueError("No daily bars in the requested date range")
    bars.sort(key=lambda bar: bar["date"])
    first_open = bars[0]["open"]
    last_close = bars[-1]["close"]
    return {
        "name": name,
        "symbol": symbol,
        "currency": result["meta"].get("currency"),
        "unit": "yield percent (Yahoo ^TNX quote)" if symbol == "^TNX" else "index points" if symbol.startswith("^") or symbol == "DX-Y.NYB" else "price",
        "weekly": {
            "first_trading_date": bars[0]["date"],
            "last_trading_date": bars[-1]["date"],
            "open": first_open,
            "high": max(bar["high"] for bar in bars if bar["high"] is not None),
            "low": min(bar["low"] for bar in bars if bar["low"] is not None),
            "close": last_close,
            "open_to_close_change_percent": round((last_close / first_open - 1) * 100, 4) if first_open else None,
            "volume": sum(bar["volume"] or 0 for bar in bars) if any(bar["volume"] is not None for bar in bars) else None,
            "trading_days": len(bars),
        },
        "daily": bars,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--end-date", type=date.fromisoformat, default=datetime.now(UTC).date() - timedelta(days=1), help="Last included UTC date (YYYY-MM-DD); defaults to yesterday")
    parser.add_argument("--days", type=int, default=30, help="Completed calendar dates to include (default: 30)")
    args = parser.parse_args()
    if args.days < 1:
        parser.error("--days must be positive")
    end = args.end_date
    start = end - timedelta(days=args.days - 1)
    result = {
        "source": "Yahoo Finance public chart endpoint",
        "retrieved_at_utc": datetime.now(UTC).isoformat(),
        "date_range_utc": {"start": start.isoformat(), "end": end.isoformat()},
        "frequency": f"daily trading bars over {args.days} completed calendar dates; weekly field summarizes the entire window from first open to last close",
        "assets": {},
        "errors": [],
    }
    for group, symbols in ASSETS.items():
        result["assets"][group] = []
        for name, symbol in symbols.items():
            try:
                result["assets"][group].append(fetch_asset(name, symbol, start, end))
            except (HTTPError, URLError, TimeoutError, ValueError, KeyError, IndexError) as exc:
                result["errors"].append({"symbol": symbol, "error": str(exc)})

    output_dir = Path(__file__).resolve().parent / "data" / f"{start}_to_{end}"
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / "weekly_market_data.json"
    output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"Saved {sum(map(len, result['assets'].values()))} assets to {output}")
    if result["errors"]:
        print(f"Failed symbols: {result['errors']}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
