import { relations, sql } from "drizzle-orm";
import {
  customType,
  index,
  pgTableCreator,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AdapterAccount } from "next-auth/adapters";
import type { StoryBundle } from "~/server/data/story-bundle";

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator((name) => `src_${name}`);
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const posts = createTable(
  "post",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    name: d.varchar({ length: 256 }),
    createdById: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("created_by_idx").on(t.createdById),
    index("name_idx").on(t.name),
  ],
);

export type Holding = {
  kind: "stock" | "alternative";
  symbol: string;
  name: string;
};

export const portfolios = createTable(
  "portfolio",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: d.varchar({ length: 100 }).notNull(),
    holdings: d.jsonb().$type<Holding[]>().notNull().default([]),
    createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (t) => [index("portfolio_user_idx").on(t.userId)],
);

// Aggregation writes sourced stories here; assetKey uses "stock:AAPL" or "alternative:BTC".
export const stories = createTable(
  "story",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    assetKey: d.varchar({ length: 128 }).notNull(),
    title: d.varchar({ length: 300 }).notNull(),
    summary: d.text().notNull(),
    content: d.text().notNull(),
    sourceName: d.varchar({ length: 120 }).notNull(),
    sourceUrl: d.text().notNull(),
    publishedAt: d.timestamp({ withTimezone: true }).notNull(),
  }),
  (t) => [index("story_asset_date_idx").on(t.assetKey, t.publishedAt)],
);

// Pre-ingested, sourced chart and metric data for a single story.
export const storyData = createTable("story_data", (d) => ({
  storyId: d
    .integer()
    .primaryKey()
    .references(() => stories.id, { onDelete: "cascade" }),
  bundle: d.jsonb().$type<StoryBundle>().notNull(),
  importedAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
}));

// Evidence is independent of generated stories and of any particular portfolio.
export const evidence = createTable(
  "evidence",
  (d) => ({
    id: d.varchar({ length: 64 }).primaryKey(),
    assetKey: d.varchar({ length: 128 }).notNull(),
    title: d.text().notNull(),
    text: d.text().notNull(),
    sourceUrl: d.text().notNull(),
    sourceType: d.varchar({ length: 32 }).notNull(),
    contentScope: d.varchar({ length: 100 }).notNull(),
    publishedAt: d.timestamp({ withTimezone: true }).notNull(),
  }),
  (t) => [
    index("evidence_asset_date_idx").on(t.assetKey, t.publishedAt),
    index("evidence_fts_idx").using(
      "gin",
      sql`to_tsvector('english', ${t.title} || ' ' || ${t.text})`,
    ),
  ],
);

export const sourceDocuments = createTable(
  "source_document",
  (d) => ({
    id: d.varchar({ length: 64 }).primaryKey(),
    assetKey: d.varchar({ length: 128 }).notNull(),
    provider: d.varchar({ length: 64 }).notNull(),
    providerId: d.text().notNull(),
    sourceUrl: d.text().notNull(),
    type: d.varchar({ length: 24 }).notNull(),
    title: d.text().notNull(),
    text: d.text().notNull(),
    contentScope: d.varchar({ length: 100 }).notNull(),
    contentHash: d.varchar({ length: 64 }).notNull(),
    originalHash: d.varchar({ length: 64 }),
    originalStatus: d.varchar({ length: 32 }).notNull(),
    licensePolicy: d.text().notNull(),
    publishedAt: d.timestamp({ withTimezone: true }).notNull(),
    fetchedAt: d.timestamp({ withTimezone: true }).notNull(),
  }),
  (t) => [
    uniqueIndex("source_document_provider_id_idx").on(
      t.assetKey,
      t.provider,
      t.providerId,
    ),
    index("source_document_asset_date_idx").on(t.assetKey, t.publishedAt),
    index("source_document_fts_idx").using(
      "gin",
      sql`to_tsvector('english', ${t.title} || ' ' || ${t.text})`,
    ),
  ],
);

// Originals are isolated from source-document queries and must only be read via
// the holding-scoped ingestion accessor. Production DB roles should deny direct reads.
export const sourceOriginals = createTable("source_original", (d) => ({
  documentId: d
    .varchar({ length: 64 })
    .primaryKey()
    .references(() => sourceDocuments.id, { onDelete: "cascade" }),
  bytes: bytea().notNull(),
}));

