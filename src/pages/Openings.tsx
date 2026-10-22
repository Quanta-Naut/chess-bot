import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Chess, type Move } from "chess.js";
import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { BackIcon, FlipIcon, RestartIcon } from "../components/Icons";
import { Board } from "../components/Board";
import { Loader } from "../components/Loader";
import { MiniBoard } from "../components/MiniBoard";
import { getEngine, type PositionEval } from "../lib/engine";
import { explain } from "../lib/explain";
import { LAB, PRINCIPLES, brokenRule, describeLine, labKey, type LabOpening, type Side } from "../lib/lab";
import { loadOpenings, nameOpening } from "../lib/openings";
import { playDrag, playUci, positionInfo, uciOf } from "../lib/position";
import { evaluateFen, moveLoss, uciToSan } from "../lib/review";
import { playMove, soundFor } from "../lib/sound";

// How the Lab teaches: you learn by playing, and by seeing what your mistakes cost.
// Learn: the line's first move is shown, then the opponent moves and you choose your reply. Any move is allowed.
//   A good move that isn't the line's is accepted, and the line's move is shown with its idea.
//   A bad move is punished on the board: the engine plays out the refutation, and the coach (an LLM, given the
//   engine's line, what it wins, and what real players at your level score) says what went wrong.
//   Taking it back gives a stronger hint (the idea, then the piece, then the arrow), never another blind guess.
// Spar: no hints, and the opponent may leave the book with a move real players at your level often choose.
// Every punished move is saved as a slip, to replay from the same position later until it's fixed.

const DEPTH = 12;
const REPLY_MS = 550;
const LINE_MS = 650; // the punishing line, played out
const LINE_PLIES = 5;
const OK_LOSS = 4; // win% a move may lose and still count as fine

type Progress = NonNullable<FunctionReturnType<typeof api.lab.progress>>;
type Row = Progress["rows"][number];
type Lesson = Progress["lessons"][number];
type Mode = "learn" | "spar" | "lessons";
type GameRow = FunctionReturnType<typeof api.games.openingData>[number];
type Explorer = NonNullable<FunctionReturnType<typeof api.lab.explore>>;

const MODES: { id: Mode; name: string }[] = [
  { id: "learn", name: "Learn" },
  { id: "spar", name: "Spar" },
  { id: "lessons", name: "Fix slips" },
];

const fenAfter = (sans: string[], start?: string) => {
  const g = new Chess(start);
  for (const s of sans) g.move(s);
  return g.fen();
};

const finalFen = (o: LabOpening) => fenAfter(o.line.map((m) => m.san));

/** Moves in SAN, numbered from the position they start in: "3. Nh3 d5 4. exd5". */
function numbered(fen: string, sans: string[]): string {
  const [, turn, , , , no] = fen.split(" ");
  let n = Number(no);
  let white = turn === "w";
  const out: string[] = [];
  sans.forEach((s, i) => {
    if (white) out.push(`${n}. ${s}`);
    else out.push(i === 0 ? `${n}… ${s}` : s);
    if (!white) n++;
    white = !white;
  });
  return out.join(" ");
}

/** How the side to move scored with one explorer move (or the whole position), 0-100. */
const scoreFor = (r: { white: number; draws: number; black: number }, color: "w" | "b") => {
  const n = r.white + r.draws + r.black;
  return n ? Math.round((100 * ((color === "w" ? r.white : r.black) + r.draws / 2)) / n) : 50;
};

/** Where you are with one opening as one colour, and what to do next. */
function stage(row: Row | undefined, now: number): { mode: Mode; text: string; done: number } {
  if (!row?.learned) return { mode: "learn", text: "Learn", done: 0 };
  if (row.practiced < 1) return { mode: "learn", text: "Learn: clean run", done: 1 };
  if (!row.sparred) return { mode: "spar", text: "Spar", done: 2 };
  if (row.due && row.due <= now) return { mode: "spar", text: "Review due", done: 2 };
  const days = row.due ? Math.max(1, Math.round((row.due - now) / 86400000)) : 0;
  return { mode: "spar", text: days ? `✓ Next in ${days}d` : "✓ Mastered", done: 3 };
}

