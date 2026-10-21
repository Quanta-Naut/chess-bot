import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

const moveAnalysis = v.object({
  san: v.string(),
  uci: v.string(),
  // eval (centipawns, white's point of view) after the move; mate encoded as +-100000 +- distance
  cp: v.number(),
  // engine's preferred move in this position (uci) and its eval before the move
  best: v.string(),
  bestSan: v.string(),
  bestCp: v.number(),
  label: v.string(),
  // for bad moves: what kind of error (see MistakeKind in src/lib/explain.ts) and the game phase
  kind: v.optional(v.string()),
  phase: v.optional(v.string()),
});

export const analysisValidator = v.object({
  depth: v.number(),
  version: v.optional(v.number()), // grading rules the labels came from
  moves: v.array(moveAnalysis),
  accuracy: v.number(),
  summary: v.record(v.string(), v.number()),
});

// one of the user's mistakes, as a puzzle (built from the analysis in src/lib/review.ts)
export const puzzleSeed = v.object({
  ply: v.number(), // index of the mistaken move in the game
  fen: v.string(), // position to solve
  played: v.string(), // the move played in the game (uci)
  label: v.string(), // mistake | miss | blunder
  kind: v.string(),
  phase: v.string(),
  solution: v.array(v.string()), // engine line (uci), the solver's moves at even indexes
});

export default defineSchema({
  ...authTables,

  profiles: defineTable({
    userId: v.id("users"),
    chesscom: v.optional(v.string()),
    lichess: v.optional(v.string()),
    model: v.optional(v.string()),
  }).index("by_user", ["userId"]),

  games: defineTable({
    userId: v.id("users"),
    source: v.union(v.literal("chesscom"), v.literal("lichess"), v.literal("bot")),
    externalId: v.string(),
    code: v.optional(v.string()), // short id for the game's link, e.g. /g/k3x9m2qa7wpz
    pgn: v.string(),
    white: v.string(),
    black: v.string(),
    myColor: v.union(v.literal("white"), v.literal("black")),
    result: v.string(), // "1-0" | "0-1" | "1/2-1/2" | "*"
    playedAt: v.number(),
    timeClass: v.optional(v.string()),
    opening: v.optional(v.string()),
    analysis: v.optional(analysisValidator),
  })
    .index("by_user_and_playedAt", ["userId", "playedAt"])
    .index("by_user_and_source_and_externalId", ["userId", "source", "externalId"])
    .index("by_user_and_code", ["userId", "code"])
    .index("by_user_and_source_and_playedAt", ["userId", "source", "playedAt"]),

  // AI-written card notes, cached per position + move so each is generated once
  puzzles: defineTable({
    userId: v.id("users"),
    gameId: v.id("games"),
    ...puzzleSeed.fields,
    // spaced repetition: a solve moves it up a box (seen again later), a fail sends it back to box 0
    box: v.number(),
    due: v.number(),
    attempts: v.number(),
    solves: v.number(),
    lastResult: v.optional(v.union(v.literal("solved"), v.literal("failed"))),
  })
    .index("by_user_and_due", ["userId", "due"])
    .index("by_user_and_game", ["userId", "gameId"]),

  // answers in the openings clip feed, one row per clip (clip ids are position based, see src/lib/clips.ts)
  clipResults: defineTable({
    userId: v.id("users"),
    clipId: v.string(),
    attempts: v.number(),
    correct: v.number(),
    lastResult: v.union(v.literal("right"), v.literal("wrong")),
    lastAt: v.number(),
  }).index("by_user_and_clip", ["userId", "clipId"]),

  // the openings feed's points and streak
  clipScores: defineTable({
    userId: v.id("users"),
    xp: v.number(),
    streak: v.number(),
    best: v.number(),
  }).index("by_user", ["userId"]),

  coachNotes: defineTable({
    userId: v.id("users"),
    key: v.string(),
    text: v.string(),
    model: v.string(),
  }).index("by_user_and_key", ["userId", "key"]),
});
