// Thin UCI wrapper around Stockfish running as a WASM web worker (no server needed).

export const MATE = 100000;

export interface PositionEval {
  /** centipawns from White's point of view; mate scores are +-(MATE - distance) */
  cp: number;
  /** best move in UCI (e.g. "e2e4"), or "" if the game is over */
  best: string;
  /** eval of the 2nd best line (White's POV), if the position has one */
  secondCp: number | null;
  pv: string[];
}

function parseScore(line: string, whiteToMove: boolean): number | null {
  const m = line.match(/score (cp|mate) (-?\d+)/);
  if (!m) return null;
  const n = parseInt(m[2], 10);
  const side = whiteToMove ? 1 : -1;
  if (m[1] === "cp") return n * side;
  return (n > 0 ? MATE - n : -MATE - n) * side;
}

export interface SearchResult {
  best: string;
  lines: { cp: number; pv: string[] }[];
}

export class Engine {
  private worker: Worker;
  private ready: Promise<void>;
  private handler: ((line: string) => void) | null = null;
  private busy: Promise<unknown> = Promise.resolve();

  constructor() {
    this.worker = new Worker(`${import.meta.env?.BASE_URL ?? "/"}engine/stockfish-19-lite-single.js`);
    this.worker.onmessage = (e: MessageEvent) => this.handler?.(String(e.data));
    this.ready = this.init();
  }

  private waitFor(token: string): Promise<void> {
    return new Promise((resolve) => {
      this.handler = (line) => {
        if (line.startsWith(token)) {
          this.handler = null;
          resolve();
        }
      };
    });
  }

  private async init() {
    const uciok = this.waitFor("uciok");
    this.worker.postMessage("uci");
    await uciok;
    this.worker.postMessage("setoption name MultiPV value 2");
    const readyok = this.waitFor("readyok");
    this.worker.postMessage("isready");
    await readyok;
  }

  /**
   * Run one search: `options` are UCI setoption lines sent first (they stay set on this engine),
   * `go` is the search limit, e.g. "depth 14" or "movetime 500". Calls are queued so they never overlap.
   * Lines are indexed by MultiPV rank (0 = best), scores from White's point of view.
   */
  search(fen: string, go: string, options: string[] = []): Promise<SearchResult> {
    const run = async (): Promise<SearchResult> => {
      await this.ready;
      const whiteToMove = fen.split(" ")[1] === "w";
      return new Promise((resolve) => {
        const lines: { cp: number; pv: string[] }[] = [];
        this.handler = (line) => {
          if (line.startsWith("info") && line.includes(" pv ") && line.includes("score")) {
            const mp = parseInt(line.match(/multipv (\d+)/)?.[1] ?? "1", 10);
            const cp = parseScore(line, whiteToMove);
            if (cp !== null) lines[mp - 1] = { cp, pv: line.split(" pv ")[1].trim().split(" ") };
          } else if (line.startsWith("bestmove")) {
            this.handler = null;
            const best = line.split(" ")[1];
            resolve({ best: best && best !== "(none)" ? best : "", lines: lines.filter(Boolean) });
          }
        };
        for (const o of options) this.worker.postMessage(o);
        // no "ucinewgame": keeping the hash from nearby positions makes the next search much faster
        this.worker.postMessage(`position fen ${fen}`);
        this.worker.postMessage(`go ${go}`);
      });
    };
    const p = this.busy.then(run, run);
    this.busy = p.catch(() => undefined);
    return p;
  }

  /** Analyse one position to a fixed depth. */
  async evaluate(fen: string, depth: number): Promise<PositionEval> {
    const { best, lines } = await this.search(fen, `depth ${depth}`);
    return { cp: lines[0]?.cp ?? 0, best, secondCp: lines[1]?.cp ?? null, pv: lines[0]?.pv ?? [] };
  }

  terminate() {
    this.worker.terminate();
  }
}

let shared: Engine | null = null;
export function getEngine(): Engine {
  if (!shared) shared = new Engine();
  return shared;
}

let pool: Engine[] | null = null;
/**
 * Engines for analysing a whole game in parallel, one per spare CPU core (2 to 6).
 * The first is the shared engine; the rest stay alive for the next game.
 */
export function getPool(): Engine[] {
  if (!pool) {
    const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
    const n = Math.max(2, Math.min(6, cores - 1));
    pool = [getEngine(), ...Array.from({ length: n - 1 }, () => new Engine())];
  }
  return pool;
}
