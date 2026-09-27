"""Offline portfolio event normalization and story ranking from collected JSON."""

import argparse
import json
import math
import re
import sqlite3
from datetime import UTC, date, datetime
from pathlib import Path


DATA_DIR = Path(__file__).resolve().parent / "data"
KINDS = {"filing", "news", "price", "macro", "corporate_action"}
MATERIALITY = {"filing": 1.3, "news": 1.0, "price": 1.0, "macro": 0.8, "corporate_action": 1.2}
STOPWORDS = {"a", "an", "and", "as", "at", "by", "for", "from", "in", "is", "of", "on", "the", "to", "with", "stock", "shares", "inc", "corp", "company"}


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def save(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=True, allow_nan=False) + "\n", encoding="utf-8")


def portfolio_command(args: argparse.Namespace) -> None:
    path = DATA_DIR / "portfolio.json"
    holdings = load(path) if path.exists() else {}
    if args.action == "set":
        if not math.isfinite(args.weight) or args.weight <= 0 or args.weight > 1:
            raise ValueError("weight must be greater than 0 and at most 1")
        holdings[args.ticker.upper()] = args.weight
        save(path, holdings)
    elif args.action == "remove":
        holdings.pop(args.ticker.upper(), None)
        save(path, holdings)
    print(json.dumps(holdings, indent=2))


def event(holding: str, kind: str, ts: str, url: str, text: str, **extra: object) -> dict:
    assert kind in KINDS
    return {"holding": holding, "type": kind, "ts": ts, "source_url": url, "raw_text": text, **extra}


def normalize(snapshot: Path, holdings: dict[str, float] | None = None) -> list[dict]:
    items = []
    companies = snapshot / "companies"
    sec_manifest = snapshot / "sec_documents" / "manifest.json"
    documents = {row["source_url"]: row for row in load(sec_manifest)["documents"]} if sec_manifest.exists() else {}
    prices = snapshot / "weekly_market_data.json"
    if prices.exists():
        for asset_class, group in load(prices)["assets"].items():
            for asset in group:
                symbol = asset["symbol"]
                if holdings is not None and symbol not in holdings:
                    continue
                for day in asset["daily"]:
                    if day["open"] is None or day["close"] is None:
                        continue
                    move = round((day["close"] / day["open"] - 1) * 100, 4) if day["open"] else 0
                    items.append(event(symbol, "price", day["date"] + "T00:00:00+00:00", "https://finance.yahoo.com/quote/" + symbol, f"{symbol} open {day['open']}, close {day['close']}, change {move}%", date_precision="day", source="Yahoo Finance", asset_class=asset_class, currency=asset["currency"], unit=asset["unit"], price_move_percent=move, key_numbers={"open": day["open"], "high": day["high"], "low": day["low"], "close": day["close"], "adjusted_close": day["adjusted_close"], "change_percent": move, "volume": day["volume"]}))
    symbols = holdings if holdings is not None else {path.stem: 1 for path in companies.glob("*.json") if path.name != "manifest.json"}
    for symbol in symbols:
        path = companies / f"{symbol}.json"
        if not path.exists():
            continue
        record = load(path)
        for article in record.get("news", []):
            text = article["title"] + (". " + article["summary"] if article.get("summary") else "")
            items.append(event(symbol, "news", article["published_at_utc"], article["url"], text, source=record["news_source"], content_scope="headline and optional publisher abstract", publisher=article.get("publisher")))
        for filing in record.get("sec_filings_in_window", []):
            document = documents.get(filing["url"], {})
            items.append(event(symbol, "filing", filing["filed_at"] + "T00:00:00+00:00", filing["url"], f"{symbol} filed {filing['form']} (report date {filing['report_date']})", date_precision="day", source="SEC EDGAR submissions", content_scope="filing metadata; extracted body available via document_path" if document.get("path") else "filing metadata only", document_id=document.get("document_id"), document_path=document.get("path"), key_numbers={"form": filing["form"], "report_date": filing["report_date"], "accession_number": filing["accession_number"]}))
    price_days = {(row["holding"], row["ts"][:10]): row["price_move_percent"] for row in items if row["type"] == "price"}
    for row in items:
        if row["type"] != "price":
            row["price_move_percent"] = price_days.get((row["holding"], row["ts"][:10]), 0)
    return sorted(items, key=lambda row: row["ts"], reverse=True)


