CREATE TABLE "src_document_chunk" (
	"documentId" varchar(64) NOT NULL,
	"ordinal" integer NOT NULL,
	"section" text,
	"startOffset" integer NOT NULL,
	"endOffset" integer NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "src_document_chunk_documentId_ordinal_pk" PRIMARY KEY("documentId","ordinal")
);
--> statement-breakpoint
CREATE TABLE "src_financial_fact" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"assetKey" varchar(128) NOT NULL,
	"tag" varchar(128) NOT NULL,
	"unit" varchar(64) NOT NULL,
	"value" numeric(32, 8) NOT NULL,
	"periodStart" date,
	"periodEnd" date NOT NULL,
	"filedAt" date NOT NULL,
	"form" varchar(16) NOT NULL,
	"accession" varchar(32) NOT NULL,
	"fiscalYear" integer,
	"fiscalPeriod" varchar(8),
	"frame" varchar(32),
	"sourceUrl" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "src_ingestion_run" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"snapshotHash" varchar(64) NOT NULL,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"completedAt" timestamp with time zone,
	"status" varchar(16) NOT NULL,
	"coverage" jsonb NOT NULL,
	"counts" jsonb NOT NULL,
	"errors" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "src_price_bar" (
	"assetKey" varchar(128) NOT NULL,
	"date" date NOT NULL,
	"provider" varchar(64) NOT NULL,
	"open" numeric(24, 8),
	"high" numeric(24, 8),
	"low" numeric(24, 8),
	"close" numeric(24, 8) NOT NULL,
	"adjustedClose" numeric(24, 8),
	"volume" bigint,
	"currency" varchar(16),
	"unit" varchar(64) NOT NULL,
	"sourceUrl" text NOT NULL,
	"fetchedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "src_price_bar_assetKey_date_provider_pk" PRIMARY KEY("assetKey","date","provider")
);
--> statement-breakpoint
CREATE TABLE "src_source_document" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"assetKey" varchar(128) NOT NULL,
	"provider" varchar(64) NOT NULL,
	"providerId" text NOT NULL,
	"sourceUrl" text NOT NULL,
	"type" varchar(24) NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"contentScope" varchar(100) NOT NULL,
	"contentHash" varchar(64) NOT NULL,
	"originalHash" varchar(64),
	"originalStatus" varchar(32) NOT NULL,
	"licensePolicy" text NOT NULL,
	"publishedAt" timestamp with time zone NOT NULL,
	"fetchedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "src_source_original" (
	"documentId" varchar(64) PRIMARY KEY NOT NULL,
	"bytes" "bytea" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "src_document_chunk" ADD CONSTRAINT "src_document_chunk_documentId_src_source_document_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."src_source_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "src_source_original" ADD CONSTRAINT "src_source_original_documentId_src_source_document_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."src_source_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_chunk_fts_idx" ON "src_document_chunk" USING gin (to_tsvector('english', "text"));--> statement-breakpoint
CREATE INDEX "financial_fact_asset_period_idx" ON "src_financial_fact" USING btree ("assetKey","periodEnd");--> statement-breakpoint
CREATE INDEX "price_bar_asset_date_idx" ON "src_price_bar" USING btree ("assetKey","date");--> statement-breakpoint
CREATE UNIQUE INDEX "source_document_provider_id_idx" ON "src_source_document" USING btree ("assetKey","provider","providerId");--> statement-breakpoint
CREATE INDEX "source_document_asset_date_idx" ON "src_source_document" USING btree ("assetKey","publishedAt");--> statement-breakpoint
CREATE INDEX "source_document_fts_idx" ON "src_source_document" USING gin (to_tsvector('english', "title" || ' ' || "text"));