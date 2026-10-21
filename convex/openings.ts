import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** Every clip answered so far, plus points and streak. */
export const progress = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const results = await ctx.db
      .query("clipResults")
      .withIndex("by_user_and_clip", (q) => q.eq("userId", userId))
      .take(2000);
    const score = await ctx.db
      .query("clipScores")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return {
      results: results.map(({ clipId, attempts, correct, lastResult, lastAt }) => ({ clipId, attempts, correct, lastResult, lastAt })),
      xp: score?.xp ?? 0,
      streak: score?.streak ?? 0,
      best: score?.best ?? 0,
    };
  },
});

/** Record the first answer to a clip in a sitting. A right answer earns points and extends the streak. */
export const record = mutation({
  args: { clipId: v.string(), correct: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const now = Date.now();
    const lastResult = args.correct ? ("right" as const) : ("wrong" as const);

    const row = await ctx.db
      .query("clipResults")
      .withIndex("by_user_and_clip", (q) => q.eq("userId", userId).eq("clipId", args.clipId))
      .unique();
    if (row) {
      await ctx.db.patch("clipResults", row._id, { attempts: row.attempts + 1, correct: row.correct + (args.correct ? 1 : 0), lastResult, lastAt: now });
    } else {
      await ctx.db.insert("clipResults", { userId, clipId: args.clipId, attempts: 1, correct: args.correct ? 1 : 0, lastResult, lastAt: now });
    }

    const score = await ctx.db
      .query("clipScores")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const streak = args.correct ? (score?.streak ?? 0) + 1 : 0;
    const next = {
      xp: (score?.xp ?? 0) + (args.correct ? 10 + Math.min(streak, 5) * 2 : 0),
      streak,
      best: Math.max(score?.best ?? 0, streak),
    };
    if (score) await ctx.db.patch("clipScores", score._id, next);
    else await ctx.db.insert("clipScores", { userId, ...next });
    return null;
  },
});
