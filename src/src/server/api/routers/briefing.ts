import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { env } from "~/env";
import { briefingSpec, generatedCopy } from "~/lib/briefing";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { portfolios, stories } from "~/server/db/schema";

export const briefingRouter = createTRPCRouter({
  generate: protectedProcedure
    .input(
      z.object({
        portfolioId: z.number().int().positive(),
        storyId: z.number().int().positive(),
        question: z.string().trim().min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const portfolio = await ctx.db.query.portfolios.findFirst({
        where: and(
          eq(portfolios.id, input.portfolioId),
          eq(portfolios.userId, ctx.session.user.id),
        ),
      });
      const story = await ctx.db.query.stories.findFirst({
        where: eq(stories.id, input.storyId),
      });
      if (
        !portfolio ||
        !story ||
        !portfolio.holdings.some(
          (holding) => `${holding.kind}:${holding.symbol}` === story.assetKey,
        )
      ) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (!env.AI_GATEWAY_API_KEY)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Configure AI_GATEWAY_API_KEY to enable deep dives.",
        });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      let response: Response;
      try {
        response = await fetch(
          "https://ai-gateway.vercel.sh/v1/chat/completions",
          {
            method: "POST",
            signal: controller.signal,
            headers: {
              Authorization: `Bearer ${env.AI_GATEWAY_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: env.BRIEFING_MODEL ?? "google/gemini-2.5-flash-lite",
              temperature: 0.2,
              response_format: { type: "json_object" },
              messages: [
                {
                  role: "system",
                  content:
                    "You are a careful financial news explainer. Use ONLY the supplied source material. Never invent numbers, dates, quotes, or events. If evidence is missing, say so. Do not give investment advice. Return JSON with title, subtitle, and insights (1-3 objects with heading and body). Each insight must address the user's question. Keep writing crisp and informative.",
                },
                {
                  role: "user",
                  content: JSON.stringify({
                    question: input.question,
                    title: story.title,
                    summary: story.summary,
                    content: story.content.slice(0, 12000),
                    source: story.sourceName,
                    publishedAt: story.publishedAt,
                  }),
                },
              ],
            }),
          },
        );
      } catch {
        throw new TRPCError({
          code: "TIMEOUT",
          message: "The briefing took too long. Try again.",
        });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok)
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: "Briefing provider unavailable.",
        });
      const data: unknown = await response.json();
      const completion = z
        .object({
          choices: z
            .array(z.object({ message: z.object({ content: z.string() }) }))
            .min(1),
        })
        .safeParse(data);
      if (!completion.success)
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: "Invalid briefing response.",
        });
      let parsed: unknown;
      try {
        parsed = JSON.parse(completion.data.choices[0]!.message.content);
      } catch {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: "Invalid briefing JSON.",
        });
      }
      const copy = generatedCopy.safeParse(parsed);
      if (!copy.success)
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: "Invalid briefing content.",
        });
      return briefingSpec(copy.data, {
        name: story.sourceName,
        url: story.sourceUrl,
      });
    }),
});
