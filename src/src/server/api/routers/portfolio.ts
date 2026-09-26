import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { portfolios, stories } from "~/server/db/schema";

const holding = z.object({
  kind: z.enum(["stock", "alternative"]),
  symbol: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[a-zA-Z0-9._-]+$/)
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1).max(100),
});

const portfolioInput = z.object({
  name: z.string().trim().min(1).max(100),
  holdings: z
    .array(holding)
    .max(100)
    .refine(
      (items) =>
        new Set(items.map((item) => `${item.kind}:${item.symbol}`)).size ===
        items.length,
      "Duplicate holdings are not allowed",
    ),
});

export const portfolioRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db.query.portfolios.findMany({
      where: eq(portfolios.userId, ctx.session.user.id),
      orderBy: desc(portfolios.createdAt),
    }),
  ),
  create: protectedProcedure
    .input(portfolioInput)
    .mutation(async ({ ctx, input }) => {
      const [portfolio] = await ctx.db
        .insert(portfolios)
        .values({
          ...input,
          userId: ctx.session.user.id,
        })
        .returning();
      return portfolio;
    }),
  update: protectedProcedure
    .input(portfolioInput.extend({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const [portfolio] = await ctx.db
        .update(portfolios)
        .set({
          name: input.name,
          holdings: input.holdings,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(portfolios.id, input.id),
            eq(portfolios.userId, ctx.session.user.id),
          ),
        )
        .returning();
      if (!portfolio) throw new TRPCError({ code: "NOT_FOUND" });
      return portfolio;
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const [portfolio] = await ctx.db
        .delete(portfolios)
        .where(
          and(
            eq(portfolios.id, input.id),
            eq(portfolios.userId, ctx.session.user.id),
          ),
        )
        .returning({ id: portfolios.id });
      if (!portfolio) throw new TRPCError({ code: "NOT_FOUND" });
      return portfolio;
    }),
  stories: protectedProcedure
    .input(z.object({ portfolioId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const portfolio = await ctx.db.query.portfolios.findFirst({
        where: and(
          eq(portfolios.id, input.portfolioId),
          eq(portfolios.userId, ctx.session.user.id),
        ),
      });
      if (!portfolio) throw new TRPCError({ code: "NOT_FOUND" });
      const keys = portfolio.holdings.map(
        (item) => `${item.kind}:${item.symbol}`,
      );
      if (!keys.length) return [];
      return ctx.db
        .select()
        .from(stories)
        .where(inArray(stories.assetKey, keys))
        .orderBy(desc(stories.publishedAt))
        .limit(20);
    }),
});
