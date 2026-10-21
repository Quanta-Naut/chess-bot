import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Chess, type Move } from "chess.js";
import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { Board } from "../components/Board";
import { Sheet } from "../components/Sheet";
import { Loader } from "../components/Loader";
import { Badge } from "../components/Badge";
import { LABELS } from "../lib/labelMeta";
import type { PositionEval } from "../lib/engine";
import { engineLine, explain, praise } from "../lib/explain";
import { positionInfo } from "../lib/position";
import { playMove, soundFor } from "../lib/sound";
import {
  ANALYSIS_VERSION,
  BAD_LABELS as BAD,
  basicLabel,
  evaluateFen,
  mateText,
  moveLoss,
  REVIEW_DEPTH,
  reviewGame,
  sideSummary,
  uciToSan,
  winPct,
  type Analysis,
  type Label,
} from "../lib/review";

const DEPTH = REVIEW_DEPTH;
// wait this long on a move before asking the AI, so stepping through a game doesn't burn requests
const AI_DELAY_MS = 600;

interface Replay {
  verbose: Move[];
  fens: string[];
}

interface BranchMove {
  san: string;
  uci: string;
  from: Key;
  to: Key;
  before: string;
  fen: string;
}

/** A line played on the board (by the user, or the engine's best line), starting from mainline position `fromPly`. */
interface Branch {
  fromPly: number;
  moves: BranchMove[];
  engine?: boolean;
}

/** Where the board was before the engine line was turned on, to go back to when it's turned off. */
interface Saved {
  branch: Branch | null;
  ply: number;
  varIdx: number;
}

/** Play a UCI line from `fen` as branch moves, stopping at the first one that isn't legal. */
function lineMoves(fen: string, pv: string[]): BranchMove[] {
  const g = new Chess(fen);
  const out: BranchMove[] = [];
  for (const u of pv) {
    try {
      const mv = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      out.push({ san: mv.san, uci: u, from: mv.from, to: mv.to, before: mv.before, fen: mv.after });
    } catch {
      break;
    }
  }
  return out;
}

export function Review({ code }: { code: string }) {
  const game = useQuery(api.games.get, { code });

  const replay = useMemo<Replay | null>(() => {
    if (!game) return null;
    const g = new Chess();
    try {
      g.loadPgn(game.pgn);
    } catch {
      return null;
    }
    const verbose = g.history({ verbose: true });
    return { verbose, fens: [verbose[0]?.before ?? new Chess().fen(), ...verbose.map((m) => m.after)] };
  }, [game]);

  if (game === undefined) return <Loader label="Loading the game" />;
  if (game === null || !replay) return <p>Couldn't open that game.</p>;
  return <ReviewView game={game} replay={replay} />;
}

