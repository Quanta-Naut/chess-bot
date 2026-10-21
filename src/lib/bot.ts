import { Chess } from "chess.js";
import { Engine, MATE } from "./engine";

export const MIN_ELO = 400;
export const MAX_ELO = 2500;
// Stockfish's own strength limit doesn't go lower than this
const SF_MIN_ELO = 1320;

let engine: Engine | null = null;
// a separate engine: the bot's strength options would otherwise leak into game reviews
const botEngine = () => (engine ??= new Engine());

/** The bot's move (uci) at roughly `elo` strength. */
export async function botMove(fen: string, elo: number): Promise<string> {
  if (elo >= SF_MIN_ELO) {
    const r = await botEngine().search(fen, `movetime ${thinkTime(elo)}`, [
      "setoption name MultiPV value 1",
      "setoption name UCI_LimitStrength value true",
      `setoption name UCI_Elo value ${Math.round(elo)}`,
    ]);
    return r.best;
  }

  // Weaker than Stockfish's limit: look at the top few moves and pick among them, the worse ones
  // more often the lower the rating, plus the occasional outright blunder a low-rated player makes.
  const weak = (SF_MIN_ELO - elo) / (SF_MIN_ELO - MIN_ELO); // 0 at 1320, 1 at the minimum
  const legal = new Chess(fen).moves({ verbose: true });
  if (legal.length === 0) return "";
  if (Math.random() < 0.12 * weak) {
    const m = legal[Math.floor(Math.random() * legal.length)];
    return m.from + m.to + (m.promotion ?? "");
  }
  const r = await botEngine().search(fen, `depth ${elo < 800 ? 4 : 7}`, [
    "setoption name UCI_LimitStrength value false",
    "setoption name MultiPV value 5",
  ]);
  if (!r.lines.length) return r.best;
  const sign = fen.split(" ")[1] === "w" ? 1 : -1;
  // mates count as a big but finite score, so the softmax still prefers them strongly
  const score = (cp: number) => (Math.abs(cp) > MATE - 200 ? Math.sign(cp * sign) * 2000 : Math.max(-2000, Math.min(2000, cp * sign)));
  // softmax over the scores: temperature in centipawns, hotter (more random) for lower ratings
  const temp = 40 + 400 * weak;
  const top = Math.max(...r.lines.map((l) => score(l.cp)));
  const weights = r.lines.map((l) => Math.exp((score(l.cp) - top) / temp));
  let pick = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    pick -= weights[i];
    if (pick <= 0) return r.lines[i].pv[0] ?? r.best;
  }
  return r.best;
}

/** Stronger bots think a little longer. */
const thinkTime = (elo: number) => Math.round(200 + ((elo - SF_MIN_ELO) / (MAX_ELO - SF_MIN_ELO)) * 600);
