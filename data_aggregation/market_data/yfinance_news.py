from datetime import UTC, datetime

from kalorie.market_data.tiingo import TiingoArticle


def collect_yfinance_news(
    *,
    company_symbol: str,
    company_name: str,
    from_date: str,
    to_date: str,
    max_articles: int,
) -> list[TiingoArticle]:
    try:
        import yfinance as yf
    except ImportError as exc:
        raise RuntimeError(
            "yfinance is not installed; install it to enable fallback news ingestion"
        ) from exc

    start = datetime.fromisoformat(from_date).date()
    end = datetime.fromisoformat(to_date).date()
    search_queries = [company_symbol.upper(), f"{company_name} earnings"]
    by_article_id: dict[str, TiingoArticle] = {}
    for query in search_queries:
        try:
            rows = yf.Search(query, news_count=max_articles).news
        except Exception:
            continue
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            article_id = str(row.get("uuid") or row.get("id") or "").strip()
            title = str(row.get("title") or "").strip()
            link = str(row.get("link") or "").strip()
            publish_ts = row.get("providerPublishTime")
            if not article_id or not title or not link or not publish_ts:
                continue
            try:
                published_at = datetime.fromtimestamp(int(publish_ts), tz=UTC)
            except (TypeError, ValueError, OSError):
                continue
            if not start <= published_at.date() <= end:
                continue
            article = TiingoArticle(
                article_id=article_id,
                title=title,
                link=link,
                source_name=str(row.get("publisher") or "").strip() or "yfinance",
                description=str(row.get("summary") or "").strip() or None,
                datatype=str(row.get("type") or "story").strip().lower(),
                published_at=published_at,
                tickers=[str(value).upper() for value in row.get("relatedTickers", []) or []],
                tags=[],
            )
            by_article_id.setdefault(article_id, article)
            if len(by_article_id) >= max_articles:
                break
        if len(by_article_id) >= max_articles:
            break
    return sorted(by_article_id.values(), key=lambda row: row.published_at, reverse=True)[
        :max_articles
    ]
