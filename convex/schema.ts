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
});

export const analysisValidator = v.object({
  depth: v.number(),
  moves: v.array(moveAnalysis),
  accuracy: v.number(),
  summary: v.record(v.string(), v.number()),
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
    source: v.union(v.literal("chesscom"), v.literal("lichess")),
    externalId: v.string(),
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
    .index("by_user_and_source_and_externalId", ["userId", "source", "externalId"]),

  // AI-written card notes, cached per position + move so each is generated once
  coachNotes: defineTable({
    userId: v.id("users"),
    key: v.string(),
    text: v.string(),
    model: v.string(),
  }).index("by_user_and_key", ["userId", "key"]),
});
