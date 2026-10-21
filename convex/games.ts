import { getAuthUserId } from "@convex-dev/auth/server";
import { Chess } from "chess.js";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { analysisValidator, puzzleSeed } from "./schema";

async function requireUser(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in");
  return userId;
}

const CODE_CHARS = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o or 1/l, so a code can be read aloud
const CODE_LENGTH = 12;

/** A short random code, unique among the user's games. */
async function newCode(ctx: MutationCtx, userId: Id<"users">): Promise<string> {
  for (;;) {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    const taken = await ctx.db
      .query("games")
      .withIndex("by_user_and_code", (q) => q.eq("userId", userId).eq("code", code))
      .first();
    if (!taken) return code;
  }
}

/**
 * The newest `n` games from chess.com and Lichess, leaving out games against the bot:
 * those have their own history on the Play page and don't count towards insights or openings.
 */
async function siteGames(ctx: QueryCtx, userId: Id<"users">, n: number) {
  const out: Doc<"games">[] = [];
  for await (const g of ctx.db
    .query("games")
    .withIndex("by_user_and_playedAt", (q) => q.eq("userId", userId))
    .order("desc")) {
    if (g.source === "bot") continue;
    out.push(g);
    if (out.length >= n) break;
  }
  return out;
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
      await ctx.db.insert("games", { ...g, userId, code: await newCode(ctx, userId) });
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
    const games = await siteGames(ctx, userId, 200);
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
        analysisVersion: analysis?.version,
      };
    });
  },
});

export const get = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db
      .query("games")
      .withIndex("by_user_and_code", (q) => q.eq("userId", userId).eq("code", args.code))
      .unique();
  },
});

/** Games played against the bot, newest first, for the history on the Play page. */
export const botGames = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const games = await ctx.db
      .query("games")
      .withIndex("by_user_and_source_and_playedAt", (q) => q.eq("userId", userId).eq("source", "bot"))
      .order("desc")
      .take(50);
    return games.map((g) => ({
      _id: g._id,
      code: g.code,
      myColor: g.myColor,
      result: g.result,
      playedAt: g.playedAt,
      bot: g.myColor === "white" ? g.black : g.white,
      moves: g.analysis?.moves.length,
      accuracy: g.analysis?.accuracy,
    }));
  },
});

/** Save a finished game against the bot, so it can be reviewed like any other. Returns its code. */
export const saveBotGame = mutation({
  args: { pgn: v.string(), myColor: v.union(v.literal("white"), v.literal("black")), result: v.string(), botName: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const code = await newCode(ctx, userId);
    await ctx.db.insert("games", {
      userId,
      source: "bot",
      externalId: code,
      code,
      pgn: args.pgn,
      white: args.myColor === "white" ? "You" : args.botName,
      black: args.myColor === "black" ? "You" : args.botName,
      myColor: args.myColor,
      result: args.result,
      playedAt: Date.now(),
      timeClass: "bot",
    });
    return code;
  },
});

/** Give codes to games imported before games had them. Returns how many were updated. */
export const assignCodes = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const missing = await ctx.db
      .query("games")
      .withIndex("by_user_and_code", (q) => q.eq("userId", userId).eq("code", undefined))
      .take(200);
    for (const g of missing) await ctx.db.patch("games", g._id, { code: await newCode(ctx, userId) });
    return missing.length;
  },
});

/** Compact per-game data for the insights report: results, accuracy, your mistakes, and the opening moves. */
export const insights = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const games = await siteGames(ctx, userId, 200);
    return games.flatMap((g) => {
      if (!g.analysis) return [];
      const mine = g.myColor === "white" ? 0 : 1;
      const mistakes = g.analysis.moves.flatMap((m, ply) =>
        ply % 2 === mine && m.kind ? [{ ply, label: m.label, kind: m.kind, phase: m.phase ?? "middlegame" }] : [],
      );
      return [
        {
          code: g.code,
          playedAt: g.playedAt,
          myColor: g.myColor,
          result: g.result,
          timeClass: g.timeClass,
          opponent: g.myColor === "white" ? g.black : g.white,
          accuracy: g.analysis.accuracy,
          summary: g.analysis.summary,
          plies: g.analysis.moves.length,
          // enough moves to name the opening
          opening: g.analysis.moves.slice(0, 24).map((m) => m.san),
          mistakes,
        },
      ];
    });
  },
});

const OPENING_PLIES = 20;

/** The first moves of every game, with their grades where the game is analysed: the raw material for opening training. */
export const openingData = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const games = await siteGames(ctx, userId, 200);
    return games.flatMap((g) => {
      let sans: string[];
      if (g.analysis) sans = g.analysis.moves.slice(0, OPENING_PLIES).map((m) => m.san);
      else {
        try {
          const c = new Chess();
          c.loadPgn(g.pgn);
          sans = c.history().slice(0, OPENING_PLIES);
        } catch {
          return [];
        }
      }
      return [
        {
          code: g.code,
          myColor: g.myColor,
          result: g.result,
          sans,
          labels: g.analysis?.moves.slice(0, OPENING_PLIES).map((m) => m.label),
        },
      ];
    });
  },
});

/** Games whose analysis is missing or older than `version`, newest first, with what's needed to analyse them. */
export const pendingAnalysis = query({
  args: { version: v.number() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const games = await ctx.db
      .query("games")
      .withIndex("by_user_and_playedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(200);
    return games
      .filter((g) => g.analysis?.version !== args.version)
      .map((g) => ({ _id: g._id, pgn: g.pgn, myColor: g.myColor }));
  },
});

export const saveAnalysis = mutation({
  args: { id: v.id("games"), analysis: analysisValidator, puzzles: v.optional(v.array(puzzleSeed)) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const game = await ctx.db.get("games", args.id);
    if (!game || game.userId !== userId) throw new Error("Game not found");
    await ctx.db.patch("games", args.id, { analysis: args.analysis });
    if (!args.puzzles) return;

    // replace this game's puzzles, keeping the practice history of any that are still the same position
    const existing = await ctx.db
      .query("puzzles")
      .withIndex("by_user_and_game", (q) => q.eq("userId", userId).eq("gameId", args.id))
      .take(200);
    const now = Date.now();
    for (const seed of args.puzzles) {
      const same = existing.find((p) => p.ply === seed.ply && p.fen === seed.fen);
      if (same) await ctx.db.patch("puzzles", same._id, seed);
      else await ctx.db.insert("puzzles", { userId, gameId: args.id, ...seed, box: 0, due: now, attempts: 0, solves: 0 });
    }
    for (const p of existing) {
      if (!args.puzzles.some((s) => s.ply === p.ply && s.fen === p.fen)) await ctx.db.delete("puzzles", p._id);
    }
  },
});

export const remove = mutation({
  args: { id: v.id("games") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const game = await ctx.db.get("games", args.id);
    if (!game || game.userId !== userId) throw new Error("Game not found");
    const puzzles = await ctx.db
      .query("puzzles")
      .withIndex("by_user_and_game", (q) => q.eq("userId", userId).eq("gameId", args.id))
      .take(200);
    for (const p of puzzles) await ctx.db.delete("puzzles", p._id);
    await ctx.db.delete("games", args.id);
  },
});
