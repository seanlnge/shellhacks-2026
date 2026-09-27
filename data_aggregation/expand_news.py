"""Expand cached company news with daily searches without refetching SEC data."""

import argparse
import json
from datetime import date, datetime, UTC
from pathlib import Path
from urllib.error import HTTPError, URLError

from data_aggregation.aggregate_companies import COMPANIES, news


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", help="Existing date-window folder name")
    args = parser.parse_args()
    snapshot = Path(__file__).resolve().parent / "data" / args.snapshot
    directory = snapshot / "companies"
    manifest_path = directory / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    start = date.fromisoformat(manifest["date_range_utc"]["start"])
    end = date.fromisoformat(manifest["date_range_utc"]["end"])
    for symbol, (_, query) in COMPANIES.items():
        path = directory / f"{symbol}.json"
        record = json.loads(path.read_text(encoding="utf-8"))
        previous = {row["url"]: row for row in record["news"]}
        old_count = len(previous)
        try:
            expanded = news(query, start, end, window_days=1)
        except (HTTPError, URLError, TimeoutError, ValueError) as exc:
            # A failed search must not discard previously cached articles.
            manifest["companies"][symbol]["unavailable"]["news_expansion"] = type(exc).__name__
            print(f"{symbol}: expansion unavailable ({type(exc).__name__}); kept {len(previous)} cached articles")
            manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
            continue
        previous.update({row["url"]: row for row in expanded})
        record["news"] = sorted(previous.values(), key=lambda row: row["published_at_utc"], reverse=True)
        record["retrieved_at_utc"] = datetime.now(UTC).isoformat()
        record["news_source"] = "Google News RSS (daily sliced headline metadata; not full article text)"
        record["unavailable"].pop("news_expansion", None)
        path.write_text(json.dumps(record, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
        manifest["companies"][symbol]["news"] = len(record["news"])
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        print(f"{symbol}: {len(record['news'])} articles (+{len(record['news']) - old_count})", flush=True)


if __name__ == "__main__":
    main()
