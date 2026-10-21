import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const DAY = 24 * 60 * 60 * 1000;
// how long until a puzzle comes back, by box: a solve moves it one box up, a fail back to box 0
const INTERVALS = [10 * 60 * 1000, DAY, 3 * DAY, 7 * DAY, 16 * DAY, 35 * DAY];

/** All the user's puzzles, soonest due first, with the game each came from. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const puzzles = await ctx.db
      .query("puzzles")
      .withIndex("by_user_and_due", (q) => q.eq("userId", userId))
      .take(1000);
    const games = new Map<string, { opponent: string; code?: string; playedAt: number; myColor: "white" | "black" }>();
    for (const p of puzzles) {
      if (games.has(p.gameId)) continue;
      const g = await ctx.db.get("games", p.gameId);
      if (g) games.set(p.gameId, { opponent: g.myColor === "white" ? g.black : g.white, code: g.code, playedAt: g.playedAt, myColor: g.myColor });
    }
    return puzzles.flatMap((p) => {
      const game = games.get(p.gameId);
      return game ? [{ ...p, game }] : [];
    });
  },
});

/** Record one attempt. `solved` = solved without a wrong move. */
export const record = mutation({
  args: { id: v.id("puzzles"), solved: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const p = await ctx.db.get("puzzles", args.id);
    if (!p || p.userId !== userId) throw new Error("Puzzle not found");
    const box = args.solved ? Math.min(p.box + 1, INTERVALS.length - 1) : 0;
    await ctx.db.patch("puzzles", args.id, {
      box,
      due: Date.now() + INTERVALS[box],
      attempts: p.attempts + 1,
      solves: p.solves + (args.solved ? 1 : 0),
      lastResult: args.solved ? "solved" : "failed",
    });
    return null;
  },
});
