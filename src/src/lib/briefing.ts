import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

export const briefingCatalog = defineCatalog(schema, {
  components: {
    Deck: {
      props: z.object({}),
      description: "A full-screen editorial briefing deck",
    },
    Cover: {
      props: z.object({
        eyebrow: z.string(),
        title: z.string(),
        subtitle: z.string(),
      }),
      description: "Opening slide",
    },
    Insight: {
      props: z.object({
        number: z.string(),
        heading: z.string(),
        body: z.string(),
      }),
      description: "Single focused insight slide",
    },
    Source: {
      props: z.object({ label: z.string(), url: z.string() }),
      description: "Link to the original reporting",
    },
  },
  actions: {},
});

export const generatedCopy = z.object({
  title: z.string().max(120),
  subtitle: z.string().max(220),
  insights: z
    .array(
      z.object({ heading: z.string().max(100), body: z.string().max(420) }),
    )
    .min(1)
    .max(3),
});

export type BriefingCopy = z.infer<typeof generatedCopy>;

export function briefingSpec(
  copy: BriefingCopy,
  source: { name: string; url: string },
) {
  return {
    root: "deck",
    elements: {
      deck: {
        type: "Deck",
        props: {},
        children: [
          "cover",
          ...copy.insights.map((_, i) => `insight-${i}`),
          "source",
        ],
      },
      cover: {
        type: "Cover",
        props: {
          eyebrow: "YOUR DEEP DIVE",
          title: copy.title,
          subtitle: copy.subtitle,
        },
        children: [],
      },
      ...Object.fromEntries(
        copy.insights.map((insight, i) => [
          `insight-${i}`,
          {
            type: "Insight",
            props: { number: String(i + 1).padStart(2, "0"), ...insight },
            children: [],
          },
        ]),
      ),
      source: {
        type: "Source",
        props: { label: source.name, url: source.url },
        children: [],
      },
    },
  };
}
