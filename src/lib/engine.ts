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

  /** Analyse one position to a fixed depth. Calls are queued so they never overlap. */
  evaluate(fen: string, depth: number): Promise<PositionEval> {
    const run = async (): Promise<PositionEval> => {
      await this.ready;
      const whiteToMove = fen.split(" ")[1] === "w";
      return new Promise((resolve) => {
        const lines: Record<number, { cp: number; pv: string[] }> = {};
        this.handler = (line) => {
          if (line.startsWith("info") && line.includes(" pv ") && line.includes("score")) {
            const mp = parseInt(line.match(/multipv (\d+)/)?.[1] ?? "1", 10);
            const cp = parseScore(line, whiteToMove);
            if (cp !== null) lines[mp] = { cp, pv: line.split(" pv ")[1].trim().split(" ") };
          } else if (line.startsWith("bestmove")) {
            this.handler = null;
            const best = line.split(" ")[1];
            const top = lines[1];
            resolve({
              cp: top?.cp ?? 0,
              best: best && best !== "(none)" ? best : "",
              secondCp: lines[2]?.cp ?? null,
              pv: top?.pv ?? [],
            });
          }
        };
        this.worker.postMessage("ucinewgame");
        this.worker.postMessage(`position fen ${fen}`);
        this.worker.postMessage(`go depth ${depth}`);
      });
    };
    const p = this.busy.then(run, run);
    this.busy = p.catch(() => undefined);
    return p;
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
