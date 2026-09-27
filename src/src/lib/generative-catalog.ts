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
      }),
      description: "Concise sourced explanation. Do not invent figures.",
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
    LineChart: {
      props: z.object({
        seriesRefs: z.array(z.string()).min(1).max(4),
        title: z.string().max(100).optional(),
      }),
      description:
        "Line trends from series keys in DATA MANIFEST. Never supply points.",
    },
    BarChart: {
      props: z.object({
        seriesRefs: z.array(z.string()).min(1).max(4),
        title: z.string().max(100).optional(),
      }),
      description:
        "Bar comparisons from series keys in DATA MANIFEST. Never supply values.",
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
      props: z.object({ items: z.array(z.string().max(250)).max(5) }),
      description: "Short sourced closing observations, no invented numbers.",
    },
    RiskFlag: {
      props: z.object({
        severity: z.enum(["low", "medium", "high"]),
        text: z.string().max(350),
      }),
      description: "A risk evidenced by the source material, not a prediction.",
    },
    Callout: {
      props: z.object({ text: z.string().max(250) }),
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