function ReviewView({ game, replay }: { game: Doc<"games">; replay: Replay }) {
  const saveAnalysis = useMutation(api.games.saveAnalysis);
  const explainAi = useAction(api.coach.explain);
  const aiAsked = useRef(new Set<string>());
  const [aiWaiting, setAiWaiting] = useState<string | null>(null);

  const [ply, setPly] = useState(0);
  const [branch, setBranch] = useState<Branch | null>(null);
  // 0 = on the game line at `ply`; k > 0 = k moves into the branch (then ply === branch.fromPly)
  const [varIdx, setVarIdx] = useState(0);
  const [choosing, setChoosing] = useState(false);
  // set while the engine line is on: what to restore when it's turned off
  const [saved, setSaved] = useState<Saved | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [evals, setEvals] = useState<Record<string, PositionEval>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const movesRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const wantedRef = useRef<string[]>([]);
  const evalsRef = useRef<Record<string, PositionEval>>({});
  const pumping = useRef(false);

  const analysis = game.analysis as Analysis | undefined;
  const total = replay.verbose.length;
  const inBranch = branch !== null && varIdx > 0;
  const fen = inBranch ? branch.moves[varIdx - 1].fen : replay.fens[ply];

  const runAnalysis = useCallback(async () => {
    setError(null);
    setProgress({ done: 0, total: 1 });
    try {
      const { analysis: result, puzzles } = await reviewGame(game.pgn, game.myColor, DEPTH, (done, tot) => setProgress({ done, total: tot }));
      await saveAnalysis({ id: game._id, analysis: result, puzzles });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setProgress(null);
    }
  }, [game, saveAnalysis]);

  // analyse automatically the first time a game is opened, and again when the grading rules have changed since
  useEffect(() => {
    if (game.analysis?.version === ANALYSIS_VERSION || started.current) return;
    started.current = true;
    void runAnalysis();
  }, [game, runAnalysis]);

  const position = useMemo(() => positionInfo(fen), [fen]);

  const summaries = useMemo(
    () => (analysis ? { white: sideSummary(analysis.moves, "white"), black: sideSummary(analysis.moves, "black") } : null),
    [analysis],
  );

  const graded = useMemo(
    () =>
      branch?.moves.map((m) => {
        const before = evals[m.before];
        const after = evals[m.fen];
        if (!before || !after) return { ...m, label: undefined, best: before?.best };
        const loss = moveLoss(before, after, m.uci, m.before.split(" ")[1] === "w");
        return { ...m, label: basicLabel(loss, m.uci === before.best), best: before.best };
      }) ?? [],
    [branch, evals],
  );

  const goMain = (n: number) => {
    setVarIdx(0);
    setChoosing(false);
    setPly(Math.max(0, Math.min(total, n)));
  };

  const back = () => {
    if (choosing) return setChoosing(false);
    if (varIdx > 0) return setVarIdx(varIdx - 1);
    goMain(ply - 1);
  };

  const forward = () => {
    if (varIdx > 0) {
      if (branch && varIdx < branch.moves.length) setVarIdx(varIdx + 1);
      return;
    }
    if (branch && branch.fromPly === ply) {
      if (ply >= total) return setVarIdx(1);
      if (choosing) return goMain(ply + 1);
      return setChoosing(true);
    }
    goMain(ply + 1);
  };

  const enterBranch = () => {
    setChoosing(false);
    setVarIdx(1);
  };

  const onMove = (orig: Key, dest: Key) => {
    let mv: Move;
    try {
      mv = new Chess(fen).move({ from: orig, to: dest, promotion: "q" });
    } catch {
      return;
    }
    const uci = mv.from + mv.to + (mv.promotion ?? "");
    const next: BranchMove = { san: mv.san, uci, from: mv.from, to: mv.to, before: mv.before, fen: mv.after };
    setChoosing(false);
    // a move of your own that leaves the engine line makes it your line from there on
    if (saved && !(inBranch && branch.moves[varIdx]?.uci === uci)) setSaved(null);
    if (!inBranch) {
      const g = replay.verbose[ply];
      if (g && g.from + g.to + (g.promotion ?? "") === uci) return setPly(ply + 1);
      setBranch({ fromPly: ply, moves: [next] });
      return setVarIdx(1);
    }
    if (branch.moves[varIdx]?.uci === uci) return setVarIdx(varIdx + 1);
    setBranch({ fromPly: branch.fromPly, moves: [...branch.moves.slice(0, varIdx), next] });
    setVarIdx(varIdx + 1);
  };

  // keep the current move visible
  useEffect(() => {
    const box = movesRef.current;
    const el = box?.querySelector<HTMLElement>(".mv.cur");
    if (!box || !el) return;
    const b = box.getBoundingClientRect();
    const elBox = el.getBoundingClientRect();
    if (elBox.top < b.top) box.scrollTop += elBox.top - b.top - 4;
    else if (elBox.bottom > b.bottom) box.scrollTop += elBox.bottom - b.bottom + 4;
    // on phones the list is one line that scrolls sideways
    if (elBox.left < b.left) box.scrollLeft += elBox.left - b.left - 40;
    else if (elBox.right > b.right) box.scrollLeft += elBox.right - b.right + 40;
  }, [ply, varIdx, branch, analysis, graded]); // graded: badges arriving can re-wrap the line

  const me = game.myColor;
  const bottom = flipped ? (me === "white" ? "black" : "white") : me;
  const top = bottom === "white" ? "black" : "white";
  const name = (c: "white" | "black") => (c === "white" ? game.white : game.black);
  const mySum = summaries?.[me];

  // the move that led to the shown position, in one shape for both lines
  const shown = (() => {
    if (inBranch) {
      const m = graded[varIdx - 1];
      return { san: m.san, uci: m.uci, from: m.from, to: m.to, best: m.best, label: m.label, white: m.before.split(" ")[1] === "w", before: m.before, after: m.fen };
    }
    if (ply === 0) return null;
    const v = replay.verbose[ply - 1];
    const a = analysis?.moves[ply - 1];
    return {
      san: v.san,
      uci: v.from + v.to + (v.promotion ?? ""),
      from: v.from,
      to: v.to,
      best: a?.best,
      label: a?.label as Label | undefined,
      white: v.color === "w",
      before: v.before,
      after: v.after,
    };
  })();
  const shownIsMine = shown ? shown.white === (me === "white") : false;
  const shownIsBad = !!shown?.label && BAD.includes(shown.label);

  // a sound whenever the board changes: the move's own sound when stepping onto it, a plain one otherwise
  const lastFen = useRef(fen);
  const shownSan = shown?.san;
  const shownBefore = shown?.before;
  useEffect(() => {
    if (lastFen.current === fen) return;
    const forward = shownSan !== undefined && lastFen.current === shownBefore;
    lastFen.current = fen;
    playMove(forward ? soundFor(shownSan) : "move");
  }, [fen, shownSan, shownBefore]);

  // Where the engine line would start: on a game move that wasn't the engine's choice, from the position
  // before it (the engine's move replaces it); otherwise from the position on the board.
  const engineStart = (() => {
    if (inBranch) return { fen, fromPly: branch.fromPly, keep: branch.moves.slice(0, varIdx) };
    const missed = !!shown?.label && !!shown.best && shown.best !== shown.uci && !["brilliant", "great", "book"].includes(shown.label);
    return missed ? { fen: replay.fens[ply - 1], fromPly: ply - 1, keep: [] } : { fen, fromPly: ply, keep: [] };
  })();
  const engineMoves = saved ? [] : lineMoves(engineStart.fen, evals[engineStart.fen]?.pv ?? []);

  const toggleEngineLine = () => {
    setChoosing(false);
    if (saved) {
      setBranch(saved.branch);
      setPly(saved.ply);
      setVarIdx(saved.varIdx);
      return setSaved(null);
    }
    if (!engineMoves.length) return;
    setSaved({ branch, ply, varIdx });
    setBranch({ fromPly: engineStart.fromPly, moves: [...engineStart.keep, ...engineMoves], engine: true });
    setPly(engineStart.fromPly);
    setVarIdx(engineStart.keep.length + 1);
  };

  const dropBranch = () => {
    if (!branch) return;
    if (saved) return toggleEngineLine();
    if (varIdx > 0) goMain(branch.fromPly);
    setChoosing(false);
    setBranch(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "ArrowLeft") back();
      else if (e.key === "ArrowRight") forward();
      else if (e.key === "Enter" && choosing) enterBranch();
      else if (e.key === "Escape" && choosing) setChoosing(false);
      else if (e.key === "ArrowUp" || e.key === "Home") goMain(0);
      else if (e.key === "ArrowDown" || e.key === "End") goMain(total);
      else if (e.key === "f" || e.key === "F") setFlipped((f) => !f);
      else if (e.key === "e" || e.key === "E") toggleEngineLine();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // positions the engine should look at, most urgent first: what's on screen, the branch, then the next game move
  const wanted = [
    ...(shown ? [shown.after, shown.before] : [fen]),
    ...(branch ? [replay.fens[branch.fromPly], ...branch.moves.map((m) => m.fen)] : []),
    ...(!inBranch && ply < total ? [replay.fens[ply + 1]] : []),
  ];
  const wantedKey = wanted.join("|");
  // one engine request at a time, always for the most urgent position still missing, so stepping fast never queues stale work
  useEffect(() => {
    wantedRef.current = wantedKey.split("|");
    if (pumping.current) return;
    pumping.current = true;
    void (async () => {
      try {
        for (;;) {
          const f = wantedRef.current.find((x) => !evalsRef.current[x]);
          if (!f) break;
          const e = await evaluateFen(f, DEPTH);
          evalsRef.current = { ...evalsRef.current, [f]: e };
          setEvals(evalsRef.current);
        }
      } finally {
        pumping.current = false;
      }
    })();
  }, [wantedKey]);

  const card = (() => {
    if (!shown) {
      const ev = evals[fen];
      return { title: "Starting position", tag: "Engine line", line: ev ? engineLine(fen, ev) : undefined, ready: !!ev } as Card;
    }
    if (!shown.label) return { title: shown.san, ready: false } as Card;
    const title = `${shown.san} is ${PHRASE[shown.label]}`;
    if (shownIsBad) {
      const before = evals[shown.before];
      const after = evals[shown.after];
      if (!before || !after) return { title, label: shown.label, ready: false } as Card;
      const why = explain(shown.before, shown.uci, before, after, shownIsMine);
      return {
        title,
        label: shown.label,
        better: why.better,
        reason: why.reason,
        tag: shownIsMine ? "How it gets punished" : "How to punish it",
        line: why.line,
        reply: why.reply,
        ready: true,
      } as Card;
    }
    const better =
      shown.best && shown.best !== shown.uci && !["best", "brilliant", "great", "book"].includes(shown.label)
        ? uciToSan(shown.before, shown.best)
        : undefined;
    const after = evals[shown.after];
    return {
      title,
      label: shown.label,
      better,
      reason: shown.best === shown.uci && shown.label !== "brilliant" && shown.label !== "great" ? praise("best", undefined, shownIsMine) : praise(shown.label, better, shownIsMine),
      tag: "Engine line",
      line: after ? engineLine(shown.after, after) : undefined,
      ready: !!after,
    } as Card;
  })();

  // AI note: the engine facts behind the card, worded by an LLM on the server and cached there
  const aiFacts = (() => {
    if (!shown || !card.ready || !card.label) return null;
    const a = inBranch ? undefined : analysis?.moves[ply - 1];
    const cpBefore = evals[shown.before]?.cp ?? a?.bestCp;
    const cpAfter = evals[shown.after]?.cp ?? a?.cp;
    if (cpBefore === undefined || cpAfter === undefined) return null;
    const sign = me === "white" ? 1 : -1;
    const [, side, , , , no] = shown.before.split(" ");
    return {
      myColor: me,
      mine: shownIsMine,
      move: `${no}${side === "w" ? "." : "…"} ${shown.san}`,
      label: card.label,
      evalBefore: mateText(cpBefore * sign),
      evalAfter: mateText(cpAfter * sign),
      better: card.better,
      lineTag: card.tag,
      line: card.line,
      finding: card.reason,
    };
  })();
  // "v2": notes written before the grading and side-labelling fixes are not reused
  const aiKey = aiFacts && shown ? `v2|${shown.before}|${shown.uci}|${shownIsMine ? "me" : "opp"}` : null;
  const aiNote = useQuery(api.coach.note, aiKey ? { key: aiKey } : "skip");
  const aiFactsRef = useRef(aiFacts);
  useEffect(() => {
    aiFactsRef.current = aiFacts;
  });
  useEffect(() => {
    if (!aiKey || aiNote !== null || aiAsked.current.has(aiKey)) return;
    const t = setTimeout(() => {
      const facts = aiFactsRef.current;
      if (!facts) return;
      aiAsked.current.add(aiKey);
      setAiWaiting(aiKey);
      explainAi({ key: aiKey, facts })
        .catch(() => {})
        .finally(() => setAiWaiting((k) => (k === aiKey ? null : k)));
    }, AI_DELAY_MS);
    return () => clearTimeout(t);
  }, [aiKey, aiNote, explainAi]);
  const aiPending = !!aiKey && aiWaiting === aiKey;

  const mainEval = (p: number) => (analysis ? (p === 0 ? analysis.moves[0]?.bestCp ?? 0 : analysis.moves[p - 1].cp) : undefined);
  const evalCp = inBranch ? evals[fen]?.cp : mainEval(ply);
  const barCp = evalCp ?? (inBranch ? evals[branch.moves[varIdx - 1].before]?.cp : undefined) ?? 0;
  const whitePct = winPct(barCp);
  const bestNow = inBranch
    ? evals[fen]?.best
      ? uciToSan(fen, evals[fen].best)
      : undefined
    : analysis && ply < total
      ? analysis.moves[ply].bestSan
      : undefined;

  const arrow = (uci: string, brush: string): DrawShape => ({ orig: uci.slice(0, 2) as Key, dest: uci.slice(2, 4) as Key, brush });
  const shapes: DrawShape[] = [];
  if (choosing && branch) {
    const g = replay.verbose[ply];
    shapes.push(arrow(g.from + g.to, "blue"), arrow(branch.moves[0].uci, "purple"));
  } else if (shown?.label) {
    const isBad = BAD.includes(shown.label);
    const mine = shown.white === (me === "white");
    if (shown.best && shown.best !== shown.uci && (mine || isBad)) shapes.push(arrow(shown.best, "green"));
    shapes.push(arrow(shown.uci, isBad ? "red" : ["brilliant", "great", "best"].includes(shown.label) ? "green" : "blue"));
    if (card.reply) shapes.push(arrow(card.reply, "yellow"));
  }

  const nextMistake = () => {
    if (!analysis) return;
    const mine = (i: number) => (replay.verbose[i].color === "w") === (me === "white");
    const hit = (i: number) => mine(i) && ["mistake", "miss", "blunder"].includes(analysis.moves[i].label);
    for (let i = ply; i < total; i++) if (hit(i)) return goMain(i + 1);
    for (let i = 0; i < ply; i++) if (hit(i)) return goMain(i + 1);
  };

  const rows: number[] = [];
  for (let i = 0; i < total; i += 2) rows.push(i);
  // the branch is listed under the row holding the game move it replaces
  const branchRow = branch ? (branch.fromPly >= total ? rows[rows.length - 1] : branch.fromPly - (branch.fromPly % 2)) : undefined;

  const branchLine = branch && (
    <div className={`branch ${branch.engine ? "engine" : ""}`}>
      {branch.engine && <span className="branch-tag">Engine</span>}
      {graded.map((m, k) => {
        const p = branch.fromPly + k;
        const no = p % 2 === 0 ? `${p / 2 + 1}.` : k === 0 ? `${(p + 1) / 2}…` : null;
        return (
          <Fragment key={k}>
            {no && <span className="branch-no">{no}</span>}
            <button
              className={`mv var ${varIdx === k + 1 ? "cur" : ""}`}
              onClick={() => {
                setChoosing(false);
                setPly(branch.fromPly);
                setVarIdx(k + 1);
              }}
            >
              {m.label && <Badge label={m.label} />}
              {m.san}
            </button>
          </Fragment>
        );
      })}
      <button className="branch-x" onClick={dropBranch} aria-label={saved ? "Close the engine line" : "Discard your line"} title={saved ? "Close the engine line" : "Discard your line"}>
        ×
      </button>
    </div>
  );

  const evalStrip = (analysis || inBranch) && (
    <div className={`eval-card ${inBranch ? "exploring" : ""}`}>
      <div className="eval-item">
        <span className="muted small">{inBranch ? (branch.engine ? "Engine line" : "Your line") : "Eval"}</span>
        <b>{evalCp === undefined ? "…" : mateText(evalCp)}</b>
      </div>
      <div className="eval-item">
        <span className="muted small">Played</span>
        <b className="row-tight">
          {shown?.label && <Badge label={shown.label} />}
          {shown?.san ?? "–"}
        </b>
      </div>
      <div className="eval-item">
        <span className="muted small">Best</span>
        <b>{bestNow ?? (inBranch && !evals[fen] ? "…" : "–")}</b>
      </div>
    </div>
  );
  const statsBlock = analysis && mySum && (
    <>
      <div className="counts-grid">
        {COUNT_LINES.map((line) => (
          <div key={line[0]} className="counts-line">
            {line.map((label) => (
              <div key={label} className="count-cell">
                <Badge label={label} />
                <b>{mySum.counts[label] ?? 0}</b>
                <span className="muted tiny">{LABELS[label].title}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <Graph evals={[analysis.moves[0]?.bestCp ?? 0, ...analysis.moves.map((m) => m.cp)]} ply={ply} onPick={goMain} />
    </>
  );

  return (
    <div className="review">
      <div className="board-col">
        <PlayerBar color={top} name={name(top)} accuracy={summaries?.[top].accuracy} />
        <div className="board-area">
          <div className="board-line">
            <div className="evalbar" title="Evaluation">
              <div className="white" style={{ height: `${bottom === "white" ? whitePct : 100 - whitePct}%` }} />
            </div>
            <Board
              fen={fen}
              orientation={bottom}
              lastMove={shown ? [shown.from, shown.to] : undefined}
              shapes={shapes}
              badge={shown?.label && !choosing ? { square: shown.to, label: shown.label } : undefined}
              turnColor={position.turn}
              check={position.check}
              dests={position.dests}
              onMove={onMove}
            >
              {choosing && branch && (
                <div className="fork">
                  <span className="fork-title">Continue with</span>
                  <button className="fork-opt" onClick={() => goMain(ply + 1)}>
                    <kbd>→</kbd>
                    <span className="grow">Game move</span>
                    <b>{replay.verbose[ply].san}</b>
                  </button>
                  <button className="fork-opt mine" onClick={enterBranch}>
                    <kbd>Enter</kbd>
                    <span className="grow">{branch.engine ? "Engine line" : "Your line"}</span>
                    <b>{branch.moves[0].san}</b>
                  </button>
                </div>
              )}
            </Board>
          </div>
        </div>
        <PlayerBar color={bottom} name={name(bottom)} accuracy={summaries?.[bottom].accuracy} />
      </div>

      <div className="side-col">
        {progress && (
          <div className="card flat stack-tight">
            <b>Analysing game...</b>
            <div className="progress">
              <div style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
          </div>
        )}

        {error && (
          <div className="error row">
            <span className="grow">{error}</span>
            <button className="btn sm" onClick={() => void runAnalysis()}>
              Retry
            </button>
          </div>
        )}

        <div className="desk-contents">{evalStrip}</div>

        <div className={`insight ${card.label ? `q-${card.label}` : ""}`}>
          <div className="insight-head">
            {card.label && <Badge label={card.label} />}
            <b className="grow">{card.title}</b>
            {card.better && (
              <span className="insight-better">
                Better <b>{card.better}</b>
              </span>
            )}
          </div>
          {(aiNote || card.reason) && (
            <p className="insight-why">
              {aiNote && <span className="insight-ai" title="Written by AI from the engine's analysis">AI</span>}
              {aiNote ?? card.reason}
              {!aiNote && aiPending && <span className="insight-ai-wait" aria-hidden />}
            </p>
          )}
          {card.line ? (
            <div className="insight-reply">
              <span className={`insight-tag ${card.reply ? "threat" : ""}`}>{card.tag}</span>
              <span className="insight-line">{card.line}</span>
            </div>
          ) : (
            !card.ready && <p className="insight-why muted">{card.label && BAD.includes(card.label) ? "Working out why…" : "Thinking…"}</p>
          )}
        </div>

        <div className="desk-contents">{statsBlock}</div>

        <div className="card flat moves-card">
          <div className="moves" ref={movesRef}>
            {rows.map((i) => (
              <Fragment key={i}>
                <MoveRow i={i} replay={replay} analysis={analysis} ply={inBranch ? -1 : ply} go={goMain} />
                {branchRow === i && branchLine}
              </Fragment>
            ))}
            {rows.length === 0 && branchLine}
          </div>
          <div className="row controls">
            <span className="flip-spacer" />
            <button
              className={`btn sm ${saved ? "grape" : "ghost"} engine-btn`}
              onClick={toggleEngineLine}
              disabled={!saved && !engineMoves.length}
              aria-pressed={!!saved}
              title={saved ? "Back to the game (E)" : "Play out the engine's best line from here (E)"}
            >
              Best line
            </button>
            <button className="btn sm" onClick={() => goMain(0)} aria-label="Start">
              ⏮
            </button>
            <button className="btn sm" onClick={back} aria-label="Previous move">
              ◀
            </button>
            <button className="btn sm" onClick={forward} aria-label="Next move">
              ▶
            </button>
            <button className="btn sm" onClick={() => goMain(total)} aria-label="End">
              ⏭
            </button>
            {analysis && (
              <button className="btn sm coral" onClick={nextMistake}>
                Next mistake
              </button>
            )}
            <button className="btn sm ghost m-only stats-btn" onClick={() => setStatsOpen(true)} aria-label="More">
              ⋯
            </button>
            <button className="btn sm ghost flip" onClick={() => setFlipped((f) => !f)} aria-label="Flip board" title="Flip board (F)">
              ⇅
            </button>
          </div>
        </div>
      </div>
      <Sheet open={statsOpen} onClose={() => setStatsOpen(false)} title="This game">
        <div className="stack-tight">
          <div className="sheet-tools">
            <button className="btn sm ghost" onClick={() => { goMain(0); setStatsOpen(false); }}>
              ⏮ Start
            </button>
            <button className="btn sm ghost" onClick={() => { goMain(total); setStatsOpen(false); }}>
              End ⏭
            </button>
            <button className="btn sm ghost" onClick={() => { setFlipped((f) => !f); setStatsOpen(false); }}>
              ⇅ Flip
            </button>
          </div>
          {evalStrip}
          {statsBlock}
        </div>
      </Sheet>
    </div>
  );
}

interface Card {
  title: string;
  label?: Label;
  better?: string;
  reason?: string;
  tag?: string;
  line?: string;
  /** opponent's punishing reply (uci), drawn on the board */
  reply?: string;
  ready: boolean;
}

const PHRASE: Record<Label, string> = {
  brilliant: "brilliant",
  great: "a great move",
  best: "the best move",
  excellent: "excellent",
  good: "a good move",
  book: "a book move",
  inaccuracy: "an inaccuracy",
  mistake: "a mistake",
  miss: "a miss",
  blunder: "a blunder",
};

const COUNT_LINES: Label[][] = [
  ["brilliant", "great", "best", "good"],
  ["inaccuracy", "mistake", "miss", "blunder"],
];

function PlayerBar({ color, name, accuracy }: { color: "white" | "black"; name: string; accuracy?: number }) {
  return (
    <div className="pbar">
      <span className="pavatar" style={{ background: color === "white" ? "#fff" : "#2b2350" }} />
      <b className="grow">{name}</b>
      {accuracy !== undefined && <b className="pacc">{accuracy}%</b>}
    </div>
  );
}

function MoveRow({
  i,
  replay,
  analysis,
  ply,
  go,
}: {
  i: number;
  replay: Replay;
  analysis: Analysis | undefined;
  ply: number;
  go: (n: number) => void;
}) {
  const cell = (j: number) =>
    replay.verbose[j] ? (
      <button className={`mv ${ply === j + 1 ? "cur" : ""}`} onClick={() => go(j + 1)}>
        {analysis && <Badge label={analysis.moves[j].label as Label} />}
        {replay.verbose[j].san}
      </button>
    ) : (
      <span />
    );
  return (
    <>
      <span className="no">{i / 2 + 1}.</span>
      {cell(i)}
      {cell(i + 1)}
    </>
  );
}

function Graph({ evals, ply, onPick }: { evals: number[]; ply: number; onPick: (n: number) => void }) {
  const W = 400;
  const H = 60;
  const n = evals.length - 1 || 1;
  const x = (i: number) => (i / n) * W;
  const y = (cp: number) => H - (winPct(cp) / 100) * H;
  const pts = evals.map((cp, i) => `${x(i)},${y(cp)}`).join(" ");
  return (
    <svg
      className="graph"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onPick(Math.round(((e.clientX - r.left) / r.width) * n));
      }}
    >
      <rect width={W} height={H} fill="#2b2350" />
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill="#fff" />
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="#7c5cff" strokeDasharray="4 4" />
      <line x1={x(ply)} x2={x(ply)} y1="0" y2={H} stroke="#ffc933" strokeWidth="3" />
    </svg>
  );
}
