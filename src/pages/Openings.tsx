import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Chess } from "chess.js";
import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import { api } from "../../convex/_generated/api";
import { Board } from "../components/Board";
import { buildClips, type Clip, type ClipKind, type OpeningGame } from "../lib/clips";
import type { PositionEval } from "../lib/engine";
import { explain } from "../lib/explain";
import { loadOpenings, nameOpening } from "../lib/openings";
import { playDrag, playUci, positionInfo, uciOf } from "../lib/position";
import { evaluateFen, moveLoss, uciToSan } from "../lib/review";
import { playMove, soundFor } from "../lib/sound";
import { Loader } from "../components/Loader";

const DEPTH = 14;
const STEP_MS = 320; // intro replay speed
const LINE_MS = 750; // engine line replay speed

const KIND: Record<ClipKind, { tag: string; icon: string }> = {
  "your-move": { tag: "Your move", icon: "🎯" },
  "their-favourite": { tag: "Their favourite", icon: "🔥" },
  trap: { tag: "Trap alert", icon: "⚠️" },
  "fell-for": { tag: "You fell for this", icon: "🤦" },
};

type Progress = NonNullable<FunctionReturnType<typeof api.openings.progress>>;
type Result = Progress["results"][number];

const STATUS: Record<"new" | "wrong" | "right", string> = { new: "New", wrong: "Missed last time", right: "✓ Learned" };

/**
 * Feed order: clips never answered first (in the builder's mixed order), then ones missed last time,
 * then ones already got right, longest ago first, so a revisit is a review.
 */
function order(clips: Clip[], results: Map<string, Result>): Clip[] {
  const rank = (c: Clip) => {
    const r = results.get(c.id);
    return r ? (r.lastResult === "wrong" ? 1 : 2) : 0;
  };
  return clips
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || (rank(a.c) ? (results.get(a.c.id)!.lastAt - results.get(b.c.id)!.lastAt) : a.i - b.i))
    .map((x) => x.c);
}

export function Openings() {
  const games = useQuery(api.games.openingData);
  const progress = useQuery(api.openings.progress);
  if (games === undefined || progress === undefined) return <Loader label="Loading your openings" />;
  return <Feed games={games} progress={progress ?? { results: [], xp: 0, streak: 0, best: 0 }} />;
}

