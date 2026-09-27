import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

// All data-bearing elements use keys from the story bundle, never model-written values.
export const catalog = defineCatalog(schema, {
  components: {
    Deck: {
      props: z.object({ title: z.string().max(120) }),
      slots: ["default"],
      description:
        "Root for an editorial story deck. Children are 3-6 StorySlides. First slide answers the question.",
    },
    Dashboard: {
      props: z.object({
        title: z.string().max(120),
        columns: z.number().int().min(1).max(4).optional(),
      }),
      slots: ["default"],
      description:
        "Root for a data-heavy question. Children are Sections; only use available bundle refs.",
    },
    Section: {
      props: z.object({
        title: z.string().max(100),
        span: z.number().int().min(1).max(4).optional(),
      }),
      slots: ["default"],
      description: "Dashboard section. Children are evidence components.",
    },
    Accordion: {
      props: z.object({
        title: z.string().max(120),
        expanded: z.boolean().optional(),
      }),
      slots: ["default"],
      description:
        "A collapsible disclosure for supporting detail; use a concise, informative title.",
    },
    StorySlide: {
      props: z.object({
        kicker: z.string().max(40),
        title: z.string().max(120),
      }),
      slots: ["default"],
      description:
        "One editorial slide with a conclusion and up to four evidence components.",
    },
    Summary: {
      props: z.object({
        text: z.string().max(1000),
        expandedText: z.string().max(1800).optional(),
        sourceIds: z.array(z.string()).max(8).optional(),
      }),
      description:
        "Concise sourced explanation. Use sourceIds for evidence supporting the text; do not invent figures.",
    },
    HighlightFact: {
      props: z.object({
        text: z.string().max(600),
        highlight: z.string().max(180),
        sourceId: z.string(),
        preview: z.string().trim().min(1).max(350),
      }),
      description:
        "Sourced factual sentence with one exact, meaningful highlighted phrase, a real source ID, and a useful sourced preview. Do not highlight dates or numbers alone. Never invent text or URLs.",
    },
    BigNumber: {
      props: z.object({
        label: z.string().max(80),
        metricRef: z.string(),
        compareRef: z.string().optional(),
      }),
      description:
        "Display a real metric by exact key from DATA MANIFEST; never write numeric values.",
    },
    KPIGrid: {
      props: z.object({ metricRefs: z.array(z.string()).min(1).max(8) }),
      description: "Small grid of real metric refs from DATA MANIFEST.",
    },
    MetricsTable: {
      props: z.object({
        metricRefs: z.array(z.string()).min(1).max(8),
        title: z.string().max(100).optional(),
      }),
      description:
        "Compact comparison table of sourced metrics from DATA MANIFEST. Never write numeric values.",
    },
    LineChart: {
      props: z.object({
        seriesRefs: z.array(z.string()).min(1).max(4),
        title: z.string().max(100).optional(),
      }),
      description:
        "Line trends from series keys in DATA MANIFEST. Never supply points.",
    },
    MarketChart: {
      props: z.object({
        assetKey: z.string().regex(/^stock:[A-Z0-9][A-Z0-9.\-]{0,14}$/),
        range: z.enum(["1w", "1mo", "3mo", "1y"]),
        title: z.string().max(100).optional(),
      }),
      description:
        "Fetch historical closing prices for an approved stock holding only after this chart is selected. Never supply or infer points.",
    },
    BarChart: {
      props: z.object({
        seriesRefs: z.array(z.string()).min(1).max(4),
        title: z.string().max(100).optional(),
      }),
      description:
        "Bar comparisons from series keys in DATA MANIFEST. Never supply values.",
    },
    HorizontalBarChart: {
      props: z.object({
        seriesRefs: z.array(z.string()).min(1).max(4),
        title: z.string().max(100).optional(),
      }),
      description:
        "Ranked horizontal bars from series keys in DATA MANIFEST. Never supply values.",
    },
    PieChart: {
      props: z.object({
        seriesRefs: z.array(z.string()).min(1).max(8),
        title: z.string().max(100).optional(),
      }),
      description:
        "Show the latest values from distinct series as a sourced composition. Use only non-negative values.",
    },
    Timeline: {
      props: z.object({ eventsRef: z.string().optional() }),
      description:
        "Dated events in the story bundle; eventsRef may be omitted to use story.events.",
    },
    FilingExcerpt: {
      props: z.object({
        chunkId: z.string(),
        note: z.string().max(120).optional(),
      }),
      description:
        "Display a sourced excerpt only when chunkId exists in the bundle sources; never invent quote text.",
    },
    SourceChips: {
      props: z.object({ sourceIds: z.array(z.string()).max(12) }),
      description: "Links to source IDs from SOURCES; omit unknown IDs.",
    },
    AskFollowup: {
      props: z.object({ suggestions: z.array(z.string().max(160)).max(4) }),
      description: "Suggested grounded follow-up questions.",
    },
    KeyTakeaways: {
      props: z.object({
        items: z.array(z.string().max(250)).max(5),
        sourceIds: z.array(z.string()).max(8).optional(),
      }),
      description: "Short sourced closing observations, no invented numbers.",
    },
    RiskFlag: {
      props: z.object({
        severity: z.enum(["low", "medium", "high"]),
        text: z.string().max(350),
        sourceIds: z.array(z.string()).max(8).optional(),
      }),
      description: "A risk evidenced by the source material, not a prediction.",
    },
    Callout: {
      props: z.object({
        text: z.string().max(250),
        sourceIds: z.array(z.string()).max(8).optional(),
      }),
      description: "Plain-language annotation grounded in the provided story.",
    },
    ExplainTerm: {
      props: z.object({
        term: z.string().max(80),
        definition: z.string().max(350),
      }),
      description: "Brief explanation of a financial term.",
    },
  },
  actions: {},
});
