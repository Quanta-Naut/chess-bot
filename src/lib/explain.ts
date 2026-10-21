import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";
import { MATE, type PositionEval } from "./engine";
import { uciToSan, winPct } from "./review";

const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const NAME: Record<PieceSymbol, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const LINE_PLIES = 10;
const SHOWN_PLIES = 6;

/** What kind of error a bad move was, for the puzzles and the insights report. */
export type MistakeKind = "allowed-mate" | "missed-mate" | "threw-win" | "fork" | "hanging" | "lost-material" | "missed-win" | "positional";

export const KIND_TEXT: Record<MistakeKind, string> = {
  "allowed-mate": "Allowed checkmate",
  "missed-mate": "Missed checkmate",
  "threw-win": "Let a win slip into a draw",
  fork: "Walked into a fork",
  hanging: "Left a piece hanging",
  "lost-material": "Lost material",
  "missed-win": "Missed winning material",
  positional: "Worsened the position",
};

export interface Insight {
  reason: string;
  kind: MistakeKind;
  /** the opponent's best answer (uci) and the engine line it starts, numbered SAN */
  reply?: string;
  replySan?: string;
  line?: string;
  better?: string;
}

/** material of `color` minus the other side's */
function balance(g: Chess, color: Color): number {
  let sum = 0;
  for (const row of g.board()) for (const sq of row) if (sq) sum += (sq.color === color ? 1 : -1) * VALUE[sq.type];
  return sum;
}

function amount(n: number): string {
  const words: Record<number, string> = { 1: "a pawn", 2: "two pawns", 3: "a piece", 4: "a piece and a pawn", 5: "a rook", 6: "a rook and a pawn" };
  return words[n] ?? (n >= 9 ? "a queen's worth of material" : `${n} points of material`);
}

/**
 * Play an engine line and report the material balance (for `color`) at the
 * deepest point where the line is quiet, so a capture whose recapture falls
 * past the end of the line isn't counted as won material.
 */
function walk(fen: string, pv: string[], color: Color) {
  const g = new Chess(fen);
  const moves: Move[] = [];
  const balances: number[] = [];
  for (const u of pv.slice(0, LINE_PLIES)) {
    try {
      moves.push(g.move({ from: u.slice(0, 2) as Square, to: u.slice(2, 4) as Square, promotion: u[4] }));
    } catch {
      break;
    }
    balances.push(balance(g, color));
  }
  let settled = moves.length;
  while (settled > 1 && moves[settled - 1].captured) settled--;
  const final = settled > 0 ? balances[settled - 1] : balance(new Chess(fen), color);
  return { moves, final };
}

function numbered(moves: Move[]): string {
  if (!moves.length) return "";
  let n = Number(moves[0].before.split(" ")[5]);
  return moves
    .slice(0, SHOWN_PLIES)
    .map((m, i) => {
      const text = m.color === "w" ? `${n}. ${m.san}` : i === 0 ? `${n}… ${m.san}` : m.san;
      if (m.color === "b") n++;
      return text;
    })
    .join(" ");
}

/** pieces of `victim` (worth a knight or more, or the king) attacked by the piece standing on `from` */
function forked(g: Chess, from: Square, victim: Color): PieceSymbol[] {
  const hit: PieceSymbol[] = [];
  for (const row of g.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== victim || (sq.type !== "k" && VALUE[sq.type] < 3)) continue;
      if (g.attackers(sq.square, victim === "w" ? "b" : "w").includes(from)) hit.push(sq.type);
    }
  }
  return hit.sort((a, b) => (a === "k" ? -1 : b === "k" ? 1 : VALUE[b] - VALUE[a]));
}

function standing(wp: number): string {
  if (wp >= 80) return "winning";
  if (wp >= 60) return "better";
  if (wp >= 40) return "roughly equal";
  if (wp >= 20) return "worse";
  return "losing";
}

/** The engine's expected continuation from a position, numbered SAN. */
export function engineLine(fen: string, ev: PositionEval): string {
  return numbered(walk(fen, ev.pv, fen.split(" ")[1] === "w" ? "w" : "b").moves);
}

/** A one-line verdict for a move that isn't bad. `better` is the engine's preferred move, if different. */
export function praise(label: string, better: string | undefined, mine: boolean): string {
  switch (label) {
    case "brilliant":
      return "A real sacrifice, and the engine agrees it works.";
    case "great":
      return `The only strong move in the position, and ${mine ? "you" : "they"} found it.`;
    case "best":
      return "It's the engine's top choice here.";
    case "book":
      return "A standard opening move.";
    case "excellent":
      return better ? `Nearly as strong as ${better}.` : "A strong move.";
    default:
      return better ? `Solid, but ${better} was stronger.` : "A solid move.";
  }
}

