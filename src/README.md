# folio.fm

Personal portfolio news briefings built on Next.js, tRPC, NextAuth, Drizzle and `json-render`.

## Run locally

From this `src/` directory, install dependencies with `npm install`, configure `.env` from `.env.example` (Postgres, Google OAuth and Auth secret), then run `npm run db:migrate` and `npm run dev`. On Windows PowerShell with script execution disabled, use `npm.cmd` instead of `npm`. Google requires both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; lowercase `google_client_id` and `google_client_secret` are also accepted. Add `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI in Google Cloud, plus the equivalent URL for deployment. `AI_GATEWAY_API_KEY` is optional for portfolio CRUD but required for AI deep dives. `BRIEFING_MODEL` defaults to `google/gemini-2.5-flash-lite` on Vercel AI Gateway.

## Aggregation boundary

The data aggregation service is separate. It should insert sourced records into `src_story` (defined in `src/server/db/schema.ts`): `assetKey`, `title`, `summary`, `content`, `sourceName`, `sourceUrl`, `publishedAt`. Match `assetKey` to a portfolio holding using `stock:AAPL` or `alternative:BTC`, where the symbol is uppercase. `sourceUrl` should be a trusted HTTPS URL. The dashboard reads the 20 most recent stories for the selected portfolio's holdings; it never fabricates news when no stories are available. Keep story content grounded in the linked source.

For referenced metrics, series, events and sources, `src_story_data` stores one validated JSON bundle per story. To import the included Apple primary-source example, run `npm run data:import -- ../data_aggregation/apple_fy2025_q3_story.json` from this directory after migrating. It contains historical fiscal Q3 2025 results for `stock:AAPL`, not current market data. Other fixtures contain `record` (the story fields above) and `bundle.story` (matching `assetKey`, `holding`, `metrics`, `series`, `events` and `sources`). Every data item needs a source ID found in `sources`, and one source URL must equal `record.sourceUrl`. The importer creates or updates the story and bundle together. `data_aggregation/market_data` contains provider clients, not a ready-made dataset; prepare or fetch a real sourced fixture before importing other holdings, rather than inventing financial observations.

Authenticated tRPC routes under `portfolio` support `list`, `create`, `update`, `delete`, and `stories`. Holdings are `{ kind: "stock" | "alternative", symbol: string, name: string }` entries in a portfolio JSONB array. Every portfolio operation checks the session owner; `briefing.generate` also verifies that the requested story matches one of that owner's holdings.

Generated deep dives stream `json-render` JSONL patches from `POST /api/deepdive` into an editorial deck or chart dashboard. `GET /api/story-data` returns its sourced bundle and `GET /api/series` resolves selected series; all routes require a signed-in user who owns a portfolio containing the requested story's holding. The client loads story data alongside the stream and shows a quiet empty state for missing refs. Story-level and ask boxes and generated view elements can launch follow-up views. The portfolio ask currently uses the most recent story as its grounding context, not all holdings. An AI Gateway key and at least one sourced story are needed to exercise live generation; the latency targets in `../docs/GENERATIVE_UI.md` are goals, not guarantees.

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
