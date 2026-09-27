# folio.fm

Personal portfolio news briefings built on Next.js, tRPC, NextAuth, Drizzle and `json-render`.

## Run locally

From this `src/` directory, install dependencies with `npm ci`, configure `.env` from `.env.example` (Postgres, Google OAuth and Auth secret), then run `npm run db:migrate` and `npm run dev`. On Windows PowerShell with script execution disabled, use `npm.cmd` instead of `npm`. Google requires both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; lowercase `google_client_id` and `google_client_secret` are also accepted. Add `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI in Google Cloud, plus the equivalent URL for deployment. `JEV_API_KEY` enables both direct TypeSafe Jev passage selection and experimental json-render composition. If it is absent, composition can use `AI_GATEWAY_API_KEY` with the `typesafe-ai/jev` model, provided your Gateway team enables that provider; evidence selection then explicitly falls back to lexical ranking. `AI_GATEWAY_API_KEY` is required for the explicit legacy LLM mode, with `BRIEFING_MODEL` defaulting to `google/gemini-2.5-flash-lite`.

## Experimental json-render pin

The published `@json-render/core@0.21.0` omits `experimental_composeSpec`. `package.json` and the lockfile instead install local packed builds of **both** `@json-render/core` and `@json-render/react` from [vercel-labs/json-render](https://github.com/vercel-labs/json-render) commit `c2600d73908ed505e6d726f5b6f969ba8f597ce7`. The artifacts live in `vendor/json-render/`, so `npm ci` does not depend on a moving branch or unpublished registry tag. Verify their SHA256 hashes before replacing them: core `AF171146B2BE9917FBC1B2416D84AADCB5B431AA883E5FB8B61A68DA96FDF368`; React `954D6F9531E7BC143E95B3DA9B0103CB59E6873DE7F2B0CE332F851A5460256B`. To rebuild, check out that exact commit, run `pnpm install --frozen-lockfile --filter @json-render/core... --filter @json-render/react...`, build `@json-render/core`, `@internal/react-state`, then `@json-render/react`, and pack core and React with `pnpm --filter <package> pack`. Recheck artifact hashes and run `npm ci` after replacing the vendored archives. These APIs are explicitly experimental and can change at the next upstream commit.

## Aggregation boundary

The data aggregation service is separate. It should insert sourced records into `src_story` (defined in `src/server/db/schema.ts`): `assetKey`, `title`, `summary`, `content`, `sourceName`, `sourceUrl`, `publishedAt`. Match `assetKey` to a portfolio holding using `stock:AAPL` or `alternative:BTC`, where the symbol is uppercase. `sourceUrl` should be a trusted HTTPS URL. The dashboard reads the 20 most recent stories for the selected portfolio's holdings; it never fabricates news when no stories are available. Keep story content grounded in the linked source.

For referenced metrics, series, events and sources, `src_story_data` stores one validated JSON bundle per story. To import the included Apple primary-source example, run `npm run data:import -- ../data_aggregation/apple_fy2025_q3_story.json` from this directory after migrating. It contains historical fiscal Q3 2025 results for `stock:AAPL`, not current market data. Other fixtures contain `record` (the story fields above) and `bundle.story` (matching `assetKey`, `holding`, `metrics`, `series`, `events` and `sources`). Every data item needs a source ID found in `sources`, and one source URL must equal `record.sourceUrl`. The importer creates or updates the story and bundle together.

For a chartable demo, also import `../data_aggregation/apple_weekly_price_2026_09_25.json`. It contains five actual daily AAPL adjusted-close observations for September 21–25, 2026, plus sourced weekly values. It does **not** contain a month of prices; previews and generated text must not describe it as such.

The separate `data_aggregation/data/2026-09-19_to_2026-09-25` snapshot contains cached SEC documents and headline-only news for several holdings. After `db:migrate`, run `npm run evidence:import -- ../data_aggregation/data/2026-09-19_to_2026-09-25` to index its sourced passages. The import is idempotent; only evidence for the signed-in portfolio's holdings can be retrieved. This snapshot directory is gitignored, so other machines and deployments need their own snapshot and explicit import. Headlines are not full articles, and the cached SEC excerpts are not embedded vectors.

Authenticated tRPC routes under `portfolio` support `list`, `create`, `update`, `delete`, and `stories`. Holdings are `{ kind: "stock" | "alternative", symbol: string, name: string }` entries in a portfolio JSONB array. Every portfolio operation checks the session owner; `briefing.generate` also verifies that the requested story matches one of that owner's holdings.

Generated deep dives use a server-owned set of sourced component candidates. The experimental json-render composer asks Jev to select their hierarchy and order, sending full spec snapshots over `POST /api/deepdive`; an explicit legacy mode retains JSONL patch generation. `GET /api/story-data` returns its sourced bundle and `GET /api/series` resolves selected series; all routes require a signed-in user who owns a portfolio containing the requested story's holding. The client loads story data alongside the stream and shows a quiet empty state for missing refs. For each question, PostgreSQL full-text search builds a broad, holding-scoped shortlist with recent/source-diverse fallback. Direct Jev evaluation checks each query-passage pair for relevance, usable evidence, contradiction and attempted prompt injection before selected source IDs and excerpts enter the composer candidates. Jev thresholds are cookbook examples, not calibrated accuracy guarantees; when unavailable, the route labels a lexical fallback. A portfolio ask searches every holding in that portfolio. Charts from its anchor story bundle remain anchor-specific, while `MarketChart` can fetch the selected authorized stock holding on demand from Yahoo Finance at `GET /api/market-series` after Jev chooses a chart. A `1mo` request uses the trailing calendar month of completed daily bars and cites the actual fetched URL and date range; missing data stays missing. This is indexed lexical retrieval rather than the planned pgvector search. At least one sourced story and a working Jev credential are needed for live composition; the latency targets in `../docs/GENERATIVE_UI.md` are goals, not guarantees.

The initial SQL migration in `drizzle/` creates the entire T3 schema plus portfolio and story tables. If your database already has the T3 tables without Drizzle migration history, reconcile that schema before applying this initial migration.

This is a [T3 Stack](https://create.t3.gg/) project bootstrapped with `create-t3-app`.

## What's next? How do I make an app with this?

We try to keep this project as simple as possible, so you can start with just the scaffolding we set up for you, and add additional things later when they become necessary.

If you are not familiar with the different technologies used in this project, please refer to the respective docs. If you still are in the wind, please join our [Discord](https://t3.gg/discord) and ask for help.

- [Next.js](https://nextjs.org)
- [NextAuth.js](https://next-auth.js.org)
- [Prisma](https://prisma.io)
- [Drizzle](https://orm.drizzle.team)
- [Tailwind CSS](https://tailwindcss.com)
- [tRPC](https://trpc.io)

## Learn More

To learn more about the [T3 Stack](https://create.t3.gg/), take a look at the following resources:

- [Documentation](https://create.t3.gg/)
- [Learn the T3 Stack](https://create.t3.gg/en/faq#what-learning-resources-are-currently-available) — Check out these awesome tutorials

You can check out the [create-t3-app GitHub repository](https://github.com/t3-oss/create-t3-app) — your feedback and contributions are welcome!

## How do I deploy this?

Follow our deployment guides for [Vercel](https://create.t3.gg/en/deployment/vercel), [Netlify](https://create.t3.gg/en/deployment/netlify) and [Docker](https://create.t3.gg/en/deployment/docker) for more information.
