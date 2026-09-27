CREATE TABLE "src_evidence" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"assetKey" varchar(128) NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"sourceUrl" text NOT NULL,
	"sourceType" varchar(32) NOT NULL,
	"contentScope" varchar(100) NOT NULL,
	"publishedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "evidence_asset_date_idx" ON "src_evidence" USING btree ("assetKey","publishedAt");--> statement-breakpoint
CREATE INDEX "evidence_fts_idx" ON "src_evidence" USING gin (to_tsvector('english', "title" || ' ' || "text"));