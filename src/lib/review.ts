import { Chess, type Move, type Square } from "chess.js";
import { getEngine, getPool, MATE, type Engine, type PositionEval } from "./engine";
import { explain, type MistakeKind } from "./explain";

export type Label =
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good"
  | "book"
  | "inaccuracy"
  | "mistake"
  | "miss"
  | "blunder";

export type Phase = "opening" | "middlegame" | "endgame";

/** Moves graded as errors: these get explained, counted as mistakes, and turned into puzzles. */
export const BAD_LABELS: Label[] = ["inaccuracy", "mistake", "miss", "blunder"];

export interface MoveAnalysis {
  san: string;
  uci: string;
  cp: number;
  best: string;
  bestSan: string;
  bestCp: number;
  label: Label;
  /** for bad moves only */
  kind?: MistakeKind;
  phase?: Phase;
}

/** A mistake of yours, as a puzzle: find the engine's line from `fen` instead of `played`. */
export interface PuzzleSeed {
  ply: number;
  fen: string;
  played: string;
  label: Label;
  kind: MistakeKind;
  phase: Phase;
  solution: string[];
}

// up to 4 of your moves and the replies between them
const PUZZLE_PLIES = 7;

/**
 * Trim an engine line to the part worth solving: the first move, then more of your moves
 * only while the line stays forcing (a capture, check or promotion by either side since your last move).
 * Quiet follow-ups are a matter of taste, not a puzzle.
 */
function puzzleLine(fen: string, pv: string[]): string[] {
  const g = new Chess(fen);
  const forcing: boolean[] = [];
  for (const u of pv.slice(0, PUZZLE_PLIES)) {
    try {
      const m = g.move({ from: u.slice(0, 2) as Square, to: u.slice(2, 4) as Square, promotion: u[4] });
      forcing.push(!!m.captured || !!m.promotion || m.san.includes("+") || m.san.includes("#"));
    } catch {
      break;
    }
  }
  let plies = Math.min(1, forcing.length);
  for (let j = 2; j < forcing.length; j += 2) {
    if (!(forcing[j - 2] || forcing[j - 1] || forcing[j])) break;
    plies = j + 1;
  }
  return pv.slice(0, plies);
}

export interface Analysis {
  depth: number;
  version?: number;
  moves: MoveAnalysis[];
  accuracy: number;
  summary: Record<string, number>;
}

/** Lichess' win-probability curve: centipawns (mover's POV) -> 0..100 */
export const winPct = (cp: number) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);

const moveAccuracy = (loss: number) =>
  Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Bump when the grading rules change, so saved reviews are redone the next time they're opened. */
export const ANALYSIS_VERSION = 3;
/** Engine depth for game reviews. */
export const REVIEW_DEPTH = 14;

/**
 * Material the side to move wins by capturing on `sq`, with both sides recapturing
 * with their cheapest piece and free to stop. Uses legal moves, so pinned pieces don't count.
 */
function exchange(g: Chess, sq: Square): number {
  const caps = g.moves({ verbose: true }).filter((m) => m.to === sq && m.captured);
  if (!caps.length) return 0;
  const cost = (p: string) => (p === "k" ? 100 : VALUE[p]);
  const m = caps.reduce((a, b) => (cost(b.piece) < cost(a.piece) ? b : a));
  g.move(m);
  const back = exchange(g, sq);
  g.undo();
  return Math.max(0, VALUE[m.captured!] - back);
}

/**
 * Material the move really gives away: the most the opponent can win on any square
 * holding one of the mover's pieces (knight or better), minus anything the move itself took.
 * An even trade (bishop takes knight, pawn takes back) gives away nothing.
 */
