import re
from hashlib import sha256

from .models import DocumentChunk


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def content_hash(bytes_or_text: bytes | str) -> str:
    payload = bytes_or_text.encode("utf-8") if isinstance(bytes_or_text, str) else bytes_or_text
    return sha256(payload).hexdigest()


def _detect_section(chunk_text_value: str) -> str | None:
    for raw_line in chunk_text_value.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.isupper() and len(line) <= 80:
            return line
        break
    return None


def chunk_text(text: str, max_chars: int = 1800, overlap_chars: int = 200) -> list[DocumentChunk]:
    if max_chars <= 0:
        raise ValueError("max_chars must be positive")
    if overlap_chars < 0 or overlap_chars >= max_chars:
        raise ValueError("overlap_chars must be non-negative and smaller than max_chars")

    chunks: list[DocumentChunk] = []
    cursor = 0
    token_cursor = 0
    document_id = content_hash(normalize_text(text))
    while cursor < len(text):
        end = min(cursor + max_chars, len(text))
        if end < len(text):
            boundary = text.rfind(" ", cursor, end)
            if boundary > cursor:
                end = boundary
        raw_chunk = text[cursor:end].strip()
        if raw_chunk:
            normalized_chunk = normalize_text(raw_chunk)
            token_count = len(normalized_chunk.split())
            chunks.append(
                DocumentChunk(
                    document_id=document_id,
                    chunk_index=len(chunks),
                    text=normalized_chunk,
                    section=_detect_section(raw_chunk),
                    token_start=token_cursor,
                    token_end=token_cursor + token_count,
                )
            )
            token_cursor += token_count
        if end == len(text):
            break
        cursor = max(end - overlap_chars, cursor + 1)
    return chunks