function Feed({ games, progress }: { games: OpeningGame[]; progress: Progress }) {
  const record = useMutation(api.openings.record);
  const results = useMemo(() => new Map(progress.results.map((r) => [r.clipId, r])), [progress.results]);
  // the order is fixed when the page opens, so answering a clip doesn't reshuffle the feed under you
  const [startResults] = useState(results);
  const clips = useMemo(() => order(buildClips(games), startResults), [games, startResults]);
  const [index, setIndex] = useState(0);
  const wheelAt = useRef(0);
  const touchY = useRef<number | null>(null);

  const go = (d: number) => setIndex((i) => Math.max(0, Math.min(clips.length - 1, i + d)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "PageDown") go(1);
      else if (e.key === "ArrowUp" || e.key === "PageUp") go(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const learned = clips.filter((c) => results.get(c.id)?.lastResult === "right").length;

  if (!clips.length) {
    return (
      <div className="openings">
        <h1>Openings</h1>
        <div className="card stack-tight" style={{ maxWidth: 560 }}>
          <h2>Not enough games yet</h2>
          <p className="muted">
            Opening clips are built from positions you reach again and again, what your opponents play against you, and where they
            blunder. Import a few more games and they'll appear here.
          </p>
        </div>
      </div>
    );
  }

  const clip = clips[Math.min(index, clips.length - 1)];
  const before = startResults.get(clip.id);
  const status = before ? before.lastResult : "new";

  return (
    <div
      className="openings"
      onWheel={(e) => {
        // one clip per flick of the wheel or trackpad
        if (Math.abs(e.deltaY) < 30 || Date.now() - wheelAt.current < 700) return;
        wheelAt.current = Date.now();
        go(e.deltaY > 0 ? 1 : -1);
      }}
      onTouchStart={(e) => (touchY.current = e.touches[0].clientY)}
      onTouchEnd={(e) => {
        if (touchY.current === null) return;
        const dy = touchY.current - e.changedTouches[0].clientY;
        touchY.current = null;
        if (Math.abs(dy) > 60) go(dy > 0 ? 1 : -1);
      }}
    >
      <div className="reel-top">
        <h1>Openings</h1>
        <span className="reel-count muted small">
          Clip {index + 1} of {clips.length} · {learned} learned
        </span>
        <span className="reel-score">
          <b>{progress.xp}</b> XP
        </span>
        <span className={`reel-streak ${progress.streak >= 3 ? "hot" : ""}`} title={`Best streak: ${progress.best}`}>
          🔥 {progress.streak}
        </span>
      </div>
      <ClipPlayer
        key={clip.id}
        clip={clip}
        status={STATUS[status]}
        onAnswer={(correct) => void record({ clipId: clip.id, correct })}
        onNext={index < clips.length - 1 ? () => go(1) : undefined}
      />
      <div className="reel-nav">
        <button className="btn sm ghost" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous clip">
          ▲
        </button>
        <button className="btn sm ghost" onClick={() => go(1)} disabled={index >= clips.length - 1} aria-label="Next clip">
          ▼
        </button>
      </div>
    </div>
  );
}

type Phase = "intro" | "quiz" | "checking" | "right" | "wrong" | "line";

function ClipPlayer({ clip, status, onAnswer, onNext }: { clip: Clip; status: string; onAnswer: (correct: boolean) => void; onNext?: () => void }) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [fen, setFen] = useState(new Chess().fen());
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>();
  const [step, setStep] = useState(0);
  const [ev, setEv] = useState<PositionEval | null>(null);
  const [answer, setAnswer] = useState<{ san: string; uci: string; ok: boolean } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [arrows, setArrows] = useState<DrawShape[]>([]);
  const timers = useRef<number[]>([]);
  const answered = useRef(false);

  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));
  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clear, []);

  // what the engine makes of the quiz position (and, for traps, why the opponent's move loses)
  useEffect(() => {
    let live = true;
    void (async () => {
      const e = await evaluateFen(clip.fen, DEPTH);
      if (!live) return;
      setEv(e);
      if (clip.theirMove) {
        const before = await evaluateFen(clip.theirMove.before, DEPTH);
        const c = new Chess(clip.theirMove.before);
        const m = c.move(clip.theirMove.san);
        if (live) setWhy(explain(clip.theirMove.before, uciOf(m), before, e, false).reason);
      }
    })();
    return () => {
      live = false;
    };
  }, [clip]);

  // the intro: play the moves from the start, naming the opening as it's reached
  const intro = () => {
    clear();
    answered.current = false;
    setPhase("intro");
    setAnswer(null);
    setArrows([]);
    setStep(0);
    setOpening(null);
    setFen(new Chess().fen());
    setLastMove(undefined);
    const c = new Chess();
    const speed = clip.moves.length > 12 ? STEP_MS * 0.7 : STEP_MS;
    clip.moves.forEach((san, i) => {
      const m = c.move(san);
      later(() => {
        setFen(m.after);
        setLastMove([m.from, m.to]);
        setStep(i + 1);
        playMove(soundFor(m.san));
      }, 250 + speed * i);
    });
    later(() => setPhase("quiz"), 250 + speed * clip.moves.length + 150);
  };

  useEffect(() => {
    let live = true;
    void loadOpenings().then((table) => {
      if (live) setOpening((o) => o ?? nameOpening(table, clip.moves)?.name ?? null);
    });
    intro();
    return () => {
      live = false;
    };
    // the clip is fixed for this player (it's keyed by clip id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Play the engine's line from the quiz position, with arrows, after the answer. */
  const showLine = (from: string, pv: string[]) => {
    let at = from;
    pv.slice(0, 5).forEach((u, i) => {
      const m = playUci(at, u);
      if (!m) return;
      at = m.after;
      later(() => {
        setFen(m.after);
        setLastMove([m.from, m.to]);
        setArrows([]);
        playMove(soundFor(m.san));
      }, LINE_MS * (i + 1));
    });
    later(() => setPhase("line"), LINE_MS * (Math.min(pv.length, 5) + 1));
  };

  const onMove = async (orig: Key, dest: Key) => {
    if (phase !== "quiz" || !ev) return;
    const m = playDrag(clip.fen, orig, dest);
    if (!m) return;
    const uci = uciOf(m);
    setFen(m.after);
    setLastMove([m.from, m.to]);
    playMove(soundFor(m.san));
    setPhase("checking");
    let ok = uci === ev.best;
    if (!ok && m.san !== clip.played) {
      const after = await evaluateFen(m.after, DEPTH);
      ok = moveLoss(ev, after, uci, clip.color === "white") <= 3;
    }
    setAnswer({ san: m.san, uci, ok });
    if (!answered.current) {
      answered.current = true;
      onAnswer(ok);
    }
    setPhase(ok ? "right" : "wrong");
    // then the engine's line from the quiz position, starting with its move
    later(() => {
      setFen(clip.fen);
      setLastMove(undefined);
      if (ev.best) setArrows([{ orig: ev.best.slice(0, 2) as Key, dest: ev.best.slice(2, 4) as Key, brush: "green" }]);
      showLine(clip.fen, ev.pv);
    }, ok ? 1100 : 1400);
  };

  const position = useMemo(() => positionInfo(fen), [fen]);
  const bestSan = ev?.best ? uciToSan(clip.fen, ev.best) : null;
  const meta = KIND[clip.kind];

  const caption = (() => {
    if (phase === "intro") return { big: clip.hook, small: " " };
    if (phase === "quiz") return { big: clip.ask, small: ev ? "Play it on the board." : "Getting the engine ready…" };
    if (phase === "checking") return { big: "Hmm…", small: "Checking your move." };
    const usual = clip.usual && clip.usual.san !== bestSan ? clip.usual : null;
    if (answer?.ok) {
      return {
        big: answer.uci === ev?.best ? `${answer.san}! That's the move.` : `${answer.san} works! The engine's pick is ${bestSan}.`,
        small:
          clip.kind === "trap" && why
            ? why.replace(/^It /, `Their ${clip.theirMove?.san} `)
            : usual
              ? `You usually play ${usual.san} here (${usual.count} of ${usual.of}). Make this one your habit.`
              : "Watch how it goes.",
      };
    }
    return {
      big: `Not ${answer?.san}. It's ${bestSan}!`,
      small:
        clip.kind === "trap" && why
          ? why.replace(/^It /, `Their ${clip.theirMove?.san} `)
          : clip.kind === "fell-for" && clip.played
            ? `In your game you played ${clip.played}. Watch the better line.`
            : usual
              ? `You usually play ${usual.san} here (${usual.count} of ${usual.of}). Watch the stronger line.`
              : "Watch the stronger line.",
    };
  })();

  const total = clip.moves.length;
  return (
    <div className={`reel ${phase}`}>
      <div className="reel-progress">
        <div style={{ width: `${phase === "intro" ? (step / Math.max(1, total)) * 100 : 100}%` }} />
      </div>
      <div className="reel-head">
        <span className="row-tight">
          <span className={`reel-tag k-${clip.kind}`}>
            {meta.icon} {meta.tag}
          </span>
          <span className="reel-status small">{status}</span>
        </span>
        <span className="reel-side muted small">
          {opening ? `${opening} · ` : ""}you play {clip.color}
        </span>
      </div>
      <div className="reel-board">
        <Board
          fen={fen}
          orientation={clip.color}
          lastMove={lastMove}
          shapes={arrows}
          turnColor={position.turn}
          check={position.check}
          dests={phase === "quiz" && ev ? position.dests : new Map()}
          onMove={(o, d) => void onMove(o, d)}
        />
        {(phase === "right" || phase === "wrong") && <div className={`reel-burst ${phase}`}>{phase === "right" ? "✓" : "✗"}</div>}
      </div>
      <div className="reel-caption">
        <div className="reel-big">{caption.big}</div>
        <div className="reel-small muted">{caption.small}</div>
      </div>
      <div className="row reel-actions">
        <button className="btn sm ghost" onClick={intro} disabled={phase === "checking"}>
          ↻ Replay
        </button>
        {phase === "line" || phase === "right" || phase === "wrong" ? (
          onNext && (
            <button className="btn sm grape" onClick={onNext}>
              Next clip ▼
            </button>
          )
        ) : (
          phase === "intro" && (
            <button
              className="btn sm ghost"
              onClick={() => {
                clear();
                setFen(clip.fen);
                setStep(total);
                setPhase("quiz");
              }}
            >
              Skip intro
            </button>
          )
        )}
      </div>
    </div>
  );
}
