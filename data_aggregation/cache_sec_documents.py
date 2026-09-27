"""Cache SEC filing text and source-linked chunks for offline demo retrieval."""

import argparse
import hashlib
import json
import re
import time
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError

from data_aggregation.aggregate_companies import credential, fetch


class VisibleText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("script", "style"):
            self.hidden += 1
        elif tag in ("p", "br", "div", "tr", "h1", "h2", "h3"):
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style"):
            self.hidden = max(0, self.hidden - 1)
        elif tag in ("p", "div", "tr"):
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.hidden:
            self.parts.append(data)


def extract(payload: bytes) -> str:
    parser = VisibleText()
    parser.feed(payload.decode("utf-8", errors="replace"))
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+", " ", "".join(parser.parts))).strip()


def chunks(text: str, size: int = 2000, overlap: int = 200) -> list[dict]:
    return [{"index": i, "start": start, "end": min(start + size, len(text)),
             "text": text[start:start + size]}
            for i, start in enumerate(range(0, len(text), size - overlap))
            if start < len(text)]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", help="Date-window folder name")
    args = parser.parse_args()
    agent = credential("SEC_USER_AGENT")
    if not agent:
        parser.error("SEC_USER_AGENT with organization and contact email is required")
    snapshot = Path(__file__).resolve().parent / "data" / args.snapshot
    output = snapshot / "sec_documents"
    output.mkdir(parents=True, exist_ok=True)
    records = []
    seen = set()
    for path in sorted((snapshot / "companies").glob("*.json")):
        if path.name == "manifest.json":
            continue
        company = json.loads(path.read_text(encoding="utf-8"))
        # Latest annual/quarterly report supplements the week, even if filed earlier.
        filings = company.get("sec_filings_in_window", []) + company.get("latest_sec_reports", [])[:1]
        for filing in filings:
            url = filing["url"]
            if url in seen:
                continue
            seen.add(url)
            record = {"holding": company["symbol"], "form": filing["form"],
                      "filed_at": filing["filed_at"], "source_url": url,
                      "accession_number": filing["accession_number"]}
            try:
                payload = fetch(url, agent)
                if len(payload) > 8_000_000:
                    raise ValueError("Document exceeds 8 MB extraction limit")
                text = extract(payload)
                if not text:
                    raise ValueError("No text extracted")
                document_id = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
                target = output / f"{company['symbol']}-{document_id}.json"
                original = output / f"{company['symbol']}-{document_id}.source"
                original.write_bytes(payload)
                chunk_rows = chunks(text)
                target.write_text(json.dumps({"document_id": document_id, "source_url": url,
                                               "original_path": original.relative_to(snapshot).as_posix(),
                                               "original_sha256": hashlib.sha256(payload).hexdigest(),
                                               "text_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                                               "extraction_method": "HTMLParser visible text", "text": text,
                                               "chunks": chunk_rows}, ensure_ascii=True) + "\n", encoding="utf-8")
                record.update({"status": "text cached; not embedded", "document_id": document_id,
                               "path": target.relative_to(snapshot).as_posix(),
                               "original_path": original.relative_to(snapshot).as_posix(),
                               "original_sha256": hashlib.sha256(payload).hexdigest(), "chunks": len(chunk_rows)})
            except (HTTPError, URLError, TimeoutError, ValueError, UnicodeError) as exc:
                record.update({"status": "unavailable", "reason": type(exc).__name__})
            records.append(record)
            time.sleep(0.2)
    manifest = {"retrieved_at_utc": datetime.now(UTC).isoformat(), "documents": records,
                "embedding_status": "not configured; text chunks only"}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Cached {sum(row['status'].startswith('text cached') for row in records)}/{len(records)} SEC documents in {output}")


if __name__ == "__main__":
    main()