export const documentChunks = createTable(
  "document_chunk",
  (d) => ({
    documentId: d
      .varchar({ length: 64 })
      .notNull()
      .references(() => sourceDocuments.id, { onDelete: "cascade" }),
    ordinal: d.integer().notNull(),
    section: d.text(),
    startOffset: d.integer().notNull(),
    endOffset: d.integer().notNull(),
    text: d.text().notNull(),
  }),
  (t) => [
    primaryKey({ columns: [t.documentId, t.ordinal] }),
    index("document_chunk_fts_idx").using(
      "gin",
      sql`to_tsvector('english', ${t.text})`,
    ),
  ],
);

export const priceBars = createTable(
  "price_bar",
  (d) => ({
    assetKey: d.varchar({ length: 128 }).notNull(),
    date: d.date().notNull(),
    provider: d.varchar({ length: 64 }).notNull(),
    open: d.numeric({ precision: 24, scale: 8 }),
    high: d.numeric({ precision: 24, scale: 8 }),
    low: d.numeric({ precision: 24, scale: 8 }),
    close: d.numeric({ precision: 24, scale: 8 }).notNull(),
    adjustedClose: d.numeric({ precision: 24, scale: 8 }),
    volume: d.bigint({ mode: "number" }),
    currency: d.varchar({ length: 16 }),
    unit: d.varchar({ length: 64 }).notNull(),
    sourceUrl: d.text().notNull(),
    fetchedAt: d.timestamp({ withTimezone: true }).notNull(),
  }),
  (t) => [
    primaryKey({ columns: [t.assetKey, t.date, t.provider] }),
    index("price_bar_asset_date_idx").on(t.assetKey, t.date),
  ],
);

export const financialFacts = createTable(
  "financial_fact",
  (d) => ({
    id: d.varchar({ length: 64 }).primaryKey(),
    assetKey: d.varchar({ length: 128 }).notNull(),
    tag: d.varchar({ length: 128 }).notNull(),
    unit: d.varchar({ length: 64 }).notNull(),
    value: d.numeric({ precision: 32, scale: 8 }).notNull(),
    periodStart: d.date(),
    periodEnd: d.date().notNull(),
    filedAt: d.date().notNull(),
    form: d.varchar({ length: 16 }).notNull(),
    accession: d.varchar({ length: 32 }).notNull(),
    fiscalYear: d.integer(),
    fiscalPeriod: d.varchar({ length: 8 }),
    frame: d.varchar({ length: 32 }),
    sourceUrl: d.text().notNull(),
  }),
  (t) => [index("financial_fact_asset_period_idx").on(t.assetKey, t.periodEnd)],
);

export const ingestionRuns = createTable("ingestion_run", (d) => ({
  id: d.varchar({ length: 64 }).primaryKey(),
  snapshotHash: d.varchar({ length: 64 }).notNull(),
  startedAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
  completedAt: d.timestamp({ withTimezone: true }),
  status: d.varchar({ length: 16 }).notNull(),
  coverage: d.jsonb().$type<Record<string, unknown>>().notNull(),
  counts: d.jsonb().$type<Record<string, number>>().notNull(),
  errors: d.jsonb().$type<string[]>().notNull(),
}));

export const users = createTable("user", (d) => ({
  id: d
    .varchar({ length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: d.varchar({ length: 255 }),
  email: d.varchar({ length: 255 }).notNull(),
  emailVerified: d
    .timestamp({
      mode: "date",
      withTimezone: true,
    })
    .$defaultFn(() => /* @__PURE__ */ new Date()),
  image: d.varchar({ length: 255 }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
}));

export const accounts = createTable(
  "account",
  (d) => ({
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id),
    type: d.varchar({ length: 255 }).$type<AdapterAccount["type"]>().notNull(),
    provider: d.varchar({ length: 255 }).notNull(),
    providerAccountId: d.varchar({ length: 255 }).notNull(),
    refresh_token: d.text(),
    access_token: d.text(),
    expires_at: d.integer(),
    token_type: d.varchar({ length: 255 }),
    scope: d.varchar({ length: 255 }),
    id_token: d.text(),
    session_state: d.varchar({ length: 255 }),
  }),
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    index("account_user_id_idx").on(t.userId),
  ],
);

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const sessions = createTable(
  "session",
  (d) => ({
    sessionToken: d.varchar({ length: 255 }).notNull().primaryKey(),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id),
    expires: d.timestamp({ mode: "date", withTimezone: true }).notNull(),
  }),
  (t) => [index("t_user_id_idx").on(t.userId)],
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const verificationTokens = createTable(
  "verification_token",
  (d) => ({
    identifier: d.varchar({ length: 255 }).notNull(),
    token: d.varchar({ length: 255 }).notNull(),
    expires: d.timestamp({ mode: "date", withTimezone: true }).notNull(),
  }),
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);
