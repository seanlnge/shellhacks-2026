import "server-only";

import { and, eq } from "drizzle-orm";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { portfolios, stories } from "~/server/db/schema";

export async function authorizedStory(portfolioId: number, storyId: number) {
  const session = await auth();
  if (!session?.user?.id) return { error: 401 as const };

  const portfolio = await db.query.portfolios.findFirst({
    where: and(
      eq(portfolios.id, portfolioId),
      eq(portfolios.userId, session.user.id),
    ),
  });
  if (!portfolio) return { error: 404 as const };

  const story = await db.query.stories.findFirst({
    where: eq(stories.id, storyId),
  });
  const holding = portfolio.holdings.find(
    (item) => `${item.kind}:${item.symbol}` === story?.assetKey,
  );
  if (!story || !holding) return { error: 404 as const };
  return { story, holding };
}

export function accessError(status: 401 | 404) {
  return Response.json(
    { error: status === 401 ? "Authentication required" : "Story not found" },
    { status },
  );
}
