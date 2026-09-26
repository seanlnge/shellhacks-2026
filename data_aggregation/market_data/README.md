# Market Data

Standalone Python package for retrieving company news, SEC filing data, earnings dates, and earnings-call transcripts. It has no imports from the application that originally contained it; all shared document models and text utilities are included here.

## Install

Place this directory in a repository and install dependencies:

```powershell
python -m pip install -r requirements.txt
```

The package can then be imported as `market_data` when its parent directory is on `PYTHONPATH`. Each API client receives an API key and an `httpx.Client`; credentials are not loaded from environment files automatically.

## Providers

- `SecApiClient`: SEC-API company mapping and filing/exhibit search. Requires a SEC-API key.
- `NewsDataClient`: company news search and article retrieval. Requires a NewsData key.
- `TiingoNewsClient`: company news search. Requires a Tiingo key.
- `DefeatBetaNewsClient`: searches the public Yahoo Finance stock-news parquet dataset; uses pandas and pyarrow.
- `FinancialModelingPrepClient`: earnings transcript dates and transcript text. Requires an FMP key and suitable subscription access.
- `ApiNinjasClient`: earnings calendar and transcript endpoints. Requires an API Ninjas key.
- `collect_yfinance_news`: fallback news search using yfinance; no API key is required.
- `collect_public_document`: fetches a public URL, retains the original payload, and extracts visible text from HTML.

## Example

```python
from datetime import UTC, datetime
from pathlib import Path

import httpx

from market_data.sec_api import SecApiClient
from market_data.public_documents import collect_public_document

with httpx.Client(timeout=30) as http:
    sec = SecApiClient(api_key="YOUR_SEC_API_KEY", http_client=http)
    companies = sec.resolve_mapping(resolve_by="name", value="Example Inc")
    filings = sec.query_ex99_1_filings(query='ticker:"EXM" AND formType:"8-K"')

    manifest = collect_public_document(
        url="https://www.sec.gov/Archives/edgar/data/.../ex99.htm",
        company_symbol="EXM",
        fiscal_year=2026,
        fiscal_quarter=1,
        source_type="sec_ex99",
        published_at=datetime.now(UTC),
        fetched_at=datetime.now(UTC),
        raw_dir=Path("data/raw"),
        http_client=http,
    )
```

The `data_dir`/`raw_dir` paths and credentials belong to the consuming application. Respect provider rate limits, terms, and SEC fair-access guidance; cache responses where practical.
