import { Chess, type Move, type Square } from "chess.js";
import type { Key } from "chessground/types";

/** What the board needs to know about a position: legal destinations, side to move, check. */
export function positionInfo(fen: string) {
  const g = new Chess(fen);
  const dests = new Map<Key, Key[]>();
  for (const m of g.moves({ verbose: true })) {
    const list = dests.get(m.from) ?? [];
    list.push(m.to);
    dests.set(m.from, list);
  }
  return { dests, turn: g.turn() === "w" ? ("white" as const) : ("black" as const), check: g.inCheck(), over: g.isGameOver() };
}

/** Play one UCI move on `fen`; null if it isn't legal. */
export function playUci(fen: string, uci: string): Move | null {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: uci[4] });
  } catch {
    return null;
  }
}

/** A move dragged on the board, always promoting to a queen; null if it isn't legal. */
export function playDrag(fen: string, orig: Key, dest: Key): Move | null {
  try {
    return new Chess(fen).move({ from: orig, to: dest, promotion: "q" });
  } catch {
    return null;
  }
}

export const uciOf = (m: Move) => m.from + m.to + (m.promotion ?? "");
