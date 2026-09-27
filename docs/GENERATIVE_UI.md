# Portfolio Wrapped: Frontend Generation Design

Sep 26, 2026 · @Sean Lange

## Overview

The frontend generation layer turns a click on any part of a story into a new Wrapped-style deep dive, first slide in under 1.5s and full deck in under 5s. It has two halves that must stay separate:

- **Part A: UI generation.** A cheap LLM picks components, writes copy and chooses between a story deck and a chart-heavy dashboard, using a large json-render catalog.
- **Part B: Data pulling.** Charts and stat cards pull real series from our API by reference, so the model can put 20+ real charts on screen without typing data points.

Priority for the hackathon: a feature-rich, great-looking demo over a bulletproof one. Refs are mainly about richness and speed: they let small models produce big dashboards with short output.

Three things make <5s possible:

1. Everything the model needs is precomputed during ingestion (summaries, key numbers, embedded filing chunks). Nothing is fetched from EDGAR or news APIs at click time.
2. The spec streams as JSONL patches, so slide 1 renders while later slides are still generating.
3. The theme comes from [`DESIGN.md`](./DESIGN.md) and lives in our component registry, not the prompt, so the model emits no styling tokens.

## json-render primer

json-render is Vercel Labs' generative UI framework: the model generates the interface itself (which components, how they're arranged, what data they bind), but only from a catalog we control, and our own React components render the result. No iframes, no generated code. ([Introduction](https://json-render.dev/docs))

The pieces we use:

| Concept | What it is | Our use |
| --- | --- | --- |
| [Catalog](https://json-render.dev/docs) | Components with Zod-typed props + descriptions, plus actions with typed params. The contract with the model. | \~12 Wrapped slide components + 3 actions |
| [Registry](https://json-render.dev/docs/registry) | `defineRegistry(catalog, {components, actions})` maps catalog types to real React components and action handlers. | Where the `DESIGN.md` theme, restrained transitions and data fetching live |
| [Spec](https://json-render.dev/docs) | Flat JSON: `root` id + `elements` map, each with `type`, `props`, `children`. | One spec per deep dive |
| [SpecStream](https://json-render.dev/docs/api/core) | JSONL, one RFC 6902 patch per line (`add`, `replace`, `remove`…). `createSpecStreamCompiler` builds the spec incrementally. | Slide 1 renders before slide 4 exists |
| [AI SDK integration](https://json-render.dev/docs/ai-sdk) | Server: `catalog.prompt()` as system prompt + `streamText`. Client: `useUIStream({ api })` returns `{ spec, isStreaming, error, send }`. | Our `/api/deepdive` route |
| [Data binding](https://json-render.dev/docs/data-binding) | Props can be expressions: `$state` (read), `$bindState` (two-way), `$item`/`$index` in `repeat`, `$cond`/`$then`/`$else`, `$template`. | Binding slides to the prefetched story bundle |
| [Visibility](https://json-render.dev/docs/visibility) | `visible` conditions over state (`$and`, `$or`, `eq`, `gt`…). | Expand/collapse summaries, show risk flags only when present |
| Generation modes | Standalone (output is pure JSONL spec) vs inline (prose + patches in chat). | Standalone for deep dives |

Example spec shape, straight from the docs model:

```json
{
  "root": "slide-1",
  "elements": {
    "slide-1": { "type": "StorySlide", "props": { "kicker": "Top story #1", "title": "ACME went public" }, "children": ["num-1"] },
    "num-1": { "type": "BigNumber", "props": { "metricRef": "story.ipo.first_day_return" } }
  }
}
```

## Part A: UI generation

The model picks slides and writes short copy; the catalog limits it to Wrapped-style building blocks, and the registry makes every output look like the same product. Five pieces: catalog, registry, prompt, streaming route, anchor-driven follow-ups.

### A1. Catalog

Go wide on components: the richer the catalog, the more impressive each generated view looks. Two root types give two output modes: a swipeable `Deck` for stories and a grid `Dashboard` for "show me the financials"-style asks. Descriptions stay short so the prompt doesn't balloon.

| Component | Key props | Purpose |
| --- | --- | --- |
| `Deck` | `title` | Root, story mode. Children are slides; swipe + progress bar. |
| `Dashboard` | `title`, `columns: 1-4` | Root, dashboard mode. Responsive grid of sections. |
| `Section` | `title`, `span: 1-4` | Grid cell grouping charts/cards. |
| `StorySlide` | `kicker`, `title` | One editorial story page with a fixed monochrome layout. |
| `Summary` | `text`, `expandedText?` | Collapsed/expanded prose. |
| `BigNumber` | `label`, `metricRef`, `compareRef?` | Hero stat. |
| `KPIGrid` | `metricRefs[]` | 3-8 small stats with sparkline + delta. |
| `LineChart` | `seriesRefs[]`, `range?`, `annotations?` | Trends: revenue, margins, price. Multi-series. |
| `BarChart` | `seriesRefs[]`, `stacked?`, `horizontal?` | Quarterly/annual comparisons, segment revenue. |
| `AreaChart` | `seriesRefs[]`, `stacked?` | Mix over time (segments, asset allocation). |
| `Waterfall` | `bridgeRef` | Revenue → operating income → net income, or YoY change drivers. |
| `Donut` | `seriesRef` | Parts of a whole: segment mix, portfolio weights. |
| `ScatterChart` | `xRef`, `yRef`, `labelRef` | Holding vs peers (e.g. growth vs margin). |
| `Heatmap` | `matrixRef` | Portfolio correlation, sector exposure by holding. |
| `DataTable` | `tableRef`, `columns[]`, `highlight?` | Income statement / balance sheet rows, sortable. |
| `PriceChart` | `ticker`, `range`, `markEventId?` | Price history with event markers. |
| `Timeline` | `eventsRef` | Dated events for the holding. |
| `FilingExcerpt` | `chunkId`, `note?` | Real quote from a filing, linked to EDGAR. |
| `Comparison` | `leftRef`, `rightRef`, `metricRefs[]` | Holding vs peer or index. |
| `Callout` | `text`, `targetId?` | Annotation pinned next to a chart. |
| `KeyTakeaways` | `items: string[]` | Closing bullets. |
| `RiskFlag` | `severity`, `text` | Risks from filings/news. |
| `ExplainTerm` | `term`, `definition` | Inline education ("what is free cash flow"). |
| `SourceChips` | `sourceIds[]` | Sources for a slide or section. |
| `AskFollowup` | `suggestions: string[]` | Suggested next questions. |

Render charts with Recharts (or Tremor on top of it) inside the registry, themed once from `DESIGN.md`. Every chart gets a square, bordered tooltip and the same `Anchorable` wrapper, so users can click a bar or a point and ask about it. Use monochrome series differentiated by line style, weight, labels or markers, not color alone.

```ts
// lib/catalog.ts
import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

export const catalog = defineCatalog(schema, {
  components: {
    Deck: { props: z.object({ title: z.string() }), slots: ["default"],
      description: "Root container. Children must be StorySlide elements. 3-5 slides." },
    StorySlide: { props: z.object({
        kicker: z.string().max(40),
        title: z.string().max(70),
      }), slots: ["default"],
      description: "One editorial story page. Max 3 children plus SourceChips last." },
    BigNumber: { props: z.object({
        label: z.string().max(40),
        metricRef: z.string(),
        compareRef: z.string().nullable(),
      }),
      description: "Hero stat. metricRef MUST be a key from the DATA MANIFEST. Never write the number yourself." },
    PriceChart: { props: z.object({
        ticker: z.string(),
        range: z.enum(["1W", "1M", "6M", "1Y"]),
        markEventId: z.string().nullable(),
      }), description: "Price history with an optional event marker." },
    FilingExcerpt: { props: z.object({ chunkId: z.string(), note: z.string().max(120).nullable() }),
      description: "Quote from a source chunk. chunkId MUST come from SOURCES." },
    // ...Summary, Timeline, Comparison, KeyTakeaways, RiskFlag, ExplainTerm, SourceChips, AskFollowup
  },
  actions: {
    deep_dive: { params: z.object({ storyId: z.string(), focus: z.string() }),
      description: "Generate a new deck about a narrower topic." },
    open_source: { params: z.object({ sourceId: z.string() }), description: "Open the original filing/article." },
  },
});
```

Design rules baked into the catalog:

- Charts and stat cards take refs, because they need real series anyway and refs keep output short.
- Prose can mention numbers from the context; no hard ban.
- Descriptions carry the rules; they are what `catalog.prompt()` feeds the model.

### A2. Registry (where the theme lives)

The registry maps each type to a real component. Implement [`DESIGN.md`](./DESIGN.md) as the single visual source of truth; the model chooses content and composition, never colors, gradients, radii, fonts or animation styles. In particular:

- **Surfaces and shape:** white/light-gray grounds, charcoal text, 1px hairline dividers and borders, no shadows, blur, gradients or rounded corners. Reserve inverted matte-black surfaces for occasional executive briefing or hero-metric moments, not every slide. Use the concrete colors and spacing tokens in `DESIGN.md` rather than inventing a separate palette.
- **Type and hierarchy:** Playfair Display for editorial headlines and narrative section titles; Inter for body copy, labels, inputs, charts and numbers. Use uppercase tracked `label-caps` for kickers, sources and metric captions; use tabular lining figures for every numeric display and aligned chart/table values.
- **Decks:** a swipeable sequence of editorial pages, not colorful full-bleed cards. Each page uses a clear kicker, a large serif conclusion, then a sparse evidence block (metric, chart, quote or timeline) separated by hairlines. Keep a fixed-position progress indicator and breadcrumbs in the same restrained ledger language. Mobile pages stack evidence vertically with generous margins.
- **Dashboards:** use the 12/8/4-column responsive grid and margins defined in `DESIGN.md`. `Dashboard.columns` and `Section.span` describe content placement, not a new design grid; on mobile, complex tables collapse to key-value summaries. Grid sections and source citations use the same flat cards and dividers as the rest of the product.
- **Charts and states:** axes, gridlines, legends and tooltips use Inter and structural grays; label series or vary strokes/markers to distinguish them without saturated performance colors. Express positive/negative changes with explicit `+`/`-`, arrows and text, not hue alone. `RiskFlag.severity` controls copy and typographic emphasis, never a red/yellow pill. Source chips are rectangular, bordered and labeled.
- **Interaction and motion:** hover uses subtle fill or border changes; keyboard focus stays clearly visible using a high-contrast border or underline, without glow. Swipe/progress transitions may use short planar movement or opacity, but no bounce, parallax or ambient effects; respect `prefers-reduced-motion`. Preserve chart-point targets and click-to-explain behavior on touch as well as hover.

```tsx
// lib/registry.tsx
import { defineRegistry } from "@json-render/react";
import { catalog } from "./catalog";

export const { registry, handlers } = defineRegistry(catalog, {
  components: {
    StorySlide: ({ props, children, element }) => (
      <Anchorable element={element}>
        <motion.section className="story-slide" {...editorialSlideTransition}>
          <p className="kicker">{props.kicker}</p>
          <h2>{props.title}</h2>
          {children}
        </motion.section>
      </Anchorable>
    ),
    BigNumber: ({ props, element }) => (
      <Anchorable element={element}>
        <MetricValue metricRef={props.metricRef} label={props.label} />
      </Anchorable>
    ),
    // ...
  },
  actions: {
    deep_dive: async (params) => startDeepDive({ storyId: params.storyId, focus: params.focus }),
    open_source: (params) => window.open(sourceUrl(params.sourceId), "_blank"),
  },
});
```

Exact component signature (`props`, `children`, element id) should be checked against the installed `@json-render/react` version before building on it.

### A3. Prompt

System prompt = `catalog.prompt({ customRules })` + a context block. Keep the context block tight; it is the biggest input cost.

```ts
const system = catalog.prompt({
  customRules: [
    "If the user asks to SEE data (financials, performance, comparison), output a Dashboard: 4-8 sections, mostly charts, one Summary on top.",
    "Otherwise output a Deck of 3-6 StorySlides; slide 1 answers the question directly.",
    "Prefer charts over cards whenever a series exists in DATA MANIFEST.",
    "Use metric/series keys from DATA MANIFEST and chunk ids from SOURCES for anything visual.",
    "Numbers in prose are fine if they appear in the context; don't invent figures.",
    "Add a Callout to point out the most interesting thing in each chart.",
    "Plain language. Assume the reader is a smart non-expert.",
    "Choose content and layout only. Do not output visual styling; the registry applies DESIGN.md.",
  ],
});

const context = `
HOLDING: ${holding.ticker} (${holding.name}), ${holding.weightPct}% of portfolio
STORY: ${story.headline}
FOCUS: ${anchor.focusText}
DATA MANIFEST: ${manifestKeys.join(", ")}
SOURCES:
${chunks.map(c => `[${c.id}] ${c.source}: ${c.text}`).join("\n")}
`;
```

The manifest is a list of *keys with labels only* (e.g. `story.ipo.first_day_return: "First-day return"`), not values. The model knows what exists without being able to misquote it.

### A4. Streaming route and client

Standalone mode: the response is pure JSONL patches, rendered progressively.

```ts
// app/api/deepdive/route.ts
import { streamText } from "ai";

export async function POST(req: Request) {
  const { storyId, anchor } = await req.json();
  const { system, context, bundle } = await buildContext(storyId, anchor); // Part B, cached
  const result = streamText({ model: fastModel, system: system + context, prompt: anchor.userPrompt ?? "Explain this." });
  return result.toTextStreamResponse();
}
```

```tsx
// components/DeepDive.tsx
const { spec, isStreaming, error, send } = useUIStream({ api: "/api/deepdive" });

<StateProvider initialState={bundle}>
  <VisibilityProvider>
    <Renderer spec={spec} registry={registry} />
  </VisibilityProvider>
</StateProvider>
```

The bundle (Part B) is fetched in parallel with the stream and becomes the initial state, so `$state` bindings resolve the moment each element lands.

### A5. Anchors: "learn more" and ask-anything

Every registry component is wrapped in `Anchorable`. That wrapper, not the model, owns hover, the "Learn more" button and the prompt box. On trigger it sends:

```ts
{
  storyId,
  parentDeckId,            // for breadcrumbs / back navigation
  anchor: {
    elementId: "num-1",
    elementType: "BigNumber",
    elementProps: { label: "First-day return", metricRef: "story.ipo.first_day_return" },
    selectedText: "lock-up expiry",   // from window.getSelection(), if any
    userPrompt: "why does this matter for me?" // optional
  }
}
```

Why this works: the anchor *is* the element's own spec entry, so the server knows exactly what was clicked (a metric, a filing quote, a term) and can retrieve narrowly. `focusText` for the prompt is built from `selectedText ?? elementProps.label ?? elementProps.title`.

Nested decks form a stack; a breadcrumb bar lets the user go back. Cache each generated spec by `hash(storyId + anchor)` so repeat clicks are instant during the demo.

### A6. Main dashboard vs deep dives

The top-stories home screen stays a fixed layout from precomputed summaries, so it loads instantly. Everything past it is generated: story decks, "show me X" dashboards, and follow-ups on any chart point. Add a global ask bar on the home screen too ("compare my tech holdings' margins"), which generates a Dashboard across holdings, not just one story.

## Part B: Data pulling

Default: visuals pull real data from our API by reference, because charts need actual series and refs keep generation fast. This is a speed and richness choice more than a safety rule; prose can quote figures from the context, and bad refs just render an empty state.

There are two mechanisms, and we use both.

| Mechanism | How | Use for |
| --- | --- | --- |
| State binding | A per-story **data bundle** is loaded into json-render state; spec props use `$state` / `$template` / `repeat` against it. | Small scalar facts: metrics, dates, labels, event lists |
| Ref-resolving components | Component gets a ref (`ticker`, `chunkId`, `metricRef`) and fetches/looks up itself. | Heavy or lazy data: price series, filing text, peer comparisons |

### B1. The story data bundle

Built during ingestion, cached in Postgres/Redis, keyed by story id. Fetched by the client in parallel with the generation stream (\~50-100ms), then passed as `initialState`.

```json
{
  "story": {
    "id": "st_42",
    "holding": { "ticker": "ACME", "name": "Acme Corp", "weightPct": 6.2 },
    "metrics": {
      "ipo.first_day_return": { "label": "First-day return", "value": 0.34, "display": "+34%", "sourceId": "src_7" },
      "ipo.price":            { "label": "IPO price",        "value": 21,   "display": "$21.00", "sourceId": "src_3" },
      "position.value_change":{ "label": "Your position",    "value": 412,  "display": "+$412", "sourceId": "calc" }
    },
    "events": [
      { "id": "ev_1", "date": "2026-09-18", "label": "Priced IPO", "sourceId": "src_3" },
      { "id": "ev_2", "date": "2027-03-17", "label": "Lock-up expires", "sourceId": "src_3" }
    ],
    "sources": {
      "src_3": { "type": "filing", "form": "424B4", "url": "https://www.sec.gov/...", "date": "2026-09-18" },
      "src_7": { "type": "news", "publisher": "...", "url": "..." }
    }
  }
}
```

The `display` field is formatted server-side once. Components never format numbers from model input, and every metric carries a `sourceId` so `SourceChips` can be auto-filled.

### B2. Binding patterns the model emits

These use json-render's built-in expressions from the [Data Binding](https://json-render.dev/docs/data-binding) docs.

Numbers inside sentences via `$template` (the bridge between LLM prose and real figures):

```json
{ "type": "Summary", "props": {
  "text": { "$template": "ACME closed its first day up ${/story/metrics/ipo.first_day_return/display} from its ${/story/metrics/ipo.price/display} IPO price." }
}}
```

Lists via `repeat`:

```json
{ "type": "Timeline", "repeat": { "statePath": "/story/events", "key": "id" }, "children": ["tl-item"] }
{ "type": "TimelineItem", "props": { "date": { "$item": "date" }, "label": { "$item": "label" } } }
```

Use `visible` only when the underlying data warrants an element, e.g. show a lock-up `RiskFlag` only if the event exists. Expand/collapse on `Summary` is local UI state in the component, not model output. Never bind financial performance to a visual theme or gradient.

If `$template` proves unreliable with a small model, fall back to the simpler contract: the model only emits `metricRef` props and `BigNumber` reads `bundle.metrics[ref].display` itself. Test both in the first hour of Part B.

### B3. Ref-resolving components

For data too large for the bundle or the prompt:

| Component | Ref | Resolver | Cache |
| --- | --- | --- | --- |
| `PriceChart` | `ticker`, `range` | `GET /api/prices/:ticker?range=` → from our price table | Prewarmed for all holdings, 1W-1Y |
| `FilingExcerpt` | `chunkId` | `GET /api/chunks/:id` → text + EDGAR URL + section | Chunks already in pgvector |
| `Comparison` | `leftRef`, `rightRef`, `metricRefs` | `GET /api/compare?...` | Precomputed for holding vs S&P 500 + sector ETF |
| `BigNumber` (fallback mode) | `metricRef` | Bundle lookup, no network | n/a |

Each resolver component renders a skeleton immediately, so the slide layout appears as soon as its patch arrives and data fills in after. Use SWR or React Query so the same ticker/range isn't fetched twice across slides.

### B3b. Financials series (powers dashboard mode)

"Show me the financials" only looks good if lots of series exist, so ingest fundamentals for every holding up front.

- **Source:** SEC XBRL `companyfacts` API (free, every 10-K/10-Q line item as JSON). Finnhub or Financial Modeling Prep as a faster, cleaner alternative if their free tiers cover your tickers.
- **Normalize** into named series: revenue, gross/operating/net income, margins, EPS, free cash flow, cash, debt, share count, segment revenue where tagged. Quarterly + annual, last 5 years.
- **Derive** extras server-side: YoY growth, margin trends, TTM values, revenue-to-net-income bridge (for `Waterfall`), peer medians (for `ScatterChart`).
- **Series ref format:** `fin.ACME.revenue.q`, `fin.ACME.gross_margin.a`, `bridge.ACME.FY2025`, `table.ACME.income_statement.q`.
- **Manifest:** list available series keys + labels per holding, so the model knows it can chart 20+ things.
- **Resolver:** `GET /api/series?keys=...` returns all requested series in one call; charts share it via React Query.

Portfolio-level series too: allocation by sector/asset class, contribution to return by holding, correlation matrix (for `Heatmap`). These make the cross-holding ask bar look great.

### B4. Grounding: what the model is allowed to see

`buildContext(storyId, anchor)` assembles the prompt input from the cache:

1. Load bundle for `storyId` (manifest keys come from `bundle.metrics`).
2. Embed `focusText` (small embedding model, \~50ms) and pull top 4-6 chunks for that holding from pgvector, filtered to the story's sources first, then the holding's recent filings.
3. Trim each chunk to \~120 words. Total context target: under 2,500 tokens.
4. Return `{ system, context, bundle }`.

The model can only cite `chunkId`s it was shown and metric keys in the manifest. That makes validation (below) a lookup, not a judgment call.

### B5. Light validation

Keep it minimal; don't spend build time here.

- Zod failure on an element → skip rendering it (json-render's validation does most of this for free).
- Unknown ref → component shows a quiet "no data" state.
- Log refs and numbers to the console for debugging; no blocking.

A dashboard with one broken card still looks impressive; a slow or empty one doesn't.

## Click-time flow and latency budget

The first slide should render in under 1.5s because the model streams layout while the client loads data in parallel.

&#91;embedded content: deep-dive request flow · server and client paths join at the Renderer\]

The two paths only meet at the Renderer, so neither waits on the other. Ref-resolving components fetch last, behind skeletons.

| Step | Target | How |
| --- | --- | --- |
| `buildContext` (bundle + embed + pgvector) | 150-200 ms | All cached; one embedding call |
| Model time to first token | 300-500 ms | Small fast model, <2.5k input tokens |
| First slide on screen | < 1.5 s | Stream patches; slide 1 is the answer |
| Full deck (3-5 slides) | 3-4 s | Length caps on every text prop |
| Repeat click on same anchor | < 100 ms | Spec cache by `hash(storyId + anchor)` |

These are targets to measure against, not benchmarks. Log per-step timings from the first working build.

## Models, failures and fallbacks

Pick the model by time-to-first-token and JSON reliability, not benchmark scores; test two candidates on the same 10 anchors in the first hours.

| Role | Candidates | Why |
| --- | --- | --- |
| Spec generation | Claude Haiku 4.5, Gemini Flash-Lite, or a Llama/Qwen model on Groq or Cerebras | Fast TTFT, cheap, good enough at constrained JSON |
| Embedding `focusText` | Any small hosted embedding model | Must match the model used at ingestion |
| Ingestion summaries (offline) | A stronger model is fine here | Not latency-bound; quality shows on the main dashboard |

Failure handling:

| Failure | Response |
| --- | --- |
| Malformed JSONL line | Skip it; the compiler keeps the spec built so far |
| Bad element or ref | Skip the element or show an empty state |
| Stream errors mid-view | Keep what rendered; show the ask box |
| Model provider down | Switch model via env var |

For the demo, prewarm the spec cache for the exact anchors you plan to click. Live generation still runs for audience questions.

## Hackathon build order and cut list

Get one generated view on screen fast, then pile on components and data; each new chart type makes every future generation look better.

1. Catalog + registry using `DESIGN.md` tokens and 3-4 core components; render a hand-written spec on desktop and mobile.
2. `/api/deepdive` streaming with `catalog.prompt()` + `useUIStream`. First live generation.
3. Financials ingestion (B3b) for the demo holdings + `/api/series`.
4. Chart components: `LineChart`, `BarChart`, `KPIGrid`, `DataTable`, `Waterfall`, `Donut`.
5. Dashboard mode + the global ask bar.
6. `Anchorable` everywhere: click any chart point, card or header to ask about it.
7. Story deck mode with `PriceChart`, `FilingExcerpt`, `Timeline`.
8. More visuals as time allows: `ScatterChart` vs peers, `Heatmap`, portfolio-level series, `Callout` annotations.
9. Polish: restrained, reduced-motion-safe transitions, breadcrumbs, spec cache for the demo path.

Lowest priority if time runs short:

- Validation beyond Zod
- Nested decks beyond one level
- Selection-based anchors (keep click-based)

Protect the demo with a prewarmed spec cache for the exact asks you'll show; let live questions from judges run uncached.

## Sources

- [json-render docs: Introduction](https://json-render.dev/docs)
- [json-render: Data Binding](https://json-render.dev/docs/data-binding)
- [json-render: Registry](https://json-render.dev/docs/registry)
- [json-render: Visibility](https://json-render.dev/docs/visibility)
- [json-render: AI SDK integration](https://json-render.dev/docs/ai-sdk)
- [json-render: @json-render/core API (SpecStream)](https://json-render.dev/docs/api/core)
- [vercel-labs/json-render on GitHub](https://github.com/vercel-labs/json-render)
