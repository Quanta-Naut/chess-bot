import { getAuthUserId } from "@convex-dev/auth/server";
import { v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, query } from "./_generated/server";

const DEFAULT_MODEL = "openrouter/free";
const MAX_CHARS = 400;
const MIN_CHARS = 40;
const ATTEMPTS = 3;
// answers that are a safety verdict or the model's own thinking rather than the note
const LEAKED = /\b(user|agent) safety\b|^(okay|ok|alright|so|hmm)\b|^(the user|we need|i need|let me|let's)\b|\bthe user wants\b/i;

// Everything the engine and the rule-based explainer already worked out. The model only words it.
const factsValidator = v.object({
  myColor: v.union(v.literal("white"), v.literal("black")),
  mine: v.boolean(),
  move: v.string(), // numbered SAN, e.g. "5. Nxf7" or "12… Qd7"
  label: v.string(),
  evalBefore: v.string(), // from the user's side
  evalAfter: v.string(),
  better: v.optional(v.string()),
  lineTag: v.optional(v.string()),
  line: v.optional(v.string()),
  finding: v.optional(v.string()),
});

const SYSTEM = `You write the coaching note on a chess game-review card, speaking to the player as "you".
Write 1-2 short sentences, at most 40 words, plain text with no markdown and no headings.
Use ONLY the facts you are given. Never invent moves, captures, threats or evaluations, and never suggest a move that isn't in the facts.
The "Engine finding" is verified: keep its meaning exactly, but explain the idea behind it in human terms (what it attacks, what it gives up, what plan it starts).
Be careful about sides: "you" are the player named in the facts, "your opponent" is the other side.
Don't open by restating the move or its label; the card already shows them.`;

function prompt(f: Infer<typeof factsValidator>): string {
  const opp = f.myColor === "white" ? "Black" : "White";
  const lines = [
    `You play ${f.myColor === "white" ? "White" : "Black"}; your opponent plays ${opp}.`,
    `Move: ${f.move}, played by ${f.mine ? "you" : "your opponent"}.`,
    `Verdict: ${f.label}.`,
    `Evaluation from your side: ${f.evalBefore} before the move, ${f.evalAfter} after it.`,
  ];
  if (f.better) lines.push(`Stronger move the engine preferred: ${f.better}.`);
  if (f.line) lines.push(`${f.lineTag ?? "Engine line"}: ${f.line}`);
  if (f.finding) lines.push(`Engine finding: ${f.finding}`);
  lines.push(
    f.mine
      ? "Write the note for your own move."
      : "Write the note about your opponent's move: say what it does and, if it's bad, how you can take advantage.",
  );
  return lines.join("\n");
}

export const note = query({
  args: { key: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const row = await ctx.db
      .query("coachNotes")
      .withIndex("by_user_and_key", (q) => q.eq("userId", userId).eq("key", args.key))
      .unique();
    return row?.text ?? null;
  },
});

export const context = internalQuery({
  args: { userId: v.id("users"), key: v.string() },
  returns: v.object({ cached: v.boolean(), model: v.string() }),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("coachNotes")
      .withIndex("by_user_and_key", (q) => q.eq("userId", args.userId).eq("key", args.key))
      .unique();
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    return { cached: row !== null, model: profile?.model || DEFAULT_MODEL };
  },
});

export const save = internalMutation({
  args: { userId: v.id("users"), key: v.string(), text: v.string(), model: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("coachNotes")
      .withIndex("by_user_and_key", (q) => q.eq("userId", args.userId).eq("key", args.key))
      .unique();
    if (!existing) await ctx.db.insert("coachNotes", args);
    return null;
  },
});

/** Write (and cache) the AI note for one move. Returns quietly on any failure: the card keeps its template text. */
export const explain = action({
  args: { key: v.string(), facts: factsValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return null;

    const { cached, model } = await ctx.runQuery(internal.coach.context, { userId, key: args.key });
    if (cached) return null;

    // openrouter/free picks a model at random and some picks can't do this job, so check the answer and re-roll
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const out = await ask(apiKey, model, args.facts);
      if (out === "stop") return null;
      if (!out) continue;
      await ctx.runMutation(internal.coach.save, { userId, key: args.key, text: out.text, model: out.model });
      return null;
    }
    return null;
  },
});

/** One OpenRouter call. null = unusable answer (worth retrying), "stop" = don't retry (rate limit, bad key). */
async function ask(apiKey: string, model: string, facts: Infer<typeof factsValidator>) {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "Pawnie" },
      body: JSON.stringify({
        model,
        // free picks are often thinking models: leave room for the thinking before the answer
        max_tokens: 2000,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt(facts) },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn("coach: OpenRouter returned", res.status, (await res.text()).slice(0, 300));
      return res.status >= 500 ? null : "stop";
    }
    const body = (await res.json()) as { model?: string; choices?: { message?: { content?: unknown } }[] };
    const used = body.model ?? model;
    const content = body.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? clean(content) : "";
    if (/safety|guard/i.test(used) || text.length < MIN_CHARS || LEAKED.test(text)) {
      console.warn(`coach: unusable answer from ${used}: ${JSON.stringify(text.slice(0, 80))}`);
      return null;
    }
    return { text, model: used };
  } catch (e) {
    // network failure or timeout (which can also hit while the body is still arriving)
    console.warn("coach: request failed", e);
    return null;
  }
}

function clean(s: string): string {
  const text = s
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^"(.*)"$/, "$1");
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS).replace(/\s+\S*$/, "")}…` : text;
}