function sacrificed(fenBefore: string, uci: string): number {
  const g = new Chess(fenBefore);
  const mover = g.turn();
  let played: Move;
  try {
    played = g.move({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: uci[4] });
  } catch {
    return 0;
  }
  if (g.isCheckmate()) return 0;
  let offered = 0;
  for (const row of g.board()) {
    for (const sq of row) {
      if (sq && sq.color === mover && VALUE[sq.type] >= 3) offered = Math.max(offered, exchange(g, sq.square));
    }
  }
  return offered - (played.captured ? VALUE[played.captured] : 0);
}

/**
 * Expected-points loss to label, with Chess.com's published bands
 * (best 0, excellent up to 2%, good up to 5%, inaccuracy up to 10%, mistake up to 20%).
 */
export function basicLabel(loss: number, isBest: boolean): Label {
  if (isBest) return "best";
  if (loss <= 2) return "excellent";
  if (loss <= 5) return "good";
  if (loss <= 10) return "inaccuracy";
  if (loss <= 20) return "mistake";
  return "blunder";
}

/** Win-chance loss for the mover, in 0..100. Playing the engine's own move loses nothing, even if a later search disagrees. */
export function moveLoss(before: PositionEval, after: PositionEval, uci: string, white: boolean): number {
  if (uci === before.best) return 0;
  const sign = white ? 1 : -1;
  return Math.max(0, winPct(before.cp * sign) - winPct(after.cp * sign));
}

/**
 * Brilliant and Great, after Chess.com's rules:
 * - Brilliant: a real piece sacrifice that is the best or nearly best move, leaves you
 *   no worse off, and wasn't needed to be winning anyway.
 * - Great: the only good move, and it decides the result (the next best changes the outcome).
 *   Captures, recaptures and forced moves don't count: they're just the obvious move.
 */
function special(fenBefore: string, uci: string, before: PositionEval, after: PositionEval, white: boolean, prev?: Move): Label | null {
  const sign = white ? 1 : -1;
  const loss = moveLoss(before, after, uci, white);
  if (loss > 2) return null;
  const wpBefore = winPct(before.cp * sign);
  const wpAfter = Math.max(wpBefore - loss, winPct(after.cp * sign));
  const wpSecond = before.secondCp === null ? null : winPct(before.secondCp * sign);

  if (sacrificed(fenBefore, uci) >= 2 && wpAfter >= 50 && wpBefore < 95 && (wpSecond === null || wpSecond < 90)) return "brilliant";

  const g = new Chess(fenBefore);
  if (uci !== before.best || wpSecond === null || g.moves().length < 2) return null;
  const to = uci.slice(2, 4);
  if (g.get(to as Square) || prev?.to === to) return null;
  const decisive = wpBefore - wpSecond >= 10 && bracket(wpSecond) < bracket(wpBefore);
  return decisive && wpBefore >= 40 && wpBefore < 90 ? "great" : null;
}

/**
 * Opening while most pieces are still on and it's early, endgame once at most 6 pieces
 * (knights, bishops, rooks, queens; both sides) are left, middlegame in between.
 */
export function phaseOf(fen: string, ply: number): Phase {
  const pieces = (fen.split(" ")[0].match(/[nbrqNBRQ]/g) ?? []).length;
  if (pieces <= 6) return "endgame";
  return ply < 20 && pieces > 10 ? "opening" : "middlegame";
}

/** losing / worse / equal / better / winning */
function bracket(wp: number): number {
  return wp < 20 ? 0 : wp < 40 ? 1 : wp <= 60 ? 2 : wp < 80 ? 3 : 4;
}

