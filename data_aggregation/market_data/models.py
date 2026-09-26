from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class MarketDataModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EarningsEvent(MarketDataModel):
    company_symbol: str
    fiscal_year: int
    fiscal_quarter: int = Field(ge=1, le=4)
    event_date: date

    @field_validator("company_symbol")
    @classmethod
    def normalize_company_symbol(cls, value: str) -> str:
        return value.upper()


class SourceDocument(MarketDataModel):
    source_id: str
    company_symbol: str
    document_type: str
    source_path: str
    published_at: datetime
    content_hash: str

    @field_validator("company_symbol")
    @classmethod
    def normalize_company_symbol(cls, value: str) -> str:
        return value.upper()

    @field_validator("published_at")
    @classmethod
    def published_at_must_be_aware(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
            raise ValueError("published_at must be timezone-aware")
        return value


class DocumentChunk(MarketDataModel):
    document_id: str
    chunk_index: int = Field(ge=0)
    text: str = Field(min_length=1)
    section: str | None = None
    token_start: int = Field(ge=0)
    token_end: int = Field(ge=0)

    @model_validator(mode="after")
    def token_range_must_be_ordered(self) -> "DocumentChunk":
        if self.token_end < self.token_start:
            raise ValueError("token_end must be greater than or equal to token_start")
        return self


class PublicDocumentManifest(MarketDataModel):
    source_url: str
    company_symbol: str
    fiscal_year: int
    fiscal_quarter: int = Field(ge=1, le=4)
    source_type: str
    published_at: datetime
    fetched_at: datetime
    raw_path: str
    raw_original_path: str | None = None
    raw_original_content_hash: str | None = None
    extracted_text_path: str | None = None
    content_hash: str
    extraction_method: str

    @field_validator("company_symbol")
    @classmethod
    def normalize_company_symbol(cls, value: str) -> str:
        return value.upper()
