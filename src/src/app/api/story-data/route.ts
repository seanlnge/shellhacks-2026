import { z } from "zod";

import { accessError, authorizedStory } from "~/server/generative/access";
import { getStoryBundle } from "~/server/data/story-store";
import { integratedStoryBundle } from "~/server/data/derived-bundle";

const inputSchema = z.object({
  portfolioId: z.coerce.number().int().positive(),
  storyId: z.coerce.number().int().positive(),
});

export async function GET(request: Request) {
  const input = inputSchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!input.success)
    return Response.json({ error: "Invalid request" }, { status: 400 });

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
    return Response.json(bundle, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json({ error: "Story data unavailable" }, { status: 503 });
  }
}
