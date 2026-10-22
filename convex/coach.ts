import { getAuthUserId } from "@convex-dev/auth/server";
import { v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, query } from "./_generated/server";

// Tried in order, skipping any without a key. MiniMax M3.1 Flash on the Vercel AI Gateway explained 6 of 6 test
// blunders correctly in about 3s; GPT-OSS 120B got 4 of 6 in about 1s, so it's the backup when MiniMax is rate limited
// (the gateway's free tier allows about 5 requests a minute per model). OpenRouter's free models are the last resort.
// Thinking stays off where the model allows it: a short note doesn't need it, and it's much faster without.
// All of them speak the OpenAI chat API.
const GATEWAY = "https://ai-gateway.vercel.sh/v1/chat/completions";
const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";
const PROVIDERS = [
  { name: "AI Gateway MiniMax", url: GATEWAY, env: "AI_GATEWAY_API_KEY", model: "minimax/minimax-m3.1-flash", think: false },
  { name: "AI Gateway GPT-OSS", url: GATEWAY, env: "AI_GATEWAY_API_KEY", model: "openai/gpt-oss-120b", think: false },
  { name: "OpenRouter Nemotron Ultra", url: OPENROUTER, env: "OPENROUTER_API_KEY", model: "nvidia/nemotron-3-ultra-550b-a55b:free", think: false },
  { name: "OpenRouter free router", url: OPENROUTER, env: "OPENROUTER_API_KEY", model: "openrouter/free", think: true },
] as const;
type Provider = (typeof PROVIDERS)[number];
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
Never name a piece, square or plan that isn't in the facts: if you aren't told where a piece came from or what it attacks, don't say.
The "Engine finding" is verified: keep its meaning exactly, but explain the idea behind it in human terms (what it attacks, what it gives up, what plan it starts).
Be careful about sides: "you" are the player named in the facts, "your opponent" is the other side.
Don't open by restating the move or its label; the card already shows them.`;

function prompt(f: Infer<typeof factsValidator>): string {
  const opp = f.myColor === "white" ? "Black" : "White";
  const mover = f.mine ? (f.myColor === "white" ? "White" : "Black") : opp;
  const lines = [
    `You play ${f.myColor === "white" ? "White" : "Black"}; your opponent plays ${opp}.`,
    `Move: ${f.move}, played by ${f.mine ? "you" : "your opponent"}.`,
    `Verdict: ${f.label}.`,
    `Evaluation from your side: ${f.evalBefore} before the move, ${f.evalAfter} after it.`,
  ];
  if (f.better) lines.push(`Stronger move the engine preferred for ${mover} instead: ${f.better}.`);
  if (f.line) lines.push(`${f.lineTag ?? "Engine line"}: ${f.line}`);
  if (f.line) lines.push(`In the line, "12. Nf3" is a White move and "12… Nf6" is a Black move. Never tell the player to play one of their opponent's moves.`);
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
  returns: v.object({ cached: v.boolean(), model: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("coachNotes")
      .withIndex("by_user_and_key", (q) => q.eq("userId", args.userId).eq("key", args.key))
      .unique();
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    return { cached: row !== null, model: profile?.model || undefined };
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
    const { cached, model } = await ctx.runQuery(internal.coach.context, { userId, key: args.key });
    if (cached) return null;

    const out = await chat(SYSTEM, prompt(args.facts), model);
    if (out) await ctx.runMutation(internal.coach.save, { userId, key: args.key, text: out.text, model: out.model });
    return null;
  },
});

/**
 * Ask the first provider that gives a usable answer. For other features (the Opening Lab) that bring
 * their own instructions; null when every provider fails or none has a key.
 */
export async function chat(system: string, user: string, model?: string): Promise<{ text: string; model: string } | null> {
  // a model picked in the profile is tried first on each provider, then the provider's own (a picked model can go away)
  const models = [...new Set([model, undefined])];
  for (const provider of PROVIDERS) {
    const apiKey = process.env[provider.env];
    if (!apiKey) continue;
    for (const m of models) {
      // a model can still give an unusable answer (openrouter/free even picks one at random), so check it and retry
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const out = await ask(provider, apiKey, m ?? provider.model, system, user);
        if (out === "stop") break; // rate limit, bad key or unknown model: try the next one
        if (out) return out;
      }
    }
  }
  return null;
}

/** One chat call. null = unusable answer (worth retrying), "stop" = don't retry (rate limit, bad key). */
async function ask(provider: Provider, apiKey: string, model: string, system: string, user: string) {
  try {
    const res = await fetch(provider.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "Pawnie" },
      body: JSON.stringify({
        model,
        // where thinking stays on (openrouter/free's random picks), leave room for it before the answer
        max_tokens: provider.think ? 2000 : 400,
        temperature: 0.2, // stick to the facts rather than embellish
        ...(provider.think ? {} : { reasoning: { enabled: false } }),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn(`coach: ${provider.name} returned`, res.status, (await res.text()).slice(0, 300));
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
