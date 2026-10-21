import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const get = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const p = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const user = await ctx.db.get("users", userId);
    return { chesscom: p?.chesscom, lichess: p?.lichess, model: p?.model, email: user?.email };
  },
});

export const set = mutation({
  args: { chesscom: v.optional(v.string()), lichess: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const clean = {
      chesscom: args.chesscom?.trim() || undefined,
      lichess: args.lichess?.trim() || undefined,
    };
    const p = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (p) await ctx.db.patch("profiles", p._id, clean);
    else await ctx.db.insert("profiles", { userId, ...clean });
  },
});