export function Openings() {
  const progress = useQuery(api.lab.progress);
  const games = useQuery(api.games.openingData);
  const [open, setOpen] = useState<{ id: string; side: Side; mode: Mode } | null>(null);
  if (progress === undefined || games === undefined) return <Loader label="Loading the Opening Lab" />;
  const data = progress ?? { rows: [], lessons: [] };
  const opening = open && LAB.find((o) => o.id === open.id);
  if (open && opening) {
    return (
      <Lab
        key={`${open.id}:${open.side}:${open.mode}`}
        opening={opening}
        side={open.side}
        mode={open.mode}
        lessons={data.lessons.filter((l) => l.key === labKey(open.id, open.side))}
        onMode={(mode) => setOpen({ ...open, mode })}
        onExit={() => setOpen(null)}
      />
    );
  }
  return <Shelf data={data} games={games} onOpen={(id, side, mode) => setOpen({ id, side, mode })} />;
}

/** The opening cards: the ones you meet most in your own games first. */
function Shelf({ data, games, onOpen }: { data: Progress; games: GameRow[]; onOpen: (id: string, side: Side, mode: Mode) => void }) {
  const [names, setNames] = useState<Map<string, string> | null>(null);
  const [now] = useState(() => Date.now());
  useEffect(() => {
    let live = true;
    void loadOpenings().then((table) => {
      if (live) setNames(new Map(games.map((g) => [g.code ?? g.sans.join(" "), nameOpening(table, g.sans)?.name ?? ""])));
    });
    return () => {
      live = false;
    };
  }, [games]);

  const cards = useMemo(() => {
    const seen = (o: LabOpening, side: Side) =>
      games.filter((g) => g.myColor === side && (names?.get(g.code ?? g.sans.join(" ")) ?? "").includes(o.family)).length;
    return LAB.map((o) => ({ o, white: seen(o, "white"), black: seen(o, "black"), fen: finalFen(o) })).sort(
      (a, b) => b.white + b.black - (a.white + a.black),
    );
  }, [games, names]);

  const rows = new Map(data.rows.map((r) => [r.key, r]));
  const slips = data.lessons.length;

  return (
    <div className="lab-shelf">
      <div className="row page-head">
        <h1>Opening Lab</h1>
        <span className="muted small grow desk-only">Pick an opening and a colour. Play the line, see what goes wrong, then spar.</span>
        {slips > 0 && (
          <button
            className="chip-btn on lab-slips"
            onClick={() => {
              const [id, side] = data.lessons[0].key.split(":");
              onOpen(id, side as Side, "lessons");
            }}
          >
            {slips} slip{slips === 1 ? "" : "s"} to fix
          </button>
        )}
      </div>
      <div className="lab-grid">
        {cards.map(({ o, white, black, fen }) => (
          <div key={o.id} className="card flat lab-op">
            <MiniBoard fen={fen} orientation="white" />
            <div className="lab-op-body">
              <b className="lab-op-name">{o.name}</b>
              <p className="muted small lab-op-blurb">{o.blurb}</p>
              {white + black > 0 && (
                <p className="tiny muted lab-op-seen">
                  In your games: {[white && `${white}× as White`, black && `${black}× as Black`].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
            <div className="lab-sides">
              {(["white", "black"] as const).map((side) => {
                const key = labKey(o.id, side);
                const st = stage(rows.get(key), now);
                const fix = data.lessons.filter((l) => l.key === key).length;
                return (
                  <button key={side} className={`lab-side s-${side} ${st.text === "Review due" ? "due" : ""}`} onClick={() => onOpen(o.id, side, st.mode)}>
                    <span className="lab-side-top">
                      <span className="pavatar" style={{ background: side === "white" ? "#fff" : "#2b2350" }} />
                      {side === "white" ? "White" : "Black"}
                      {fix > 0 && <span className="lab-fix">{fix}</span>}
                    </span>
                    <span className="lab-pips" aria-hidden>
                      {[0, 1, 2].map((i) => (
                        <span key={i} className={i < st.done ? "on" : ""} />
                      ))}
                    </span>
                    <span className="lab-stage">{st.text}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


/** What the teaching card says right now. */
type Card =
  | { t: "plan" }
  | { t: "show"; alt?: string } // play the line's move (shown with an arrow): the first move, or after a fine alternative
  | { t: "turn" } // your move
  | { t: "checking" }
  | { t: "replay"; san: string } // the punishment being played out
  | { t: "punished"; san: string; key: string; rule: string | null; finding: string; coach: string | null | "loading"; humans: string | null }
  | { t: "left-book"; san: string; humans: string | null }
  | { t: "mistakes"; list: { san: string; uci: string; share: number; score: number }[] | null }
  | { t: "lesson-ok"; san: string }
  | { t: "free" }
  | { t: "done"; clean: boolean };

interface Snapshot {
  sans: string[];
  offBook: boolean;
}

function Lab({
  opening,
  side,
  mode,
  lessons,
  onMode,
  onExit,
}: {
  opening: LabOpening;
  side: Side;
  mode: Mode;
  lessons: Lesson[];
  onMode: (m: Mode) => void;
  onExit: () => void;
}) {
  const key = labKey(opening.id, side);
  const line = opening.line;
  const finish = useMutation(api.lab.finish);
  const addLesson = useMutation(api.lab.addLesson);
  const lessonResult = useMutation(api.lab.lessonResult);
  const explore = useAction(api.lab.explore);
  const explainSlip = useAction(api.lab.explainSlip);

  // the lesson queue is fixed when the mode opens, so fixing one doesn't reshuffle it
  const [queue] = useState(lessons);
  const [lessonAt, setLessonAt] = useState(0);
  const lesson = mode === "lessons" ? queue[lessonAt] : undefined;

  const [sans, setSans] = useState<string[]>([]);
  const [offBook, setOffBook] = useState(false);
  const [card, setCard] = useState<Card>(mode === "learn" ? { t: "plan" } : { t: "turn" });
  const [note, setNote] = useState<string | null>(null); // what their last move does
  // hints for the line's move: 0 none, 1 the principle, 2 the idea, 3 + the piece, 4 + the arrow
  const [hint, setHint] = useState(0);
  const [slips, setSlips] = useState(0);
  const [helped, setHelped] = useState(false);
  const [threat, setThreat] = useState<{ uci: string; san: string } | null>(null);
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>();
  const [orientation, setOrientation] = useState<Side>(side);
  const [pending, setPending] = useState<Snapshot | null>(null); // where a take-back returns to
  const [freeFrom, setFreeFrom] = useState<Snapshot | null>(null);
  const [hasExplorer, setHasExplorer] = useState(true); // false once the explorer says it isn't set up
  const gen = useRef(0);
  const timers = useRef<number[]>([]);
  const deviateAt = useRef(-1);
  const explored = useRef(new Map<string, Promise<Explorer | null>>());
  const stripRef = useRef<HTMLDivElement>(null);
  const [table, setTable] = useState<Awaited<ReturnType<typeof loadOpenings>> | null>(null);

  const startFen = lesson?.fen ?? new Chess().fen();
  const { fen, history } = useMemo(() => {
    const g = new Chess(startFen);
    for (const s of sans) g.move(s);
    return { fen: g.fen(), history: g.history({ verbose: true }) };
  }, [startFen, sans]);
  const ply = sans.length;
  const myColor = side === "white" ? "w" : "b";
  const myTurn = fen.split(" ")[1] === myColor;
  const book = !offBook && !lesson && ply < line.length ? line[ply] : undefined;

  const later = (fn: () => void, ms: number) => {
    const g = gen.current;
    timers.current.push(window.setTimeout(() => g === gen.current && fn(), ms));
  };
  const stopAll = () => {
    gen.current++;
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => stopAll, []);

  useEffect(() => {
    let live = true;
    void loadOpenings().then((t) => live && setTable(t));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    stripRef.current?.scrollTo({ left: stripRef.current.scrollWidth, top: stripRef.current.scrollHeight });
  }, [sans]);

  /** What real players do in a position (asked once per position). */
  const humans = (at: string) => {
    let p = explored.current.get(at);
    if (!p) {
      p = explore({ fen: at }).catch(() => null);
      explored.current.set(at, p);
      void p.then((r) => r === null && setHasExplorer(false));
    }
    return p;
  };

  const show = (next: string[], move: Move | null) => {
    setSans(next);
    setThreat(null);
    if (move) {
      setLastMove([move.from as Key, move.to as Key]);
      playMove(soundFor(move.san));
    } else setLastMove(undefined);
  };

  const ended = (next: string[], nowOff: boolean) => (nowOff ? next.length >= line.length + 2 : next.length >= line.length);

  const complete = (clean: boolean) => {
    setCard({ t: "done", clean });
    void finish({ key, mode: mode === "spar" ? "spar" : "learn", clean });
  };

  /** After your move lands: the opponent's turn, or the end of the line. */
  const advance = (next: string[], nowOff: boolean, cleanSoFar: boolean) => {
    if (mode === "lessons") return;
    setHint(0);
    if (ended(next, nowOff)) {
      later(() => complete(cleanSoFar), 400);
      return;
    }
    setCard({ t: "turn" });
    later(() => void theirMove(next, nowOff, cleanSoFar), REPLY_MS);
  };

  /** The opponent moves: the book move, a sparring surprise, or the engine once off the book. */
  const theirMove = async (cur: string[], curOff: boolean, cleanSoFar: boolean) => {
    const g = gen.current;
    const at = fenAfter(cur);
    const color = at.split(" ")[1] as "w" | "b";
    let uci: string | null = null;
    let leaving = false;
    let humansText: string | null = null;
    if (!curOff) {
      const bookUci = uciOf(new Chess(at).move(line[cur.length].san));
      if (mode === "spar" && cur.length === deviateAt.current) {
        // a surprise: the most played other move at club level, or else the engine's second choice
        const ex = await humans(at);
        if (g !== gen.current) return;
        const alt = ex?.moves.find((m) => m.uci !== bookUci && m.games >= ex.games * 0.05 && scoreFor(m, color) >= 45);
        if (alt && ex) {
          uci = alt.uci;
          humansText = `Club players choose ${alt.san} in ${Math.round((100 * alt.games) / ex.games)}% of games here.`;
        } else {
          const res = await getEngine().search(at, `depth ${DEPTH}`);
          if (g !== gen.current) return;
          const second = res.lines[1];
          const sign = color === "w" ? 1 : -1;
          if (second && second.pv[0] !== bookUci && (res.lines[0].cp - second.cp) * sign < 80) uci = second.pv[0];
        }
        leaving = !!uci;
      }
      uci ??= bookUci;
    } else {
      const ev = await evaluateFen(at, DEPTH);
      if (g !== gen.current) return;
      uci = ev.best;
    }
    const m = uci ? playUci(at, uci) : null;
    if (!m) return complete(cleanSoFar);
    const next = [...cur, m.san];
    const nowOff = curOff || leaving;
    show(next, m);
    if (leaving) setOffBook(true);
    setNote(!curOff && !leaving && mode === "learn" ? `${m.san}: ${line[cur.length].idea}` : null);
    if (ended(next, nowOff)) return later(() => complete(cleanSoFar), 400);
    setCard(leaving ? { t: "left-book", san: m.san, humans: humansText } : { t: "turn" });
  };

  const begin = () => {
    stopAll();
    setSans([]);
    setOffBook(false);
    setLastMove(undefined);
    setThreat(null);
    setNote(null);
    setSlips(0);
    setHelped(false);
    setHint(0);
    setFreeFrom(null);
    setPending(null);
    // sparring: one of their moves from the 4th ply on may leave the book (most runs)
    const theirs = line.map((_, i) => i).filter((i) => i >= 3 && i < line.length - 1 && (i % 2 === 0) !== (side === "white"));
    deviateAt.current = Math.random() < 0.7 ? theirs[Math.floor(Math.random() * theirs.length)] : -1;
    if (mode === "lessons") return setCard({ t: "turn" });
    if (side === "black") {
      setCard({ t: "turn" });
      later(() => void theirMove([], false, true), REPLY_MS);
    } else setCard(mode === "learn" ? { t: "show" } : { t: "turn" });
  };

  // spar and slips start at once; learn starts on the plan card
  useEffect(() => {
    if (mode !== "learn") begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMove = async (orig: Key, dest: Key) => {
    const g = gen.current;
    const m = playDrag(fen, orig, dest);
    if (!m) return;
    const before = sans;
    const next = [...sans, m.san];

    if (card.t === "free") {
      show(next, m);
      later(async () => {
        const ev = await evaluateFen(m.after, DEPTH);
        const r = ev.best && playUci(m.after, ev.best);
        if (r && g === gen.current) show([...next, r.san], r);
      }, REPLY_MS);
      return;
    }

    // the line's move, shown with an arrow (only that move is allowed)
    if (card.t === "show") {
      show(next, m);
      advance(next, false, slips === 0 && !helped);
      return;
    }

    if (book && m.san === book.san) {
      show(next, m);
      setNote(`✓ ${m.san}: ${book.idea}`);
      advance(next, offBook, slips === 0 && !helped);
      return;
    }

    // not the book move: let the engine judge it
    show(next, m);
    setNote(null);
    setCard({ t: "checking" });
    const [bEv, aEv] = await Promise.all([evaluateFen(fen, DEPTH), evaluateFen(m.after, DEPTH)]);
    if (g !== gen.current) return;
    const loss = m.san === uciToSan(fen, bEv.best) ? 0 : moveLoss(bEv, aEv, uciOf(m), myColor === "w");

    if (lesson) {
      const ok = loss < OK_LOSS;
      void lessonResult({ id: lesson.id as Id<"labLessons">, ok });
      if (ok) setCard({ t: "lesson-ok", san: m.san });
      else punish(before, fen, m, bEv, aEv, false);
      return;
    }

    if (loss < OK_LOSS) {
      if (book && mode === "learn") {
        // a good move, but this run is about the line: take it back and show the line's move
        later(() => {
          show(before, null);
          setCard({ t: "show", alt: m.san });
        }, 700);
        return;
      }
      setNote(book ? `✓ ${m.san} is sound. The book move is ${book.san}, but you're on your own now.` : `✓ ${m.san}`);
      if (book) setOffBook(true);
      advance(next, true, slips === 0 && !helped);
      return;
    }
    punish(before, fen, m, bEv, aEv, true);
  };

  /** A bad move: the opponent plays out the punishment on the board, then the coach says what went wrong. */
  const punish = (before: string[], beforeFen: string, m: Move, bEv: PositionEval, aEv: PositionEval, save: boolean) => {
    const g = gen.current;
    const ins = explain(beforeFen, uciOf(m), bEv, aEv, true);
    const finding = ins.reason.replace(/\s*(White|Black)'s best reply is [^.]+\.$/, "");
    const rule = brokenRule(m, history, beforeFen);
    const slipKey = `${beforeFen.split(" ").slice(0, 4).join(" ")}:${uciOf(m)}`;
    setSlips((s) => s + 1);
    setPending({ sans: before, offBook });
    setCard({ t: "replay", san: m.san });

    // the refutation, a few moves deep
    const replyLine: Move[] = [];
    let at = m.after;
    for (const u of aEv.pv.slice(0, LINE_PLIES)) {
      const r = playUci(at, u);
      if (!r) break;
      replyLine.push(r);
      at = r.after;
    }
    replyLine.forEach((r, i) => later(() => show([...before, m.san, ...replyLine.slice(0, i + 1).map((x) => x.san)], r), REPLY_MS + LINE_MS * i));

    // what club players do after it, and how they score
    const humansP = humans(m.after).then((ex) => {
      if (!ex || ex.games < 20) return null;
      const top = ex.moves[0];
      const you = scoreFor(ex, myColor);
      return `In ${ex.games.toLocaleString()} club games after ${m.san}, your side scores ${you}%${top ? `; the usual reply is ${top.san}` : ""}.`;
    });

    later(async () => {
      const humansText = await humansP;
      if (g !== gen.current) return;
      setCard({ t: "punished", san: m.san, key: slipKey, rule, finding, coach: "loading", humans: humansText });
      const text = await explainSlip({
        key: slipKey,
        facts: {
          side,
          opening: opening.name,
          moves: numbered(startFen, [...before, m.san]),
          played: m.san,
          line: numbered(m.after, replyLine.map((x) => x.san)),
          steps: [m, ...replyLine].map((x, i) => `${numbered(x.before, [x.san])}${i === 0 ? " (your slip)" : ""}: ${describeLine([x], myColor)[0]}`),
          finding,
          rule: rule ?? undefined,
          bookIdea: book?.idea,
          humans: humansText ?? undefined,
        },
      }).catch(() => null);
      setCard((c) => (c.t === "punished" && c.key === slipKey ? { ...c, coach: text } : c));
    }, REPLY_MS + LINE_MS * Math.max(1, replyLine.length));

    const better = book ? book.san : bEv.best ? uciToSan(beforeFen, bEv.best) : "";
    if (save && better) void addLesson({ key, fen: beforeFen, played: m.san, best: better, reason: rule ? `${rule} ${finding}` : finding });
  };

  const takeBack = (to: Snapshot | null = pending) => {
    if (!to) return;
    stopAll();
    setSans(to.sans);
    setOffBook(to.offBook);
    setLastMove(undefined);
    setFreeFrom(null);
    setPending(null);
    setNote(null);
    // a stronger hint instead of another blind guess: the idea first, then the piece, then the arrow
    setHint((h) => Math.min(4, Math.max(h + 1, 2)));
    setCard({ t: "turn" });
  };

  const playOut = () => {
    setFreeFrom(pending);
    setCard({ t: "free" });
  };

  const askThreat = async () => {
    if (positionInfo(fen).check) return;
    const parts = fen.split(" ");
    parts[1] = parts[1] === "w" ? "b" : "w";
    parts[3] = "-";
    const flipped = parts.join(" ");
    try {
      new Chess(flipped);
    } catch {
      return;
    }
    const ev = await evaluateFen(flipped, 10);
    if (ev.best) setThreat({ uci: ev.best, san: uciToSan(flipped, ev.best) });
  };

  /** Moves club players often get wrong here: popular, but they score badly with them. */
  const commonMistakes = async () => {
    const g = gen.current;
    setCard({ t: "mistakes", list: null });
    const ex = await humans(fen);
    if (g !== gen.current) return;
    if (!ex) return setCard({ t: "turn" });
    const bookUci = book ? uciOf(new Chess(fen).move(book.san)) : "";
    const list = ex.moves
      .filter((mv) => mv.uci !== bookUci && mv.games >= Math.max(10, ex.games * 0.01) && scoreFor(mv, myColor) <= 46)
      .slice(0, 4)
      .map((mv) => ({ san: mv.san, uci: mv.uci, share: Math.max(1, Math.round((100 * mv.games) / ex.games)), score: scoreFor(mv, myColor) }));
    setCard({ t: "mistakes", list });
  };

  const nextLesson = () => {
    stopAll();
    setLessonAt((i) => i + 1);
    setSans([]);
    setLastMove(undefined);
    setThreat(null);
    setHint(0);
    setCard({ t: "turn" });
  };

  // what the board shows and allows
  const position = useMemo(() => positionInfo(fen), [fen]);
  const target = card.t === "show" && line[ply] ? new Chess(fen).move(line[ply].san) : null;
  const canMove = myTurn && ["turn", "free", "show", "left-book", "mistakes"].includes(card.t);
  const dests = !canMove ? new Map<Key, Key[]>() : target ? new Map<Key, Key[]>([[target.from as Key, [target.to as Key]]]) : position.dests;

  const shapes: DrawShape[] = [];
  const hinted = book?.san ?? lesson?.best;
  if (target) shapes.push({ orig: target.from as Key, dest: target.to as Key, brush: "green" });
  else if (card.t === "turn" && myTurn && hinted && hint >= 3) {
    const bm = new Chess(fen).move(hinted);
    shapes.push(hint >= 4 ? { orig: bm.from as Key, dest: bm.to as Key, brush: "green" } : { orig: bm.from as Key, brush: "green" });
  }
  if (threat) shapes.push({ orig: threat.uci.slice(0, 2) as Key, dest: threat.uci.slice(2, 4) as Key, brush: "red" });

  const theirLast = ply > 0 && myTurn ? sans[ply - 1] : null;
  const title = (() => {
    switch (card.t) {
      case "plan":
        return `The plan as ${side === "white" ? "White" : "Black"}`;
      case "show":
        return card.alt ? `${card.alt} works too` : `Start with ${line[ply]?.san}`;
      case "turn":
        if (lesson) return "Find a good move";
        if (!myTurn) return "Their move…";
        return theirLast ? `They play ${theirLast}. What will you play?` : "What will you play?";
      case "checking":
        return "Checking your move…";
      case "replay":
        return `${card.san}? Watch what happens…`;
      case "punished":
        return `${card.san} gets punished`;
      case "left-book":
        return `They surprise you with ${card.san}!`;
      case "mistakes":
        return "Common mistakes here";
      case "lesson-ok":
        return lesson && lesson.fixed + 1 >= 2 ? `${card.san}. Fixed!` : `${card.san}. Good!`;
      case "free":
        return "Play it out";
      case "done":
        return card.clean ? "Clean run!" : "Line finished";
    }
  })();

  const body = (() => {
    switch (card.t) {
      case "plan":
        return (
          <>
            <p>{opening.plan[side]}</p>
            <p className="muted small">The opponent plays the main line; you choose your moves. Play anything you like: if it's a mistake, you'll see exactly how it gets punished.</p>
          </>
        );
      case "show":
        return card.alt ? (
          <p>
            The engine is happy with it. This line plays <b>{line[ply].san}</b> instead: {line[ply].idea} Play it to keep going.
          </p>
        ) : (
          <p>{line[ply]?.idea}</p>
        );
      case "turn": {
        if (lesson) {
          return (
            <>
              <p>Last time you played {lesson.played} here, and it got punished.</p>
              {hint >= 2 && <p className="muted small">{lesson.reason}</p>}
            </>
          );
        }
        if (!myTurn) return null;
        if (!book) return <p className="muted">No script now. Is anything attacked? If not: develop, take the centre, castle.</p>;
        if (hint === 0) return null;
        return (
          <p>
            <b>Hint: {PRINCIPLES[book.principle].name.toLowerCase()}.</b> {hint >= 2 ? book.idea : `${PRINCIPLES[book.principle].ask}.`}
          </p>
        );
      }
      case "checking":
        return null;
      case "replay":
        return <p className="muted">This is the engine's punishment.</p>;
      case "punished":
        return (
          <>
            {card.rule && (
              <p>
                <b>{card.rule}</b>
              </p>
            )}
            {card.coach === "loading" ? (
              <>
                <p>{card.finding}</p>
                <p className="muted small">The coach is looking at it…</p>
              </>
            ) : (
              <p>{card.coach ?? card.finding}</p>
            )}
            {card.humans && <p className="muted small desk-only">{card.humans}</p>}
          </>
        );
      case "left-book":
        return (
          <>
            <p>That's not the main line, so there's no script now. Is something attacked? If not, develop and get castled.</p>
            {card.humans && <p className="muted small">{card.humans}</p>}
          </>
        );
      case "mistakes":
        if (!card.list) return <p className="muted">Looking at club games…</p>;
        if (!card.list.length) return <p className="muted">No popular mistakes here: club players mostly get this one right.</p>;
        return (
          <>
            <p className="muted small">Popular with club players here, but they score badly with them. Tap one to see why.</p>
            <div className="lab-choices">
              {card.list.map((mv) => (
                <button
                  key={mv.uci}
                  className="lab-choice"
                  onClick={() => void onMove(mv.uci.slice(0, 2) as Key, mv.uci.slice(2, 4) as Key)}
                >
                  <b>{mv.san}</b>
                  <span className="muted small">
                    {" "}
                    · played {mv.share}% · scores {mv.score}%
                  </span>
                </button>
              ))}
            </div>
          </>
        );
      case "lesson-ok":
        return <p className="muted">{lesson && lesson.fixed + 1 >= 2 ? "That one's done." : "Get it once more and it's done."}</p>;
      case "free":
        return <p className="muted">Keep playing against the engine to see where it goes. Go back whenever you like.</p>;
      case "done":
        return (
          <p>
            {card.clean
              ? mode === "spar"
                ? "No slips and no hints. It comes back for review in a few days."
                : "No slips. You know this line: time to spar."
              : `${slips} slip${slips === 1 ? "" : "s"}. They're saved, so you can fix them.`}
          </p>
        );
    }
  })();

  const actions = (() => {
    switch (card.t) {
      case "plan":
        return (
          <button className="btn grape" onClick={begin}>
            Start
          </button>
        );
      case "punished":
        return (
          <>
            <button className="btn grape" onClick={() => takeBack()}>
              Take back
            </button>
            <button className="btn sm ghost" onClick={playOut}>
              Play it out
            </button>
          </>
        );
      case "mistakes":
        return (
          <button className="btn sm ghost" onClick={() => setCard({ t: "turn" })}>
            Back
          </button>
        );
      case "free":
        return (
          freeFrom && (
            <button className="btn grape" onClick={() => takeBack(freeFrom)}>
              Back to the lesson
            </button>
          )
        );
      case "lesson-ok":
        return queue[lessonAt + 1] ? (
          <button className="btn grape" onClick={nextLesson}>
            Next slip
          </button>
        ) : (
          <button className="btn grape" onClick={onExit}>
            All done
          </button>
        );
      case "done":
        return (
          <>
            {card.clean && mode === "learn" ? (
              <button className="btn grape" onClick={() => onMode("spar")}>
                Spar
              </button>
            ) : (
              <button className="btn grape" onClick={begin}>
                {mode === "spar" ? "Spar again" : "Again"}
              </button>
            )}
            {slips > 0 && (
              <button className="btn sm ghost" onClick={() => onMode("lessons")}>
                Fix slips
              </button>
            )}
          </>
        );
      default:
        return null;
    }
  })();

  // the moves so far, numbered; moves off the line in red
  const startNo = Number(startFen.split(" ")[5]);
  const blackFirst = startFen.split(" ")[1] === "b";
  const moveList = sans.map((s, i) => {
    const idx = i + (blackFirst ? 1 : 0);
    const no = startNo + Math.floor(idx / 2);
    const label = idx % 2 === 0 ? `${no}.` : i === 0 ? `${no}…` : "";
    const isBook = !lesson && i < line.length && sans.slice(0, i + 1).every((x, j) => x === line[j].san);
    return (
      <span key={i} className={`lab-mv ${isBook ? "" : "off"}`}>
        {label && <i>{label}</i>}
        {s}
      </span>
    );
  });

  const cardTone =
    card.t === "punished" || card.t === "replay"
      ? "bad"
      : (card.t === "done" && card.clean) || card.t === "lesson-ok"
        ? "good"
        : card.t === "left-book" || card.t === "mistakes"
          ? "warn"
          : "";
  const availableModes = MODES.filter((m) => m.id !== "lessons" || lessons.length > 0 || mode === "lessons");
  const yourTurnNow = myTurn && card.t === "turn";
  // the exact variation the moves have reached so far (it follows you off the main line too)
  const reached = (!lesson && table && sans.length ? nameOpening(table, sans)?.name : null) ?? opening.name;

  return (
    <div className="lab">
      {/* back on the left, the opening you've reached on the right */}
      <div className="row page-head lab-head">
        <button className="btn sm ghost icon-btn" onClick={onExit} aria-label="Back to openings" title="Back to openings">
          <BackIcon />
        </button>
        <span className="lab-title" title={`${reached} as ${side === "white" ? "White" : "Black"}`}>
          <b>{reached}</b> <span className="muted">as {side === "white" ? "White" : "Black"}</span>
        </span>
      </div>
      <div className="trainer">
        <div className="board-col">
          <div className="board-area">
            <Board
              fen={fen}
              orientation={orientation}
              lastMove={lastMove}
              shapes={shapes}
              turnColor={position.turn}
              check={position.check}
              dests={dests}
              onMove={(o, d) => void onMove(o, d)}
            />
          </div>
        </div>

        <div className="side-col">
          <div className="lab-modes">
            {availableModes.map((m) => (
              <button key={m.id} className={`chip-btn ${mode === m.id ? "on" : ""}`} onClick={() => m.id !== mode && onMode(m.id)}>
                {m.name}
                {m.id === "lessons" && <b>{lessons.length}</b>}
              </button>
            ))}
          </div>

          <div className={`card flat lab-card ${cardTone}`}>
            <div className="lab-card-title">{title}</div>
            {note && (card.t === "turn" || card.t === "show") && <p className="lab-note small">{note}</p>}
            {threat && (
              <p className="lab-threat small">
                If it were their move, they'd play <b>{threat.san}</b>.
              </p>
            )}
            <div className="lab-card-body">{mode === "lessons" && !lesson ? <p className="muted">No slips to fix here. Nice.</p> : body}</div>
            <div className="row lab-card-actions">{actions}</div>
          </div>

          {sans.length > 0 && (
            <div className="lab-moves" ref={stripRef}>
              {moveList}
            </div>
          )}

          <div className="row lab-tools">
            {yourTurnNow && hinted && hint < 4 && (
              <button
                className="btn sm ghost"
                onClick={() => {
                  setHint((h) => Math.min(4, h + 1));
                  setHelped(true);
                }}
              >
                Hint
              </button>
            )}
            {yourTurnNow && hasExplorer && !lesson && (
              <button className="btn sm ghost" onClick={() => void commonMistakes()} title="Common mistakes club players make here">
                Mistakes
              </button>
            )}
            <button className="btn sm ghost" onClick={() => void askThreat()} disabled={!myTurn || card.t === "checking" || position.check} title="What would they play if it were their move?">
              Threat?
            </button>
            <button className="btn sm ghost icon-btn" onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))} aria-label="Flip board" title="Flip board">
              <FlipIcon />
            </button>
            {mode !== "lessons" && card.t !== "plan" && (
              <button className="btn sm ghost icon-btn" onClick={begin} aria-label="Restart" title="Restart">
                <RestartIcon />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
