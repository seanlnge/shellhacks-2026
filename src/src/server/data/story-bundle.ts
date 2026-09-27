import { z } from "zod";

const timestamp = z.iso.datetime({ offset: true });
const sourceId = z.string().trim().min(1);

export const storyBundleSchema = z
  .object({
    story: z.object({
      id: z.number().int().positive(),
      assetKey: z.string().trim().min(1),
      holding: z.object({
        ticker: z.string().trim().min(1),
        name: z.string().trim().min(1),
      }),
      metrics: z.record(
        z.string(),
        z.object({
          label: z.string().trim().min(1),
          value: z.number().finite(),
          display: z.string().trim().min(1),
          sourceId,
          asOf: timestamp,
        }),
      ),
      series: z.record(
        z.string(),
        z.object({
          label: z.string().trim().min(1),
          unit: z.string().trim().min(1),
          points: z
            .array(z.object({ date: z.iso.date(), value: z.number().finite() }))
            .min(1),
          sourceId,
          asOf: timestamp,
        }),
      ),
      events: z.array(
        z.object({
          id: z.string().trim().min(1),
          date: z.iso.date(),
          label: z.string().trim().min(1),
          sourceId,
        }),
      ),
      sources: z.record(
        z.string(),
        z.object({
          label: z.string().trim().min(1),
          url: z
            .url()
            .refine(
              (url) => url.startsWith("https://"),
              "HTTPS source URL required",
            ),
          publishedAt: timestamp,
          accessedAt: timestamp,
        }),
      ),
    }),
  })
  .superRefine(({ story }, ctx) => {
    if (
      !Object.keys(story.metrics).length &&
      !Object.keys(story.series).length &&
      !story.events.length
    ) {
      ctx.addIssue({
        code: "custom",
        message: "A bundle needs at least one sourced metric, series, or event",
        path: ["story"],
      });
    }
    for (const [kind, items] of [
      ["metrics", Object.entries(story.metrics)],
      ["series", Object.entries(story.series)],
      [
        "events",
        story.events.map((event, index) => [String(index), event] as const),
      ],
    ] as const) {
      for (const [key, item] of items) {
        if (!Object.hasOwn(story.sources, item.sourceId)) {
          ctx.addIssue({
            code: "custom",
            message: `Missing source ${item.sourceId}`,
            path: ["story", kind, key, "sourceId"],
          });
        }
      }
    }
    if (story.assetKey.split(":").slice(1).join(":") !== story.holding.ticker) {
      ctx.addIssue({
        code: "custom",
        message: "Holding ticker must match story assetKey",
        path: ["story", "holding", "ticker"],
      });
    }
  });

export type StoryBundle = z.infer<typeof storyBundleSchema>;
export type StorySeries = StoryBundle["story"]["series"][string];

export function parseStoryBundle(value: unknown): StoryBundle {
  return storyBundleSchema.parse(value);
}
