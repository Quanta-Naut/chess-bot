import { Chess, type Square } from "chess.js";
import { getEngine, MATE, type PositionEval } from "./engine";

export type Label =
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good"
  | "book"
  | "inaccuracy"
  | "mistake"
  | "blunder";

export interface MoveAnalysis {
  san: string;
  uci: string;
  cp: number;
  best: string;
  bestSan: string;
  bestCp: number;
  label: Label;
}

export interface Analysis {
  depth: number;
  moves: MoveAnalysis[];
  accuracy: number;
  summary: Record<string, number>;
}

/** Lichess' win-probability curve: centipawns (mover's POV) -> 0..100 */
export const winPct = (cp: number) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);

const moveAccuracy = (loss: number) =>
  Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Did this move put a piece (not a pawn) where it can be won for free, or for less? */
function isSacrifice(fenBefore: string, uci: string): boolean {
  const g = new Chess(fenBefore);
  const mover = g.turn();
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const piece = g.get(from);
  if (!piece || VALUE[piece.type] < 3) return false;
  const captured = g.get(to);
  g.move({ from, to, promotion: uci[4] });
  const opp = mover === "w" ? "b" : "w";
  const attackers = g.attackers(to, opp);
  if (attackers.length === 0) return false;
  const cheapest = Math.min(...attackers.map((sq) => VALUE[g.get(sq)?.type ?? "k"] || 99));
  const defended = g.attackers(to, mover).length > 0;
  const gained = captured ? VALUE[captured.type] : 0;
  // loses material if captured for free, or by a cheaper piece than what we got
  return !defended || cheapest < VALUE[piece.type] - gained;
}

export function basicLabel(loss: number, isBest: boolean): Label {
  if (loss < 1.5) return isBest ? "best" : "excellent";
  if (loss < 6) return "good";
  if (loss < 12) return "inaccuracy";
  if (loss < 25) return "mistake";
  return "blunder";
}

export async function evaluateFen(fen: string, depth: number): Promise<PositionEval> {
  const g = new Chess(fen);
  if (g.isCheckmate()) return { cp: g.turn() === "w" ? -MATE : MATE, best: "", secondCp: null, pv: [] };
  if (g.isDraw() || g.isGameOver()) return { cp: 0, best: "", secondCp: null, pv: [] };
  return getEngine().evaluate(fen, depth);
}

export function uciToSan(fen: string, uci: string): string {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: uci[4] }).san;
  } catch {
    return uci;
  }
}

export function mateText(cp: number): string {
  if (Math.abs(cp) > MATE - 200) {
    const n = MATE - Math.abs(cp);
    return `${cp > 0 ? "" : "-"}M${n}`;
  }
  return (cp / 100).toFixed(1);
}

export async function reviewGame(
  pgn: string,
  myColor: "white" | "black",
  depth: number,
  onProgress?: (done: number, total: number) => void,
): Promise<Analysis> {
  const parsed = new Chess();
  parsed.loadPgn(pgn);
  const verbose = parsed.history({ verbose: true });
  // Evaluate every position once (n + 1 of them); eval-after of move i is eval-before of move i+1.
  const fens: string[] = [verbose[0]?.before ?? new Chess().fen(), ...verbose.map((m) => m.after)];
  const evals: PositionEval[] = [];
  for (let i = 0; i < fens.length; i++) {
    evals.push(await evaluateFen(fens[i], depth));
    onProgress?.(i + 1, fens.length);
  }

  const moves: MoveAnalysis[] = [];
  const counts: Record<string, number> = {};
  const losses: number[] = [];

  verbose.forEach((m, i) => {
    const white = m.color === "w";
    const sign = white ? 1 : -1;
    const before = evals[i];
    const after = evals[i + 1];
    const uci = m.from + m.to + (m.promotion ?? "");
    const wpBefore = winPct(before.cp * sign);
    const wpAfter = winPct(after.cp * sign);
    const loss = Math.max(0, wpBefore - wpAfter);
    const isBest = uci === before.best;

    let label = basicLabel(loss, isBest);

    if (label === "best" || label === "excellent") {
      const second = before.secondCp === null ? null : winPct(before.secondCp * sign);
      // brilliant: a real sacrifice that keeps the position healthy and isn't already trivially winning
      if (loss < 3 && wpAfter > 45 && wpBefore < 92 && isSacrifice(fens[i], uci)) {
        label = "brilliant";
      } else if (isBest && second !== null && wpBefore - second > 15 && wpAfter > 35 && Math.abs(after.cp) < MATE - 200) {
        // great: the only move that holds / wins
        label = "great";
      }
    }

    const bestSan = before.best && !isBest ? uciToSan(fens[i], before.best) : m.san;

    if (white === (myColor === "white")) {
      counts[label] = (counts[label] ?? 0) + 1;
      losses.push(loss);
    }
    moves.push({ san: m.san, uci, cp: after.cp, best: before.best, bestSan, bestCp: before.cp, label });
  });

  const accuracy = losses.length
    ? Math.round((losses.reduce((a, l) => a + moveAccuracy(l), 0) / losses.length) * 10) / 10
    : 0;
  return { depth, moves, accuracy, summary: counts };
}

/** Per-side label counts and accuracy, derived from stored move data (works for either player). */
export function sideSummary(
  moves: { label: string; cp: number; bestCp: number }[],
  color: "white" | "black",
): { counts: Record<string, number>; accuracy: number } {
  const counts: Record<string, number> = {};
  const sign = color === "white" ? 1 : -1;
  let sum = 0;
  let n = 0;
  moves.forEach((m, i) => {
    if ((i % 2 === 0) !== (color === "white")) return;
    counts[m.label] = (counts[m.label] ?? 0) + 1;
    const loss = m.label === "book" ? 0 : Math.max(0, winPct(m.bestCp * sign) - winPct(m.cp * sign));
    sum += moveAccuracy(loss);
    n++;
  });
  return { counts, accuracy: n ? Math.round((sum / n) * 10) / 10 : 0 };
}