/**
 * Explain why a move is bad, from the engine evals of the position before and after it.
 * `mine` picks the pronouns: "you/your" for the user's moves, "they/their" for the opponent's.
 */
export function explain(before: string, playedUci: string, beforeEval: PositionEval, afterEval: PositionEval, mine: boolean): Insight {
  const mover: Color = before.split(" ")[1] === "w" ? "w" : "b";
  const sign = mover === "w" ? 1 : -1;
  const Subj = mine ? "You" : "They";
  const subj = mine ? "you" : "they";
  const poss = mine ? "your" : "their";

  const g = new Chess(before);
  const played = g.move({ from: playedUci.slice(0, 2) as Square, to: playedUci.slice(2, 4) as Square, promotion: playedUci[4] });
  const after = played.after;

  const better = beforeEval.best && beforeEval.best !== playedUci ? uciToSan(before, beforeEval.best) : undefined;
  const reply = walk(after, afterEval.pv, mover);
  const insight: Insight = {
    reason: "",
    kind: "positional",
    better,
    reply: afterEval.pv[0],
    replySan: reply.moves[0]?.san,
    line: numbered(reply.moves) || undefined,
  };

  const afterCp = afterEval.cp * sign;
  const beforeCp = beforeEval.cp * sign;
  const startBalance = balance(new Chess(before), mover);

  if (afterCp <= -(MATE - 200)) {
    const n = MATE + afterCp;
    insight.reason = n <= 1 ? `It allows checkmate with ${insight.replySan}.` : `It allows a forced mate in ${n}, starting with ${insight.replySan}.`;
    insight.kind = "allowed-mate";
    return insight;
  }

  if (beforeCp >= MATE - 200 && afterCp < MATE - 200) {
    const n = MATE - beforeCp;
    insight.reason = n <= 1 ? `${Subj} had mate in one with ${better}.` : `${Subj} had a forced mate in ${n}, starting with ${better}.`;
    insight.kind = "missed-mate";
    return insight;
  }

  const ended = new Chess(after);
  if (ended.isDraw() && beforeCp > 150) {
    insight.reason = ended.isStalemate() ? "It's stalemate, so a winning position ends in a draw." : "It lets a winning position slip into a draw.";
    insight.kind = "threw-win";
    return insight;
  }

  const lost = startBalance - reply.final;
  if (lost >= 2 && reply.moves[0]) {
    const first = reply.moves[0];
    const fork = forked(new Chess(first.after), first.to, mover);
    if (fork.length >= 2) {
      insight.reason = `${first.san} forks ${poss} ${fork.slice(0, 2).map((t) => NAME[t]).join(" and ")}. ${Subj} end up ${amount(lost)} down.`;
      insight.kind = "fork";
    } else if (first.captured && VALUE[first.captured] >= 3) {
      const piece = `${poss} ${NAME[first.captured]} on ${first.to}`;
      insight.reason =
        first.to === played.to
          ? `It leaves ${piece} hanging, and ${first.san} takes it. ${Subj} end up ${amount(lost)} down.`
          : `It drops ${piece}: ${first.san} takes it. ${Subj} end up ${amount(lost)} down.`;
      insight.kind = "hanging";
    } else {
      insight.reason = `After ${first.san}, ${subj} can't avoid losing material and end up ${amount(lost)} down.`;
      insight.kind = "lost-material";
    }
    return insight;
  }

  if (better && beforeEval.pv.length) {
    const gain = walk(before, beforeEval.pv, mover).final - startBalance;
    if (gain >= 2) {
      insight.reason = `${Subj} missed ${better}, which wins ${amount(gain)}.`;
      insight.kind = "missed-win";
      return insight;
    }
  }

  const wpBefore = winPct(beforeCp);
  const wpAfter = winPct(afterCp);
  insight.reason =
    standing(wpBefore) !== standing(wpAfter)
      ? `It turns a ${standing(wpBefore)} position into a ${standing(wpAfter)} one.`
      : `It throws away ${Math.round(wpBefore - wpAfter)}% of ${poss} winning chances.`;
  if (insight.replySan) insight.reason += ` ${mover === "w" ? "Black" : "White"}'s best reply is ${insight.replySan}.`;
  return insight;
}