def parse_snapshot(snapshot: Path) -> dict:
    prices = load(snapshot / "weekly_market_data.json")
    sec_manifest = snapshot / "sec_documents" / "manifest.json"
    sec_documents = load(sec_manifest)["documents"] if sec_manifest.exists() else []
    metrics_path = snapshot / "financial_metrics.json"
    market_metrics = load(metrics_path)["metrics"] if metrics_path.exists() else {}
    weekly_assets = [
        {"holding": asset["symbol"], "name": asset["name"], "asset_class": group,
         "currency": asset["currency"], "unit": asset["unit"], **asset["weekly"]}
        for group, assets in prices["assets"].items() for asset in assets
    ]
    financials = []
    latest_reports = []
    end = date.fromisoformat(prices["date_range_utc"]["end"])
    for path in sorted((snapshot / "companies").glob("*.json")):
        if path.name == "manifest.json":
            continue
        company = load(path)
        symbol = company["symbol"]
        for report in company.get("latest_sec_reports", []):
            latest_reports.append({"holding": symbol, **report})
        data = company.get("financials") or {}
        for tag, fact in data.get("latest_reported_facts", {}).items():
            period_end = date.fromisoformat(fact["end"])
            financials.append({
                "holding": symbol, "cik": data["cik"], "tag": tag,
                "value": fact["val"], "unit": fact["unit"],
                "period_start": fact.get("start"), "period_end": fact["end"],
                "filed_at": fact["filed"], "form": fact["form"],
                "accession_number": fact.get("accn"), "source_url": data["source"],
                "older_than_two_years": (end - period_end).days > 730,
            })
    events = normalize(snapshot)
    counts = {kind: sum(item["type"] == kind for item in events) for kind in ("price", "news", "filing")}
    return {
        "date_range_utc": prices["date_range_utc"],
        "parsed_at_utc": datetime.now(UTC).isoformat(),
        "counts": {**counts, "weekly_assets": len(weekly_assets), "financial_facts": len(financials), "latest_sec_reports": len(latest_reports), "market_metrics": len(market_metrics), "sec_documents_cached": sum(bool(row.get("path")) for row in sec_documents)},
        "events": events,
        "weekly_assets": weekly_assets,
        "market_metrics": market_metrics,
        "sec_documents": sec_documents,
        "financial_facts": financials,
        "latest_sec_reports": latest_reports,
        "limitations": ["News is search-result headline metadata, not verified full-text coverage", "SEC filing event text is metadata; downloaded filing bodies and chunks are stored separately and are not embedded", "Financial facts are the latest available per tag, not necessarily reported during the requested week", "Market cap and P/E from FMP are retrieval-time figures, not historical as-of-week values", "Earnings transcripts were skipped"],
    }


def tokens(text: str) -> set[str]:
    return {word for word in re.findall(r"[a-z0-9]+", text.lower()) if word not in STOPWORDS and len(word) > 2}


def cluster(events: list[dict]) -> list[list[dict]]:
    groups: list[list[dict]] = []
    for row in events:
        if row["type"] != "news":
            groups.append([row])
            continue
        row_tokens = tokens(row["raw_text"])
        row_date = datetime.fromisoformat(row["ts"])
        for group in groups:
            anchor = group[0]
            if anchor["type"] != "news" or anchor["holding"] != row["holding"]:
                continue
            if abs((datetime.fromisoformat(anchor["ts"]) - row_date).total_seconds()) > 48 * 3600:
                continue
            # Lexical similarity is a local fallback until an embedding service is configured.
            other = tokens(anchor["raw_text"])
            similarity = len(row_tokens & other) / len(row_tokens | other) if row_tokens | other else 0
            if similarity >= 0.5:
                group.append(row)
                break
        else:
            groups.append([row])
    return groups


