import { getAuthUserId } from "@convex-dev/auth/server";
import { v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalQuery, mutation, query } from "./_generated/server";
import { chat } from "./coach";

const DAY = 24 * 60 * 60 * 1000;
// keep in step with REVIEW_DAYS in src/lib/lab.ts
const REVIEW_DAYS = [1, 3, 7, 14, 30];
const LESSON_DONE = 2;

/** Your progress with every opening and colour, and the lessons still to fix. */
export const progress = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const rows = await ctx.db
      .query("labProgress")
      .withIndex("by_user_and_key", (q) => q.eq("userId", userId))
      .take(200);
    const lessons = await ctx.db
      .query("labLessons")
      .withIndex("by_user_and_key", (q) => q.eq("userId", userId))
      .take(500);
    return {
      rows: rows.map(({ key, learned, practiced, sparred, lastAt, due }) => ({ key, learned, practiced, sparred, lastAt, due })),
      lessons: lessons.map(({ _id, key, fen, played, best, reason, fixed }) => ({ id: _id, key, fen, played, best, reason, fixed })),
    };
  },
});

/** Finish a run through the line, learning or sparring (clean = no slips and no hints). */
export const finish = mutation({
  args: { key: v.string(), mode: v.union(v.literal("learn"), v.literal("spar")), clean: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const now = Date.now();
    const row = await ctx.db
      .query("labProgress")
      .withIndex("by_user_and_key", (q) => q.eq("userId", userId).eq("key", args.key))
      .unique();
    const cur = row ?? { learned: false, practiced: 0, sparred: 0, due: undefined as number | undefined };
    const next = {
      learned: true,
      // a clean learning run counts toward knowing the line
      practiced: cur.practiced + (args.mode !== "spar" && args.clean ? 1 : 0),
      sparred: cur.sparred + (args.mode === "spar" && args.clean ? 1 : 0),
      lastAt: now,
      due: cur.due,
    };
    if (args.mode === "spar") {
      // a clean run pushes the next review out; a slip brings it back to tomorrow
      next.due = now + (args.clean ? REVIEW_DAYS[Math.min(cur.sparred, REVIEW_DAYS.length - 1)] : 1) * DAY;
    }
    if (row) await ctx.db.patch("labProgress", row._id, next);
    else await ctx.db.insert("labProgress", { userId, key: args.key, ...next });
    return null;
  },
});

/** Save a punished move as a lesson (once per position). */
export const addLesson = mutation({
  args: { key: v.string(), fen: v.string(), played: v.string(), best: v.string(), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const fen = args.fen.slice(0, 100);
    const existing = await ctx.db
      .query("labLessons")
      .withIndex("by_user_and_fen", (q) => q.eq("userId", userId).eq("fen", fen))
      .first();
    const data = { played: args.played.slice(0, 12), best: args.best.slice(0, 12), reason: args.reason.slice(0, 400), fixed: 0, at: Date.now() };
    if (existing) await ctx.db.patch("labLessons", existing._id, data);
    else await ctx.db.insert("labLessons", { userId, key: args.key.slice(0, 40), fen, ...data });
    return null;
  },
});

/** A lesson tried again: finding a good move counts toward fixing it, missing it starts over. */
export const lessonResult = mutation({
  args: { id: v.id("labLessons"), ok: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const lesson = await ctx.db.get("labLessons", args.id);
    if (!lesson || lesson.userId !== userId) return null;
    const fixed = args.ok ? lesson.fixed + 1 : 0;
    if (fixed >= LESSON_DONE) await ctx.db.delete("labLessons", lesson._id);
    else await ctx.db.patch("labLessons", lesson._id, { fixed, at: Date.now() });
    return null;
  },
});

// ---------- what real players do: the Lichess opening explorer ----------
// Needs a Lichess API token (any token, no scopes) in the LICHESS_TOKEN env var; without one the Lab
// just leaves this out.

const explorerMove = v.object({ uci: v.string(), san: v.string(), games: v.number(), white: v.number(), draws: v.number(), black: v.number() });

