import { getAuthUserId } from "@convex-dev/auth/server";
import { Chess } from "chess.js";
import { v } from "convex/values";
import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { analysisValidator } from "./schema";

async function requireUser(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in");
  return userId;
}

const gameInput = v.object({
  source: v.union(v.literal("chesscom"), v.literal("lichess")),
  externalId: v.string(),
  pgn: v.string(),
  white: v.string(),
  black: v.string(),
  myColor: v.union(v.literal("white"), v.literal("black")),
  result: v.string(),
  playedAt: v.number(),
  timeClass: v.optional(v.string()),
});

export const importBatch = mutation({
  args: { games: v.array(gameInput) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    let added = 0;
    for (const g of args.games.slice(0, 100)) {
      const existing = await ctx.db
        .query("games")
        .withIndex("by_user_and_source_and_externalId", (q) =>
          q.eq("userId", userId).eq("source", g.source).eq("externalId", g.externalId),
        )
        .unique();
      if (existing) continue;
      await ctx.db.insert("games", { ...g, userId });
      added++;
    }
    return added;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const games = await ctx.db
      .query("games")
      .withIndex("by_user_and_playedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(200);
    // keep the list light: drop the full pgn, but keep the final position for thumbnails
    return games.map(({ analysis, pgn, ...rest }) => {
      let finalFen: string | undefined;
      try {
        const g = new Chess();
        g.loadPgn(pgn);
        finalFen = g.fen();
      } catch {
        finalFen = undefined;
      }
      return {
        ...rest,
        finalFen,
        accuracy: analysis?.accuracy,
        summary: analysis?.summary,
        analysed: analysis !== undefined,
      };
    });
  },
});

export const get = query({
  args: { id: v.id("games") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const game = await ctx.db.get("games", args.id);
    if (!game || game.userId !== userId) return null;
    return game;
  },
});

export const saveAnalysis = mutation({
  args: { id: v.id("games"), analysis: analysisValidator },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const game = await ctx.db.get("games", args.id);
    if (!game || game.userId !== userId) throw new Error("Game not found");
    await ctx.db.patch("games", args.id, { analysis: args.analysis });
  },
});

export const remove = mutation({
  args: { id: v.id("games") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const game = await ctx.db.get("games", args.id);
    if (!game || game.userId !== userId) throw new Error("Game not found");
    await ctx.db.delete("games", args.id);
  },
});