def stories(events: list[dict], holdings: dict[str, float], limit: int, reference: datetime) -> list[dict]:
    ranked = []
    for group in cluster(events):
        first = group[0]
        hours = max(0, (reference - datetime.fromisoformat(first["ts"])).total_seconds() / 3600)
        recency = 1 / (1 + hours / 48)
        move = abs(first.get("price_move_percent", 0))
        score = MATERIALITY[first["type"]] * holdings[first["holding"]] * recency * (1 + move / 100)
        headlines = list(dict.fromkeys(row["raw_text"] for row in group))
        ranked.append({
            "holding": first["holding"], "type": first["type"], "ts": first["ts"],
            "score": round(score, 8), "headline": headlines[0],
            "summary_3_lines": headlines[:3],
            "expanded_summary": " | ".join(headlines[:10]),
            "key_numbers": first.get("key_numbers", {}),
            "source_urls": list(dict.fromkeys(row["source_url"] for row in group)),
            "event_count": len(group),
            "summary_basis": "source headlines, supplied abstracts, or price bars only; no full article bodies or generated claims",
        })
    return sorted(ranked, key=lambda row: row["score"], reverse=True)[:limit]


def run(args: argparse.Namespace) -> None:
    if args.portfolio:
        database = DATA_DIR / "portfolios.sqlite3"
        if not database.exists():
            raise ValueError("No portfolio database. Seed it with: python -m data_aggregation.portfolio_db seed")
        with sqlite3.connect(database) as db:
            rows = db.execute("SELECT h.asset_id, h.weight FROM holdings h JOIN portfolios p ON p.id = h.portfolio_id WHERE p.name = ?", (args.portfolio,)).fetchall()
        holdings = dict(rows)
    else:
        holdings_path = DATA_DIR / "portfolio.json"
        if not holdings_path.exists():
            raise ValueError("No portfolio configured. Use: pipeline.py portfolio set TICKER WEIGHT or run --portfolio NAME")
        holdings = load(holdings_path)
    if not holdings or any(not isinstance(weight, (int, float)) or isinstance(weight, bool) or not math.isfinite(weight) or weight <= 0 for weight in holdings.values()):
        raise ValueError("Portfolio must contain positive numeric weights")
    if sum(holdings.values()) > 1.000001:
        raise ValueError("Portfolio weights must sum to at most 1")
    snapshot = DATA_DIR / args.snapshot
    if not snapshot.is_dir():
        raise ValueError(f"Snapshot does not exist: {snapshot}")
    start, end = args.snapshot.split("_to_")
    reference = datetime.fromisoformat(end + "T23:59:59+00:00")
    events = normalize(snapshot, holdings)
    output = {"window": {"start": start, "end": end}, "generated_at_utc": datetime.now(UTC).isoformat(), "portfolio": args.portfolio, "holdings": holdings, "events": events, "top_stories": stories(events, holdings, args.limit, reference), "limitations": ["News provides headlines and optional supplied abstracts; full article bodies are not collected", "Clustering uses lexical similarity, not embeddings", "No document chunks or pgvector index without a configured database and embedding model"]}
    destination = snapshot / "portfolio_events.json"
    save(destination, output)
    print(f"Saved {len(events)} events and {len(output['top_stories'])} stories to {destination}")


def parse_command(args: argparse.Namespace) -> None:
    snapshot = DATA_DIR / args.snapshot
    if not snapshot.is_dir():
        raise ValueError(f"Snapshot does not exist: {snapshot}")
    parsed = parse_snapshot(snapshot)
    output = snapshot / "parsed_data.json"
    save(output, parsed)
    print(f"Saved {len(parsed['events'])} events and {len(parsed['financial_facts'])} financial facts to {output}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    portfolio = commands.add_parser("portfolio")
    portfolio.add_argument("action", choices=("set", "remove", "list"))
    portfolio.add_argument("ticker", nargs="?")
    portfolio.add_argument("weight", type=float, nargs="?")
    produce = commands.add_parser("run")
    produce.add_argument("snapshot", help="Snapshot folder name, e.g. 2026-09-19_to_2026-09-25")
    produce.add_argument("--limit", type=int, default=20)
    produce.add_argument("--portfolio", help="Use a named portfolio from the local SQLite database")
    parsed = commands.add_parser("parse", help="Normalize all collected data without portfolio weights")
    parsed.add_argument("snapshot", help="Snapshot folder name, e.g. 2026-09-19_to_2026-09-25")
    args = parser.parse_args()
    if args.command == "portfolio":
        if args.action != "list" and (not args.ticker or (args.action == "set" and args.weight is None)):
            parser.error("portfolio set requires TICKER WEIGHT; remove requires TICKER")
        portfolio_command(args)
    elif args.command == "parse":
        parse_command(args)
    else:
        if args.limit < 1:
            parser.error("--limit must be positive")
        run(args)


if __name__ == "__main__":
    main()
