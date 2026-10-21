import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Chess, type Move } from "chess.js";
import type { Key } from "chessground/types";
import { api } from "../../convex/_generated/api";
import { Board } from "../components/Board";
import { botMove, MAX_ELO, MIN_ELO } from "../lib/bot";
import { fetchRatings, type Rating } from "../lib/importGames";
import { playDrag, playUci, positionInfo } from "../lib/position";
import { playMove, soundFor } from "../lib/sound";
import { Sheet } from "../components/Sheet";

const START = new Chess().fen();
const STORAGE_KEY = "pawnie.botGame";
// the bot waits at least this long, so its moves don't land instantly
const MIN_THINK_MS = 500;

type Side = "white" | "black" | "random";

interface Game {
  elo: number;
  color: "white" | "black";
  moves: string[]; // uci
  resigned?: boolean;
}

function loadGame(): Game | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Game) : null;
  } catch {
    return null;
  }
}

function storeGame(g: Game | null) {
  try {
    if (g) localStorage.setItem(STORAGE_KEY, JSON.stringify(g));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // only lets a game survive a reload
  }
}

/** Replay uci moves from the start; stops at the first illegal one. */
function replay(moves: string[]): Move[] {
  const out: Move[] = [];
  let fen = START;
  for (const u of moves) {
    const m = playUci(fen, u);
    if (!m) break;
    out.push(m);
    fen = m.after;
  }
  return out;
}

export function Play({ openGame }: { openGame: (code: string) => void }) {
  const [game, setGame] = useState<Game | null>(loadGame);

  const start = (elo: number, side: Side) => {
    const color = side === "random" ? (Math.random() < 0.5 ? "white" : "black") : side;
    const g = { elo, color, moves: [] };
    storeGame(g);
    setGame(g);
  };

  if (!game) return <Setup onStart={start} openGame={openGame} />;
  return (
    <Match
      key={`${game.elo}|${game.color}`}
      game={game}
      onChange={(g) => {
        storeGame(g);
        setGame(g);
      }}
      onNew={() => {
        storeGame(null);
        setGame(null);
      }}
      openGame={openGame}
    />
  );
}

