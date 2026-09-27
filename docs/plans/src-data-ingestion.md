# App data integration plan

## Goal and current boundary

Make the app answer questions from previously collected, source-linked news, filings, fundamentals and price history without contacting data providers during normal page load or UI generation. The offline collector lives in `data_aggregation/`; this plan is for `src/` and is not implemented yet. The existing `src_story`, `src_story_data` and `src_evidence` tables are story-oriented, and the current `evidence:import` imports headlines plus filtered SEC excerpts only. Check any in-progress `src/src/server/market/` and `/api/market-series` work before editing those areas.

## Offline inputs

- `weekly_market_data.json`: legacy filename; now a configurable event window (default 30 calendar days), with daily OHLCV/adjusted-close bars and a window summary.
- `price_history.json`: default 365 calendar days of daily bars for each collected asset, obtained from the same Yahoo chart response as the event window.
- `companies/{SYMBOL}.json`: up to 500 Google News RSS headlines per symbol (or Finnhub headlines/abstracts with `FINNHUB_API_KEY`); optional NewsData archive results when `--newsdata-content` and `NEWSDATA_API_KEY` are provided and content retention is permitted. Only a nonempty `content` field is article text. SEC `historical_facts` now preserves five years of tagged observations with periods, filing dates, forms, units and accession numbers; `latest_reported_facts` remains for older consumers.
- `sec_documents/manifest.json` and document JSON files: SEC URLs, extracted full visible text, chunk offsets, and, for new downloads, original source bytes in `.source` files with SHA-256 hashes. Existing snapshots lack originals and must be recollected if originals are required.
- `parsed_data.json`: normalized event metadata plus `news_articles`, `historical_financial_facts` and optional `price_history`. It is a transport artifact, not a license to infer full text from headlines.

The snapshot directory is gitignored. A deploy needs its own durable snapshot/object storage or an ingestion job; a local `parse` run alone never populates Postgres. The collectors still use a fixed demo asset list. For dynamic user holdings, parameterize the collectors and enqueue newly added symbols before promising their coverage.

## Phase 1: durable imports and provenance

1. Add versioned Drizzle migrations for `source_document` (stable provider ID/URL, asset key, type, content scope, published/fetched timestamps, content hash, extracted text and/or restricted object-store key, license/retention policy), `document_chunk` (document ID, ordinal, section/offsets, text), `price_bar` (asset, date, OHLCV, adjusted close, currency, provider and fetched time), and `financial_fact` (asset, tag, unit, value, period start/end, filing date, form, accession, frame and source URL). Use uniqueness on stable provider identifiers and `(asset, date, provider)` for bars; index asset/date and text search. Avoid storing large originals directly in the story bundle. Enforce holding-scoped access to originals and chunks.
2. Build one idempotent import command that validates snapshot manifests, paths, URL origins, hashes and units, and upserts rows transactionally by source/asset. Import article bodies only when the source actually provides them and retention is permitted. Import SEC original bytes into durable restricted storage, not a local path that will disappear at deploy. Continue importing chunks, but retain full visible text and original provenance. Mark missing, paywalled or truncated content explicitly.
3. Import the entire history file as per-asset price bars; do not derive prices from the `weekly` summary or duplicate a year's history inside every story. Import all eligible SEC historical observations, including conflicting/restated accession-linked values; do not choose a final quarterly series simply by taking the newest value per tag. Normalize duration vs instant facts, fiscal period, unit and later restatements in a separate derivation step.
4. Record an ingestion run with per-source coverage, errors, freshness and counts. Make reruns idempotent and fail visibly on incompatible snapshots instead of quietly serving partial coverage. Add integration tests for duplicate runs, changed articles, hash failures, adjusted vs raw close, restatements and unauthorized source access.

## Phase 2: retrieval and chart generation

1. Search local document chunks and story text using Postgres full-text search with asset/date/type filters and source diversity. News headlines and abstracts must retain their content-scope labels in both ranking and prompts. Return stable citations pointing to original URLs and optionally local source excerpts. Evaluate pgvector only if lexical search on the actual corpus proves inadequate; no embeddings are currently produced.
2. Build curated per-holding series from imported bars and period-correct SEC facts (closing price, volume, returns, revenue, EPS, margins, cash flow, debt, etc.), with provenance, currency, adjustments and as-of dates. Story bundles can reference these series rather than copying bars. For portfolio views, support multiple authorized holdings rather than anchoring every chart to one story.
3. Update `src/src/server/evidence/search.ts`, `src/src/server/generative/jev.ts`, `src/src/server/generative/compose.ts` and `/api/deepdive` to shortlist relevant sections/series across the corpus, diversify by source, and expose question-relevant metrics/series. Today the route retrieves 20 candidates and selects at most eight; the composer exposes the first 12 metrics and eight series. More stored data alone will not enrich output until these limits become relevance-based selections. Keep prompts bounded and enforce current citation and prompt-injection checks.
4. Update the story and market-series endpoints to resolve authenticated, holding-scoped references from DB; return clear `no data` and stale-as-of states. Preserve an immediate cached result while ingestion/refresh happens asynchronously.

## Phase 3: refresh and operational rules

- Run incremental daily collection and import for active holdings, with a 30-day rolling event window, at least a year of price bars and periodic SEC history refresh. Backfill new holdings before claiming coverage. Use per-provider concurrency/rate limits, retries, de-duplication and a freshness dashboard.
- Do not block UI generation on scraping an article or filing. On a stale/missing source, queue a bounded server-side refresh and render existing evidence with its as-of date; optionally allow a separately labeled live-refresh action. External AI/Jev calls still occur for generated answers.
- Check publisher/provider retention and redistribution terms before storing or displaying full articles. SEC access requires an identifiable `SEC_USER_AGENT`, not an API key. Yahoo's public chart endpoint needs no key but is unofficial; use a licensed market-data provider for reliable production history. Finnhub uses `FINNHUB_API_KEY` for summaries; NewsData archive/content requires `NEWSDATA_API_KEY`, suitable subscription and storage rights; FMP transcripts/valuation require `FMP_API_KEY` and may be subscription-gated. The app's `AI_GATEWAY_API_KEY` and `JEV_API_KEY` are generation keys, not ingestion keys.

## Acceptance checks

- Importing the same snapshot twice yields the same document, bar and fact counts; a changed source version retains identifiable provenance.
- A newly collected holding's month of events, year of daily bars, source documents and historical facts are queryable by its authorized portfolio without contacting news, SEC or market-data providers at request time.
- A full-text question cites a stored article/filing passage where available; a headline-only question is visibly limited to headline claims. A chart query uses relevant, correctly dated price/fundamental series, including source and freshness labels.
- Missing provider access or subscription degrades to explicitly labeled partial coverage rather than invented content; object storage and DB survive deployment and restart.
