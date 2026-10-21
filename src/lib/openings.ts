import { Chess } from "chess.js";

// Opening names from lichess-org/chess-openings (public domain), keyed by position
// (board, side to move, castling, en passant), so transpositions get their name too.
type Entry = [eco: string, name: string, moves: string];
let table: Promise<Record<string, Entry>> | null = null;

export function loadOpenings(): Promise<Record<string, Entry>> {
  table ??= fetch(`${import.meta.env.BASE_URL}openings.json`).then((r) => r.json() as Promise<Record<string, Entry>>);
  return table;
}

export const positionKey = (fen: string) => fen.split(" ").slice(0, 4).join(" ");

export interface OpeningName {
  eco: string;
  name: string;
  /** the family, e.g. "Sicilian Defense" for "Sicilian Defense: Najdorf Variation" */
  family: string;
  /** how many plies into the game the last named position was */
  ply: number;
}

/** The most specific opening name the game passes through, from its moves in SAN. */
export function nameOpening(openings: Record<string, Entry>, sans: string[]): OpeningName | null {
  const g = new Chess();
  let found: OpeningName | null = null;
  for (let i = 0; i < sans.length; i++) {
    try {
      g.move(sans[i]);
    } catch {
      break;
    }
    const hit = openings[positionKey(g.fen())];
    if (hit) found = { eco: hit[0], name: hit[1], family: hit[1].split(":")[0], ply: i + 1 };
  }
  return found;
}