function Setup({ onStart, openGame }: { onStart: (elo: number, side: Side) => void; openGame: (code: string) => void }) {
  const profile = useQuery(api.profile.get);
  const history = useQuery(api.games.botGames);
  const [ratings, setRatings] = useState<Rating[] | null>(null);
  const [elo, setElo] = useState<number | null>(null);
  const [side, setSide] = useState<Side>("random");

  useEffect(() => {
    if (!profile) return;
    let live = true;
    void fetchRatings(profile.chesscom, profile.lichess).then((r) => {
      if (live) setRatings(r);
    });
    return () => {
      live = false;
    };
  }, [profile]);

  const mine = ratings?.[0];
  // start at your own rating, rounded to the slider's steps
  const value = elo ?? (mine ? Math.round(mine.rating / 50) * 50 : 1200);

  const facing = side === "black" ? "black" : "white";
  const startInfo = useMemo(() => positionInfo(START), []);
  const [showHistory, setShowHistory] = useState(false);

  const historyList =
    history === undefined ? null : history.length === 0 ? (
      <p className="muted small">None yet. Finished games land here, ready to review.</p>
    ) : (
      <div className="bot-list">
        {history.map((g) => {
          const r = g.result === "1/2-1/2" ? "draw" : (g.result === "1-0") === (g.myColor === "white") ? "win" : "loss";
          return (
            <button key={g._id} className="bot-row" onClick={() => g.code && openGame(g.code)} disabled={!g.code}>
              <span className={`res-dot ${r}`}>{r === "win" ? "W" : r === "loss" ? "L" : "D"}</span>
              <span className="grow bot-row-name">
                <span className="pavatar" style={{ background: g.myColor === "white" ? "#fff" : "#2b2350" }} />
                {g.bot.replace("Pawnie bot ", "Bot ")}
              </span>
              {g.accuracy !== undefined && <b className="small">{g.accuracy}%</b>}
              <span className="muted small">{new Date(g.playedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
            </button>
          );
        })}
      </div>
    );

  return (
    <div className="play setup">
      <div className="trainer">
        <div className="board-col">
          <div className="pbar">
            <span className="pavatar" style={{ background: facing === "white" ? "#2b2350" : "#fff" }} />
            <b className="grow">Pawnie bot {value}</b>
          </div>
          <div className="board-area">
            <Board fen={START} orientation={facing} turnColor={startInfo.turn} check={false} dests={new Map()} onMove={() => {}} />
          </div>
          <div className="pbar">
            <span className="pavatar" style={{ background: facing === "white" ? "#fff" : "#2b2350" }} />
            <b className="grow">You</b>
          </div>
        </div>

        <div className="side-col">
          <div className="card flat stack-tight">
            <h2 className="desk-only">Play the bot</h2>
            <div className="elo-line">
              <span className="muted small">Bot strength</span>
              <div className="elo-value">{value}</div>
            </div>
            <input
              type="range"
              min={MIN_ELO}
              max={MAX_ELO}
              step={50}
              value={value}
              onChange={(e) => setElo(Number(e.target.value))}
              aria-label="Bot rating"
            />
            <div className="row elo-presets">
              {ratings?.map((r) => (
                <button key={`${r.site}${r.kind}`} className="chip-btn" onClick={() => setElo(Math.round(r.rating / 50) * 50)}>
                  {r.site} {r.kind} <b>{r.rating}</b>
                </button>
              ))}
              {ratings && mine && (
                <button className="chip-btn" onClick={() => setElo(Math.round((mine.rating + 200) / 50) * 50)}>
                  A challenge <b>{Math.round((mine.rating + 200) / 50) * 50}</b>
                </button>
              )}
              {ratings === null && profile && <span className="muted small">Looking up your ratings…</span>}
            </div>
            <p className="muted small desk-only">It starts at your rating. Go a little above it to be pushed, or below it to practise converting wins.</p>
          </div>

          <div className="card flat stack-tight play-as">
            <span className="muted small">Play as</span>
            <div className="side-pick">
              {(["white", "random", "black"] as const).map((s) => (
                <button key={s} className={`side-opt ${side === s ? "on" : ""}`} onClick={() => setSide(s)}>
                  <span className={`side-swatch ${s}`} />
                  {s === "random" ? "Random" : s === "white" ? "White" : "Black"}
                </button>
              ))}
            </div>
          </div>

          <div className="card flat bot-history desk-only">
            <span className="muted small">Your games against the bot</span>
            {historyList}
          </div>
          <div className="row play-go">
            <button className="btn ghost m-only" onClick={() => setShowHistory(true)}>
              History{history?.length ? ` (${history.length})` : ""}
            </button>
            <button className="btn grape play-start" onClick={() => onStart(value, side)}>
              Play
            </button>
          </div>
        </div>
      </div>
      <Sheet open={showHistory} onClose={() => setShowHistory(false)} title="Your games against the bot">
        {historyList}
      </Sheet>
    </div>
  );
}

function Match({ game, onChange, onNew, openGame }: { game: Game; onChange: (g: Game) => void; onNew: () => void; openGame: (code: string) => void }) {
  const saveBotGame = useMutation(api.games.saveBotGame);
  const [thinking, setThinking] = useState(false);
  const [saving, setSaving] = useState(false);
  const movesRef = useRef<HTMLDivElement>(null);

  const history = useMemo(() => replay(game.moves), [game.moves]);
  const fen = history.length ? history[history.length - 1].after : START;
  const position = useMemo(() => positionInfo(fen), [fen]);
  const chess = useMemo(() => new Chess(fen), [fen]);
  const botName = `Pawnie bot ${game.elo}`;
  const myTurn = position.turn === game.color;

  const over = game.resigned || position.over;
  const result = (() => {
    if (game.resigned) return { text: "You resigned", score: game.color === "white" ? "0-1" : "1-0" };
    if (chess.isCheckmate()) {
      const iWon = position.turn !== game.color;
      return { text: iWon ? "Checkmate, you win!" : "Checkmate, the bot wins", score: position.turn === "white" ? "0-1" : "1-0" };
    }
    if (chess.isStalemate()) return { text: "Stalemate, it's a draw", score: "1/2-1/2" };
    if (chess.isThreefoldRepetition()) return { text: "Draw by repetition", score: "1/2-1/2" };
    if (chess.isInsufficientMaterial()) return { text: "Draw, not enough material to mate", score: "1/2-1/2" };
    if (chess.isDraw()) return { text: "Draw by the fifty-move rule", score: "1/2-1/2" };
    return null;
  })();

  // the bot's turn
  useEffect(() => {
    if (myTurn || over) return;
    let live = true;
    setThinking(true);
    const started = Date.now();
    void botMove(fen, game.elo).then((uci) => {
      const wait = Math.max(0, MIN_THINK_MS - (Date.now() - started));
      setTimeout(() => {
        if (!live) return;
        setThinking(false);
        const m = playUci(fen, uci);
        if (!m) return;
        playMove(soundFor(m.san));
        onChange({ ...game, moves: [...game.moves, uci] });
      }, wait);
    });
    return () => {
      live = false;
    };
    // a new position is the only thing that should start the bot thinking
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, myTurn, over]);

  useEffect(() => {
    const box = movesRef.current;
    if (box) {
      box.scrollTop = box.scrollHeight;
      box.scrollLeft = box.scrollWidth; // phones: one line, scrolled sideways
    }
  }, [history.length]);

  const onMove = (orig: Key, dest: Key) => {
    if (!myTurn || over) return;
    const m = playDrag(fen, orig, dest);
    if (!m) return;
    playMove(soundFor(m.san));
    onChange({ ...game, moves: [...game.moves, m.from + m.to + (m.promotion ?? "")] });
  };

  /** Take back your last move (and the bot's reply to it). */
  const takeback = () => {
    const mineLast = (i: number) => (i % 2 === 0) === (game.color === "white");
    let n = game.moves.length;
    while (n > 0 && !mineLast(n - 1)) n--;
    if (n > 0) n--;
    onChange({ ...game, moves: game.moves.slice(0, n), resigned: false });
  };

  const review = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const g = new Chess();
      g.setHeader("Event", "Pawnie bot game");
      g.setHeader("White", game.color === "white" ? "You" : botName);
      g.setHeader("Black", game.color === "black" ? "You" : botName);
      g.setHeader("Date", new Date().toISOString().slice(0, 10).replace(/-/g, "."));
      for (const m of history) g.move(m.san);
      g.setHeader("Result", result.score);
      const code = await saveBotGame({ pgn: g.pgn(), myColor: game.color, result: result.score, botName });
      onNew();
      openGame(code);
    } finally {
      setSaving(false);
    }
  };

  const last = history[history.length - 1];
  const rows: number[] = [];
  for (let i = 0; i < history.length; i += 2) rows.push(i);

  return (
    <div className="play">
      <div className="trainer">
        <div className="board-col">
          <div className="pbar">
            <span className="pavatar" style={{ background: game.color === "white" ? "#2b2350" : "#fff" }} />
            <b className="grow">{botName}</b>
            {thinking && <span className="muted small">thinking…</span>}
          </div>
          <div className="board-area">
            <Board
              fen={fen}
              orientation={game.color}
              lastMove={last ? [last.from, last.to] : undefined}
              turnColor={position.turn}
              check={position.check}
              dests={myTurn && !over ? position.dests : new Map()}
              onMove={onMove}
            />
          </div>
          <div className="pbar">
            <span className="pavatar" style={{ background: game.color === "white" ? "#fff" : "#2b2350" }} />
            <b className="grow">You</b>
          </div>
        </div>

        <div className="side-col">
          <div className={`card flat puzzle-card ${result ? (result.text.includes("you win") ? "is-solved" : "is-shown") : ""}`}>
            <div className="puzzle-title">{result ? result.text : myTurn ? "Your move" : "Bot is thinking…"}</div>
            <p className="muted">
              {result
                ? "Review it to see where it was won and lost. Your mistakes become puzzles too."
                : `You play ${game.color}. The bot plays at about ${game.elo}.`}
            </p>
          </div>

          <div className="card flat moves-card">
            <div className="moves" ref={movesRef}>
              {rows.map((i) => (
                <Fragment key={i}>
                  <span className="no">{i / 2 + 1}.</span>
                  <span className={`mv ${i === history.length - 1 ? "cur" : ""}`}>{history[i].san}</span>
                  {history[i + 1] ? <span className={`mv ${i + 1 === history.length - 1 ? "cur" : ""}`}>{history[i + 1].san}</span> : <span />}
                </Fragment>
              ))}
              {rows.length === 0 && <p className="muted small">{myTurn ? "Make your first move." : ""}</p>}
            </div>
            <div className="row controls">
              {result ? (
                <>
                  <button className="btn sm grape" onClick={() => void review()} disabled={saving}>
                    {saving ? "Saving…" : "Review this game"}
                  </button>
                  <button className="btn sm ghost" onClick={onNew}>
                    New game
                  </button>
                </>
              ) : (
                <>
                  <button className="btn sm ghost" onClick={takeback} disabled={thinking || !game.moves.length}>
                    Take back
                  </button>
                  <button className="btn sm coral" onClick={() => onChange({ ...game, resigned: true })} disabled={!game.moves.length}>
                    Resign
                  </button>
                  <button className="btn sm ghost" onClick={onNew}>
                    New game
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
