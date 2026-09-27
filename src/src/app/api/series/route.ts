import { z } from "zod";

import { getStoryBundle } from "~/server/data/story-store";
import { integratedStoryBundle } from "~/server/data/derived-bundle";
import { accessError, authorizedStory } from "~/server/generative/access";

const inputSchema = z.object({
  portfolioId: z.coerce.number().int().positive(),
  storyId: z.coerce.number().int().positive(),
  keys: z.string().min(1).max(4000),
});

export async function GET(request: Request) {
  const input = inputSchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!input.success)
    return Response.json({ error: "Invalid request" }, { status: 400 });
  const keys = [
    ...new Set(input.data.keys.split(",").map((key) => key.trim())),
  ];
  if (keys.length > 50 || keys.some((key) => !key || key.length > 128)) {
    return Response.json({ error: "Invalid series keys" }, { status: 400 });
  }

  const access = await authorizedStory(
    input.data.portfolioId,
    input.data.storyId,
  );
  if ("error" in access && access.error) return accessError(access.error);

  try {
    const bundle = await integratedStoryBundle(
      access.story,
      await getStoryBundle(input.data.storyId),
    );
    if (!bundle)
      return Response.json(
        { error: "Story data unavailable" },
        { status: 404 },
      );
    return Response.json(
      {
        series: Object.fromEntries(
          keys.flatMap((key) =>
            bundle.story.series[key] ? [[key, bundle.story.series[key]]] : [],
          ),
        ),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return Response.json({ error: "Story data unavailable" }, { status: 503 });
  }
}