export async function evaluateFen(fen: string, depth: number, engine: Engine = getEngine()): Promise<PositionEval> {
  const g = new Chess(fen);
  if (g.isCheckmate()) return { cp: g.turn() === "w" ? -MATE : MATE, best: "", secondCp: null, pv: [] };
  if (g.isDraw() || g.isGameOver()) return { cp: 0, best: "", secondCp: null, pv: [] };
  return engine.evaluate(fen, depth);
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
): Promise<{ analysis: Analysis; puzzles: PuzzleSeed[] }> {
  const parsed = new Chess();
  parsed.loadPgn(pgn);
  const verbose = parsed.history({ verbose: true });
  // Evaluate every position once (n + 1 of them); eval-after of move i is eval-before of move i+1.
  const fens: string[] = [verbose[0]?.before ?? new Chess().fen(), ...verbose.map((m) => m.after)];
  // every engine in the pool takes the next unanalysed position until none are left
  const evals: PositionEval[] = new Array(fens.length);
  let next = 0;
  let done = 0;
  await Promise.all(
    getPool().map(async (engine) => {
      while (next < fens.length) {
        const i = next++;
        evals[i] = await evaluateFen(fens[i], depth, engine);
        onProgress?.(++done, fens.length);
      }
    }),
  );

  const moves: MoveAnalysis[] = [];
  const puzzles: PuzzleSeed[] = [];
  const counts: Record<string, number> = {};
  const losses: number[] = [];
  const lossAt: number[] = [];

  verbose.forEach((m, i) => {
    const white = m.color === "w";
    const mine = white === (myColor === "white");
    const before = evals[i];
    const after = evals[i + 1];
    const uci = m.from + m.to + (m.promotion ?? "");
    const loss = moveLoss(before, after, uci, white);
    lossAt.push(loss);
    const isBest = uci === before.best;
    let label = special(fens[i], uci, before, after, white, verbose[i - 1]) ?? basicLabel(loss, isBest);

    // Miss (as on Chess.com): the opponent just made a mistake, the best move kept the advantage it handed over,
    // and this move gave a good part of it back. A move that loses outright stays a blunder.
    const wpBefore = winPct(before.cp * (white ? 1 : -1));
    if ((label === "inaccuracy" || label === "mistake") && i > 0 && lossAt[i - 1] >= 10 && wpBefore >= 60) label = "miss";

    const bestSan = before.best && !isBest ? uciToSan(fens[i], before.best) : m.san;
    const row: MoveAnalysis = { san: m.san, uci, cp: after.cp, best: before.best, bestSan, bestCp: before.cp, label };

    if (BAD_LABELS.includes(label)) {
      row.kind = explain(fens[i], uci, before, after, mine).kind;
      row.phase = phaseOf(fens[i], i);
      const solution = puzzleLine(fens[i], before.pv);
      if (mine && label !== "inaccuracy" && solution[0] === before.best && before.best) {
        puzzles.push({ ply: i, fen: fens[i], played: uci, label, kind: row.kind, phase: row.phase, solution });
      }
    }

    if (mine) {
      counts[label] = (counts[label] ?? 0) + 1;
      losses.push(loss);
    }
    moves.push(row);
  });

  const accuracy = losses.length
    ? Math.round((losses.reduce((a, l) => a + moveAccuracy(l), 0) / losses.length) * 10) / 10
    : 0;
  return { analysis: { depth, version: ANALYSIS_VERSION, moves, accuracy, summary: counts }, puzzles };
}

/** Per-side label counts and accuracy, derived from stored move data (works for either player). */
export function sideSummary(
  moves: { label: string; cp: number; bestCp: number; uci: string; best: string }[],
  color: "white" | "black",
): { counts: Record<string, number>; accuracy: number } {
  const counts: Record<string, number> = {};
  const sign = color === "white" ? 1 : -1;
  let sum = 0;
  let n = 0;
  moves.forEach((m, i) => {
    if ((i % 2 === 0) !== (color === "white")) return;
    counts[m.label] = (counts[m.label] ?? 0) + 1;
    const loss = m.label === "book" || m.uci === m.best ? 0 : Math.max(0, winPct(m.bestCp * sign) - winPct(m.cp * sign));
    sum += moveAccuracy(loss);
    n++;
  });
  return { counts, accuracy: n ? Math.round((sum / n) * 10) / 10 : 0 };
}