/** Moves played in this position by 1200-1800 players in rapid and blitz games on Lichess, most played first. */
export const explore = action({
  args: { fen: v.string() },
  returns: v.union(v.null(), v.object({ games: v.number(), white: v.number(), draws: v.number(), black: v.number(), moves: v.array(explorerMove) })),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const token = process.env.LICHESS_TOKEN;
    if (!token) return null;
    const url = `https://explorer.lichess.ovh/lichess?variant=standard&speeds=blitz,rapid,classical&ratings=1200,1400,1600,1800&moves=12&topGames=0&recentGames=0&fen=${encodeURIComponent(args.fen)}`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        console.warn("explorer returned", res.status);
        return null;
      }
      const body = (await res.json()) as { white: number; draws: number; black: number; moves: { uci: string; san: string; white: number; draws: number; black: number }[] };
      return {
        games: body.white + body.draws + body.black,
        white: body.white,
        draws: body.draws,
        black: body.black,
        moves: body.moves.map((m) => ({ uci: m.uci, san: m.san, games: m.white + m.draws + m.black, white: m.white, draws: m.draws, black: m.black })),
      };
    } catch (e) {
      console.warn("explorer failed", e);
      return null;
    }
  },
});

// ---------- the coach's words on a punished move ----------

const slipFacts = v.object({
  side: v.union(v.literal("white"), v.literal("black")),
  opening: v.string(),
  moves: v.string(), // the game so far, numbered SAN, ending with the slip
  played: v.string(),
  line: v.string(), // the engine's punishing line after the slip, numbered SAN
  steps: v.array(v.string()), // the slip and each move of that line in plain words, worked out from the board
  finding: v.string(), // the rule-based explanation (what is lost, or how much)
  rule: v.optional(v.string()),
  bookIdea: v.optional(v.string()), // what the right move would have done (never its name)
  humans: v.optional(v.string()), // what players at this level do and score here
});

const SLIP_SYSTEM = `You are a friendly chess coach for a club player (about 1300) learning an opening by playing it.
They just played a move that gets punished. In 2-3 short sentences (at most 60 words), tell them what happens next because of it:
which of the opponent's moves hurts and what it attacks, wins or opens up, using ONLY the moves in the line you are given.
Speak to the player as "you" and the other side as "your opponent". Plain text, no markdown, no lists.
The "What happens, move by move" list is checked against the board: base every claim on it, and use its exact pieces,
squares and owners ("your" pieces belong to the player, "their" pieces to the opponent). Don't add captures, threats or traps it doesn't list.
Never name the better move; you may describe its idea.`;

function slipPrompt(f: Infer<typeof slipFacts>) {
  const you = f.side === "white" ? "White" : "Black";
  const lines = [
    `Opening: ${f.opening}. You play ${you}; your opponent plays ${f.side === "white" ? "Black" : "White"}.`,
    `Moves so far: ${f.moves}`,
    `Your move: ${f.played}.`,
    `Engine's punishing line after it: ${f.line}`,
    `What happens, move by move:\n${f.steps.map((x) => `- ${x}`).join("\n")}`,
    `Engine finding: ${f.finding}`,
  ];
  if (f.rule) lines.push(`Opening rule it breaks: ${f.rule}`);
  if (f.bookIdea) lines.push(`What the right move would have done instead: ${f.bookIdea}`);
  if (f.humans) lines.push(`Real games at this level: ${f.humans}`);
  lines.push("Explain what goes wrong for you after your move.");
  return lines.join("\n");
}

/** The coach's explanation of a punished move, cached per position and move. */
export const explainSlip = action({
  args: { key: v.string(), facts: slipFacts },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const key = `lab:${args.key}`.slice(0, 200);
    const { cached } = await ctx.runQuery(internal.coach.context, { userId, key });
    if (cached) return await ctx.runQuery(internal.lab.cachedNote, { userId, key });
    const out = await chat(SLIP_SYSTEM, slipPrompt(args.facts));
    if (!out) return null;
    await ctx.runMutation(internal.coach.save, { userId, key, text: out.text, model: out.model });
    return out.text;
  },
});

export const cachedNote = internalQuery({
  args: { userId: v.id("users"), key: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("coachNotes")
      .withIndex("by_user_and_key", (q) => q.eq("userId", args.userId).eq("key", args.key))
      .unique();
    return row?.text ?? null;
  },
});
