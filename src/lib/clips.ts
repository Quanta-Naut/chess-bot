import { Chess } from "chess.js";
import { positionKey } from "./openings";

// Short opening lessons built from the user's own games: positions they keep reaching,
// what their opponents usually play, where opponents blundered against them, and where they went wrong.

export type ClipKind = "your-move" | "their-favourite" | "trap" | "fell-for";

export interface Clip {
  id: string;
  kind: ClipKind;
  /** the side the user plays in these games */
  color: "white" | "black";
  /** SAN from the start to the quiz position, where it's the user's move */
  moves: string[];
  fen: string;
  hook: string;
  ask: string;
  /** what the user usually plays in the quiz position, if they've been there */
  usual?: { san: string; count: number; of: number };
  /** the user's mistake in the game (fell-for clips): not accepted as an answer */
  played?: string;
  /** the opponent's move that led here, and the position before it (trap clips, to explain why it loses) */
  theirMove?: { san: string; before: string };
}

export interface OpeningGame {
  myColor: "white" | "black";
  sans: string[];
  labels?: string[];
}

const ERRORS = ["mistake", "miss", "blunder"];
const MAX_PLY = 20;

interface Node {
  fen: string;
  path: string[];
  ply: number;
  color: "white" | "black";
  mine: boolean; // the user is to move
  count: number;
  moves: Map<string, number>;
  errors: Map<string, number>;
}

export function buildClips(games: OpeningGame[]): Clip[] {
  const nodes = new Map<string, Node>();
  for (const g of games) {
    const c = new Chess();
    for (let i = 0; i < Math.min(g.sans.length, MAX_PLY); i++) {
      const fen = c.fen();
      const key = `${g.myColor}|${positionKey(fen)}`;
      const mine = (i % 2 === 0) === (g.myColor === "white");
      let n = nodes.get(key);
      if (!n) {
        n = { fen, path: c.history(), ply: i, color: g.myColor, mine, count: 0, moves: new Map(), errors: new Map() };
        nodes.set(key, n);
      }
      const san = g.sans[i];
      n.count++;
      n.moves.set(san, (n.moves.get(san) ?? 0) + 1);
      if (g.labels && ERRORS.includes(g.labels[i])) n.errors.set(san, (n.errors.get(san) ?? 0) + 1);
      try {
        c.move(san);
      } catch {
        break;
      }
    }
  }

  const all = [...nodes.values()];
  const after = (n: Node, san: string) => {
    const c = new Chess(n.fen);
    c.move(san);
    return c.fen();
  };
  const usualAt = (fen: string, color: "white" | "black") => {
    const n = nodes.get(`${color}|${positionKey(fen)}`);
    if (!n) return undefined;
    const [san, count] = [...n.moves.entries()].sort((a, b) => b[1] - a[1])[0];
    return { san, count, of: n.count };
  };
  const seen = new Set<string>();
  const take = (clip: Clip) => {
    const key = `${clip.color}|${positionKey(clip.fen)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };

  const yours: Clip[] = all
    .filter((n) => n.mine && n.count >= 2 && n.ply >= 2)
    .sort((a, b) => b.count - a.count || b.ply - a.ply)
    .map((n) => ({
      id: `y|${n.color}|${positionKey(n.fen)}`,
      kind: "your-move" as const,
      color: n.color,
      moves: n.path,
      fen: n.fen,
      hook: `You've been here ${n.count} times`,
      ask: "Your move. What's best?",
      usual: usualAt(n.fen, n.color),
    }));

  const favourites: Clip[] = all
    // from the second move on: "most opponents play 1.e4" isn't a lesson
    .filter((n) => !n.mine && n.count >= 3 && n.ply >= 2)
    .sort((a, b) => b.count - a.count)
    .flatMap((n) => {
      const [san, count] = [...n.moves.entries()].sort((a, b) => b[1] - a[1])[0];
      if (count < 2) return [];
      const fen = after(n, san);
      return [
        {
          id: `f|${n.color}|${positionKey(fen)}`,
          kind: "their-favourite" as const,
          color: n.color,
          moves: [...n.path, san],
          fen,
          hook: `${count} of ${n.count} opponents play ${san} here`,
          ask: "How do you answer it?",
          usual: usualAt(fen, n.color),
        },
      ];
    });

  const traps: Clip[] = all
    .filter((n) => !n.mine)
    .flatMap((n) =>
      [...n.errors.entries()].map(([san, count]) => {
        const fen = after(n, san);
        const clip: Clip = {
          id: `t|${n.color}|${positionKey(fen)}`,
          kind: "trap" as const,
          color: n.color,
          moves: [...n.path, san],
          fen,
          hook: count === 1 ? `An opponent blundered here with ${san}` : `${count} opponents blundered here with ${san}`,
          ask: "Find the punishment!",
          usual: usualAt(fen, n.color),
          theirMove: { san, before: n.fen },
        };
        return { clip, weight: count };
      }),
    )
    .sort((a, b) => b.weight - a.weight)
    .map((x) => x.clip);

  const fell: Clip[] = all
    .filter((n) => n.mine)
    .flatMap((n) =>
      [...n.errors.entries()].map(([san, count]) => {
        const clip: Clip = {
          id: `m|${n.color}|${positionKey(n.fen)}`,
          kind: "fell-for",
          color: n.color,
          moves: n.path,
          fen: n.fen,
          hook: count === 1 ? `You went wrong here with ${san}` : `You went wrong here ${count} times with ${san}`,
          ask: "Find the move you missed.",
          played: san,
        };
        return { clip, weight: count };
      }),
    )
    .sort((a, b) => b.weight - a.weight)
    .map((x) => x.clip);

  // mix the kinds, so the feed doesn't show the same sort of clip over and over
  const lanes = [yours.slice(0, 8), traps.slice(0, 5), favourites.slice(0, 6), fell.slice(0, 5)];
  const out: Clip[] = [];
  for (let round = 0; lanes.some((l) => l.length > round); round++) {
    for (const lane of lanes) {
      const clip = lane[round];
      if (clip && take(clip)) out.push(clip);
    }
  }
  return out;
}
