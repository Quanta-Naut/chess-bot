import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import { api } from "../../convex/_generated/api";
import { Board } from "../components/Board";
import { Badge } from "../components/Badge";
import { useAnalysisProgress } from "../lib/analysisProgress";
import { KIND_TEXT, type MistakeKind } from "../lib/explain";
import { MATE } from "../lib/engine";
import { playDrag, playUci, positionInfo, uciOf } from "../lib/position";
import { evaluateFen, moveLoss, uciToSan, type Label } from "../lib/review";
import { playMove, soundFor } from "../lib/sound";
import { Loader } from "../components/Loader";
import { Sheet } from "../components/Sheet";

type Puzzle = FunctionReturnType<typeof api.puzzles.list>[number];

const CHECK_DEPTH = 12;
const MAX_MOVES = 4;
const REPLY_DELAY_MS = 450;

type Filter = "due" | "all" | MistakeKind;

export function Puzzles({ openGame }: { openGame: (code: string) => void }) {
  const puzzles = useQuery(api.puzzles.list);
  const progress = useAnalysisProgress();
  // "Practise these" on the insights page opens this page on one kind of mistake
  const [filter, setFilter] = useState<Filter>(() => (new URLSearchParams(window.location.search).get("kind") as MistakeKind | null) ?? "due");
  // the puzzle picked to solve; until one is, the first in the queue
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  // when the page opened: a puzzle done in this session moves out of "due" even before its new due time loads
  const [openedAt] = useState(() => Date.now());
  const [picking, setPicking] = useState(false);

  const kinds = useMemo(() => {
    const counts = new Map<MistakeKind, number>();
    for (const p of puzzles ?? []) counts.set(p.kind as MistakeKind, (counts.get(p.kind as MistakeKind) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [puzzles]);

  const due = (puzzles ?? []).filter((p) => p.due <= openedAt);
  const pool =
    filter === "due" ? due : filter === "all" ? (puzzles ?? []) : (puzzles ?? []).filter((p) => p.kind === filter);
  const currentId = pickedId ?? pool.find((p) => !skipped.includes(p._id))?._id ?? pool[0]?._id ?? null;
  const current = puzzles?.find((p) => p._id === currentId) ?? null;
  const nextUp = pool.find((p) => p._id !== currentId && !skipped.includes(p._id)) ?? pool.find((p) => p._id !== currentId) ?? null;

  const next = () => {
    if (currentId) setSkipped((s) => [...s, currentId]);
    setPickedId(nextUp?._id ?? null);
  };

  const pickFilter = (f: Filter) => {
    setPicking(false);
    setFilter(f);
    setSkipped([]);
    setPickedId(null);
  };

  if (puzzles === undefined) return <Loader label="Setting up your puzzles" />;

  const solvedOnce = puzzles.filter((p) => p.solves > 0).length;
  const options: { f: Filter; name: string; count: number }[] = [
    { f: "due", name: "Due", count: due.length },
    { f: "all", name: "All", count: puzzles.length },
    ...kinds.map(([k, n]) => ({ f: k, name: KIND_TEXT[k], count: n })),
  ];
  const chosen = options.find((o) => o.f === filter) ?? options[0];

  return (
    <div className="puzzles">
      <div className="row page-head">
        <h1>Puzzles</h1>
        <span className="muted small grow desk-only">
          {puzzles.length} from your games · {due.length} due · {solvedOnce} solved
          {progress.left > 0 && ` · analysing ${progress.left} more game${progress.left === 1 ? "" : "s"}…`}
        </span>
        <button className="btn sm ghost m-only pick-btn" onClick={() => setPicking(true)}>
          {chosen.name} <b>{chosen.count}</b> <span aria-hidden>▾</span>
        </button>
      </div>

      <Sheet open={picking} onClose={() => setPicking(false)} title="Which puzzles?">
        <div className="sheet-list">
          {options.map((o) => (
            <button key={o.f} className={`sheet-opt ${filter === o.f ? "on" : ""}`} onClick={() => pickFilter(o.f)}>
              <span className="grow">{o.name}</span>
              <b>{o.count}</b>
            </button>
          ))}
        </div>
        <p className="muted small">
          {puzzles.length} from your games · {due.length} due · {solvedOnce} solved
        </p>
      </Sheet>

      <div className="row filter-row desk-only">
        <button className={`chip-btn ${filter === "due" ? "on" : ""}`} onClick={() => pickFilter("due")}>
          Due <b>{due.length}</b>
        </button>
        <button className={`chip-btn ${filter === "all" ? "on" : ""}`} onClick={() => pickFilter("all")}>
          All <b>{puzzles.length}</b>
        </button>
        {kinds.map(([k, n]) => (
          <button key={k} className={`chip-btn ${filter === k ? "on" : ""}`} onClick={() => pickFilter(k)}>
            {KIND_TEXT[k]} <b>{n}</b>
          </button>
        ))}
      </div>

      {current ? (
        // finishing pins the puzzle: its new due time would otherwise move it out of the queue while it's on screen
        <Solver key={current._id} puzzle={current} onFinish={() => setPickedId(current._id)} onNext={next} openGame={openGame} hasNext={!!nextUp} />
      ) : (
        <div className="card stack-tight empty-puzzles">
          {puzzles.length === 0 ? (
            <>
              <h2>No puzzles yet</h2>
              <p className="muted">
                {progress.left > 0
                  ? `Your games are being analysed for mistakes (${progress.left} to go). Each mistake, miss and blunder becomes a puzzle here.`
                  : "Every mistake, miss and blunder in your analysed games becomes a puzzle here. Import some games to get started."}
              </p>
            </>
          ) : (
            <>
              <h2>All caught up</h2>
              <p className="muted">
                Nothing is due right now. Puzzles you solve come back after a few days, ones you miss come back sooner. Pick{" "}
                <b>All</b> to keep practising.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

type Status = "play" | "checking" | "wrong" | "reply" | "solved" | "shown";

function Solver({
  puzzle,
  onFinish,
  onNext,
  openGame,
  hasNext,
}: {
  puzzle: Puzzle;
  onFinish: () => void;
  onNext: () => void;
  openGame: (code: string) => void;
  hasNext: boolean;
}) {
  const record = useMutation(api.puzzles.record);
  const me = puzzle.game.myColor;
  const needed = Math.min(MAX_MOVES, Math.ceil(puzzle.solution.length / 2));

  const [fen, setFen] = useState(puzzle.fen);
  // what the board shows: usually `fen`, briefly the wrong move before it's taken back
  const [shownFen, setShownFen] = useState(puzzle.fen);
  const [line, setLine] = useState<string[]>(puzzle.solution);
  const [done, setDone] = useState(0);
  const [status, setStatus] = useState<Status>("play");
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>(undefined);
  const [wrong, setWrong] = useState<{ san: string; uci: string } | null>(null);
  const [hint, setHint] = useState(false);
  const [misses, setMisses] = useState(0);
  const [helped, setHelped] = useState(false);
  const recorded = useRef(false);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));

  const finish = (result: "solved" | "shown") => {
    setStatus(result);
    if (recorded.current) return;
    recorded.current = true;
    onFinish();
    void record({ id: puzzle._id, solved: result === "solved" && misses === 0 && !helped });
  };

  /** Put a move on the board, with its sound. */
  const show = (mv: { from: string; to: string; san: string; after: string }) => {
    setFen(mv.after);
    setShownFen(mv.after);
    setLastMove([mv.from as Key, mv.to as Key]);
    playMove(soundFor(mv.san));
  };

  /** The opponent answers with the next move of the line, or the engine's choice once the line runs out. */
  const reply = async (at: string, rest: string[]) => {
    setStatus("reply");
    let move = rest[0];
    let after = rest.slice(1);
    if (!move) {
      const ev = await evaluateFen(at, CHECK_DEPTH);
      move = ev.best;
      after = ev.pv.slice(1);
    }
    const mv = move ? playUci(at, move) : null;
    if (!mv) return finish("solved");
    later(() => {
      show(mv);
      setLine(after);
      setStatus("play");
    }, REPLY_DELAY_MS);
  };

  const accept = (mv: NonNullable<ReturnType<typeof playDrag>>, rest: string[]) => {
    show(mv);
    setHint(false);
    setWrong(null);
    const count = done + 1;
    setDone(count);
    if (count >= needed || positionInfo(mv.after).over) return finish("solved");
    void reply(mv.after, rest);
  };

  const onMove = async (orig: Key, dest: Key) => {
    if (status !== "play") return;
    const mv = playDrag(fen, orig, dest);
    if (!mv) return;
    const uci = uciOf(mv);
    if (uci === line[0]) return accept(mv, line.slice(1));

    // a different move still counts if the engine rates it nearly as highly (but not the game's mistake itself)
    setStatus("checking");
    setShownFen(mv.after);
    setLastMove([mv.from, mv.to]);
    const [before, after] = await Promise.all([evaluateFen(fen, CHECK_DEPTH), evaluateFen(mv.after, CHECK_DEPTH)]);
    const white = me === "white";
    const sign = white ? 1 : -1;
    const hadMate = before.cp * sign > MATE - 200;
    const keepsMate = after.cp * sign > MATE - 200;
    const ok = !(done === 0 && uci === puzzle.played) && (hadMate ? keepsMate : moveLoss(before, after, uci, white) <= (done === 0 ? 3 : 5));
    if (ok) {
      setStatus("play");
      return accept(mv, after.pv);
    }
    playMove("move");
    setWrong({ san: mv.san, uci });
    setMisses((m) => m + 1);
    setStatus("wrong");
    later(() => {
      setShownFen(fen);
      setLastMove(undefined);
      setStatus("play");
    }, 700);
  };

  /** Play the rest of the line on the board, one move at a time. */
  const showSolution = () => {
    setHelped(true);
    setWrong(null);
    setStatus("shown");
    let at = fen;
    const moves = line.slice(0, Math.max(0, (needed - done) * 2 - 1));
    moves.forEach((u, i) => {
      const mv = playUci(at, u);
      if (!mv) return;
      at = mv.after;
      later(() => show(mv), 650 * (i + 1));
    });
    finish("shown");
  };

  const position = useMemo(() => positionInfo(shownFen), [shownFen]);
  const shapes: DrawShape[] = [];
  if (hint && line[0]) shapes.push({ orig: line[0].slice(0, 2) as Key, brush: "green" });
  if (wrong) shapes.push({ orig: wrong.uci.slice(0, 2) as Key, dest: wrong.uci.slice(2, 4) as Key, brush: "red" });

  const [, side, , , , no] = puzzle.fen.split(" ");
  const moveNo = `${no}${side === "w" ? "." : "…"}`;
  const playedSan = uciToSan(puzzle.fen, puzzle.played);
  const toMove = me === "white" ? "White" : "Black";

  return (
    <div className="trainer">
      <div className="board-col">
        <div className="board-area">
          <Board
            fen={shownFen}
            orientation={me}
            lastMove={lastMove}
            shapes={shapes}
            turnColor={position.turn}
            check={position.check}
            dests={status === "play" ? position.dests : new Map()}
            onMove={(o, d) => void onMove(o, d)}
          />
        </div>
      </div>

      <div className="side-col">
        <div className={`card flat puzzle-card is-${status}`}>
          <div className="puzzle-title">
            {status === "solved" ? "Solved!" : status === "shown" ? "Here's the line" : `Find the best move for ${toMove}`}
          </div>
          <p className="muted">
            {status === "solved"
              ? misses === 0 && !helped
                ? "Clean solve. It comes back in a few days to make it stick."
                : "Got there. It comes back soon for another go."
              : status === "shown"
                ? "Watch the engine's line. This one comes back soon."
                : status === "wrong" || (status === "play" && wrong)
                  ? `${wrong?.san} isn't it. Try again.`
                  : status === "checking"
                    ? "Checking that move…"
                    : status === "reply"
                      ? "Good. Now the reply…"
                      : needed > 1
                        ? `Play ${needed} good moves in a row${done ? ` (${done}/${needed})` : ""}.`
                        : "One move does it."}
          </p>
          <div className="dots">
            {Array.from({ length: needed }, (_, i) => (
              <span key={i} className={`dot ${i < done ? "on" : ""}`} />
            ))}
          </div>
        </div>

        <div className="card flat stack-tight puzzle-info">
          <div className="row-tight">
            <Badge label={puzzle.label as Label} />
            <b>{KIND_TEXT[puzzle.kind as MistakeKind]}</b>
          </div>
          <p className="muted small">
            From your game against {puzzle.game.opponent} ({new Date(puzzle.game.playedAt).toLocaleDateString()}). In the game you played{" "}
            <b>
              {moveNo} {playedSan}
            </b>
            {status === "solved" || status === "shown" ? "." : " here. Can you do better?"}
          </p>
          <p className="muted small">
            Tried {puzzle.attempts} time{puzzle.attempts === 1 ? "" : "s"}, solved {puzzle.solves}.
          </p>
        </div>

        <div className="grow" />

        <div className="row puzzle-actions">
          {status === "solved" || status === "shown" ? (
            <button className="btn grape" onClick={onNext} disabled={!hasNext}>
              {hasNext ? "Next puzzle" : "No more puzzles"}
            </button>
          ) : (
            <>
              <button className="btn sm ghost" onClick={() => { setHint(true); setHelped(true); }} disabled={hint || status !== "play"}>
                Hint
              </button>
              <button className="btn sm ghost" onClick={showSolution} disabled={status === "reply" || status === "checking"}>
                Solution
              </button>
              <button className="btn sm ghost" onClick={onNext} disabled={!hasNext}>
                Skip
              </button>
            </>
          )}
          {puzzle.game.code && (
            <button className="btn sm ghost" onClick={() => openGame(puzzle.game.code!)}>
              Open game
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
