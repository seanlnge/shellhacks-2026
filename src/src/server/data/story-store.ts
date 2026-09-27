import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { stories, storyData } from "~/server/db/schema";
import {
  parseStoryBundle,
  type StoryBundle,
  type StorySeries,
} from "./story-bundle";

const storyFixtureSchema = z.object({
  record: z.object({
    assetKey: z.string().trim().min(1),
    title: z.string().trim().min(1).max(300),
    summary: z.string().trim().min(1),
    content: z.string().trim().min(1),
    sourceName: z.string().trim().min(1).max(120),
    sourceUrl: z
      .url()
      .refine((url) => url.startsWith("https://"), "HTTPS source URL required"),
    publishedAt: z.iso.datetime({ offset: true }),
  }),
  bundle: z
    .object({
      story: z
        .object({ id: z.number().int().positive().optional() })
        .passthrough(),
    })
    .passthrough(),
});

export async function getStoryBundle(
  storyId: number,
): Promise<StoryBundle | null> {
  const row = await db.query.storyData.findFirst({
    where: eq(storyData.storyId, storyId),
  });
  return row ? parseStoryBundle(row.bundle) : null;
}

export async function getStorySeries(
  storyId: number,
  keys: string[],
): Promise<Record<string, StorySeries> | null> {
  const bundle = await getStoryBundle(storyId);
  if (!bundle) return null;
  return Object.fromEntries(
    keys
      .filter((key) => Object.hasOwn(bundle.story.series, key))
      .map((key) => [key, bundle.story.series[key]!]),
  );
}

/** Import a reviewed JSON fixture for an existing story; never infer or invent missing facts. */
export async function importStoryBundle(
  fixture: unknown,
): Promise<StoryBundle> {
  const bundle = parseStoryBundle(fixture);
  await db.transaction(async (tx) => {
    const [story] = await tx
      .select()
      .from(stories)
      .where(eq(stories.id, bundle.story.id));
    if (!story) throw new Error(`Story ${bundle.story.id} does not exist`);
    if (story.assetKey !== bundle.story.assetKey)
      throw new Error("Fixture assetKey does not match story");
    if (
      !Object.values(bundle.story.sources).some(
        (source) => source.url === story.sourceUrl,
      )
    ) {
      throw new Error("Fixture must include the existing story source URL");
    }
    await tx
      .insert(storyData)
      .values({ storyId: story.id, bundle, importedAt: new Date() })
      .onConflictDoUpdate({
        target: storyData.storyId,
        set: { bundle, importedAt: new Date() },
      });
  });
  return bundle;
}

/** Create or update a sourced story and its linked data from one reviewed JSON fixture. */
export async function importStoryFixture(
  fixture: unknown,
): Promise<StoryBundle> {
  const { record, bundle: rawBundle } = storyFixtureSchema.parse(fixture);
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(stories)
      .where(
        and(
          eq(stories.assetKey, record.assetKey),
          eq(stories.sourceUrl, record.sourceUrl),
        ),
      );
    if (rawBundle.story.id && existing && rawBundle.story.id !== existing.id) {
      throw new Error("Fixture story ID conflicts with existing source URL");
    }
    if (rawBundle.story.id && !existing) {
      throw new Error(
        "Fixture story ID does not match any existing story with this source URL",
      );
    }
    const story =
      existing ??
      (
        await tx
          .insert(stories)
          .values({
            ...record,
            publishedAt: new Date(record.publishedAt),
          })
          .returning()
      )[0]!;
    const bundle = parseStoryBundle({
      ...rawBundle,
      story: { ...rawBundle.story, id: story.id },
    });
    if (bundle.story.assetKey !== record.assetKey)
      throw new Error("Fixture assetKey does not match story");
    if (
      !Object.values(bundle.story.sources).some(
        (source) => source.url === record.sourceUrl,
      )
    ) {
      throw new Error("Fixture must include the story's HTTPS source URL");
    }
    if (existing) {
      await tx
        .update(stories)
        .set({ ...record, publishedAt: new Date(record.publishedAt) })
        .where(eq(stories.id, story.id));
    }
    await tx
      .insert(storyData)
      .values({ storyId: story.id, bundle, importedAt: new Date() })
      .onConflictDoUpdate({
        target: storyData.storyId,
        set: { bundle, importedAt: new Date() },
      });
    return bundle;
  });
}
