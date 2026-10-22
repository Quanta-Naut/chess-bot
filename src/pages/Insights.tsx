import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { useAnalysisProgress } from "../lib/analysisProgress";
import { KIND_TEXT, type MistakeKind } from "../lib/explain";
import { loadOpenings, nameOpening } from "../lib/openings";
import { Loader } from "../components/Loader";

type Game = FunctionReturnType<typeof api.games.insights>[number];

// how much each kind of error costs, to rank what to fix first
const WEIGHT: Record<string, number> = { blunder: 3, miss: 2, mistake: 2, inaccuracy: 0.5 };

const TIP: Record<MistakeKind, string> = {
  hanging: "Before every move, ask: what does this move leave undefended? Check every piece your opponent could take next.",
  fork: "Watch for knight jumps and pawn pushes that hit two of your pieces at once, and don't leave your king, queen and rooks where one piece can attack two of them.",
  "allowed-mate": "When your king is short of defenders, look at every check your opponent has before you move.",
  "missed-mate": "Look at your checks first, every move: checks, then captures, then threats.",
  "missed-win": "After each of your opponent's moves, ask what it left undefended. Taking free material is often the best move.",
  "lost-material": "Before trading on a square, count its attackers and defenders.",
  "threw-win": "When you're winning, slow down: trade pieces rather than pawns, and check for stalemate before every move.",
  positional: "Slow mistakes: pieces drifting to poor squares, or pawn moves that loosen your king. When in doubt, improve your worst piece.",
};

const PHASES = ["opening", "middlegame", "endgame"] as const;
const PHASE_NAME = { opening: "Opening", middlegame: "Middlegame", endgame: "Endgame" };

type Tab = "overview" | "mistakes" | "phases" | "openings";
const TABS: [Tab, string][] = [
  ["overview", "Overview"],
  ["mistakes", "Mistakes"],
  ["phases", "Phases"],
  ["openings", "Openings"],
];

const resultFor = (g: Game) => (g.result === "1/2-1/2" ? "draw" : (g.result === "1-0") === (g.myColor === "white") ? "win" : "loss");
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const per = (n: number, games: number) => (games ? (n / games).toFixed(1) : "0");

interface Props {
  openPuzzles: (kind?: string) => void;
  openGame: (code: string) => void;
}

export function Insights(props: Props) {
  const games = useQuery(api.games.insights);
  if (games === undefined) return <Loader label="Crunching your games" />;
  return <Report games={games} {...props} />;
}

function Report({ games, openPuzzles, openGame }: Props & { games: Game[] }) {
  const progress = useAnalysisProgress();
  const [tab, setTab] = useState<Tab>("overview");
  const [openings, setOpenings] = useState<Awaited<ReturnType<typeof loadOpenings>> | null>(null);

  useEffect(() => {
    void loadOpenings().then(setOpenings);
  }, []);

  const report = useMemo(() => {
    if (!games.length) return null;
    const n = games.length;
    const all = games.flatMap((g) => g.mistakes.map((m) => ({ ...m, game: g })));
    const serious = all.filter((m) => m.label !== "inaccuracy");

    // what to fix first: kinds of error ranked by how often and how badly they cost you
    const kinds = new Map<string, { score: number; count: number; games: Set<string>; worst?: Game }>();
    for (const m of all) {
      const k = kinds.get(m.kind) ?? { score: 0, count: 0, games: new Set<string>() };
      k.score += WEIGHT[m.label] ?? 1;
      if (m.label !== "inaccuracy") k.count++;
      k.games.add(m.game.code ?? String(m.game.playedAt));
      if (m.label === "blunder" && !k.worst) k.worst = m.game;
      kinds.set(m.kind, k);
    }
    const leaks = [...kinds.entries()]
      .filter(([, k]) => k.count > 0)
      .sort((a, b) => b[1].score - a[1].score)
      .map(([kind, k]) => ({ kind: kind as MistakeKind, count: k.count, games: k.games.size, worst: k.worst }));

    const phase = PHASES.map((p) => ({ phase: p, count: serious.filter((m) => m.phase === p).length }));

    const side = (["white", "black"] as const).map((c) => {
      const gs = games.filter((g) => g.myColor === c);
      return {
        color: c,
        games: gs.length,
        wins: gs.filter((g) => resultFor(g) === "win").length,
        accuracy: avg(gs.map((g) => g.accuracy)),
        blunders: gs.reduce((a, g) => a + (g.summary.blunder ?? 0), 0),
      };
    });

    // games come newest first; the trend reads left (old) to right (new)
    const trend = [...games].reverse().map((g) => ({ accuracy: g.accuracy, playedAt: g.playedAt, opponent: g.opponent, result: resultFor(g) }));
    const recent = avg(games.slice(0, 10).map((g) => g.accuracy));
    const earlier = games.length > 10 ? avg(games.slice(10, 20).map((g) => g.accuracy)) : null;

    const count = (label: string) => games.reduce((a, g) => a + (g.summary[label] ?? 0), 0);

    return {
      n,
      accuracy: avg(games.map((g) => g.accuracy)),
      recent,
      earlier,
      blunders: count("blunder"),
      misses: count("miss"),
      mistakes: count("mistake"),
      wins: games.filter((g) => resultFor(g) === "win").length,
      leaks,
      phase,
      side,
      trend,
    };
  }, [games]);

  const openingRows = useMemo(() => {
    if (!openings) return [];
    const rows = new Map<string, { name: string; color: "white" | "black"; games: Game[] }>();
    for (const g of games) {
      const o = nameOpening(openings, g.opening);
      if (!o) continue;
      const key = `${g.myColor}|${o.family}`;
      const row = rows.get(key) ?? { name: o.family, color: g.myColor, games: [] };
      row.games.push(g);
      rows.set(key, row);
    }
    return [...rows.values()]
      .sort((a, b) => b.games.length - a.games.length)
      .slice(0, 8)
      .map((r) => ({
        ...r,
        wins: r.games.filter((g) => resultFor(g) === "win").length,
        losses: r.games.filter((g) => resultFor(g) === "loss").length,
        accuracy: avg(r.games.map((g) => g.accuracy)),
        early: r.games.reduce((a, g) => a + g.mistakes.filter((m) => m.phase === "opening" && m.label !== "inaccuracy").length, 0),
      }));
  }, [games, openings]);

  const analysing = progress.left > 0 && (
    <span className="muted small">
      Analysing {progress.left} more game{progress.left === 1 ? "" : "s"}… the report fills in as they finish.
    </span>
  );

  if (!report) {
    return (
      <div className="insights">
        <h1>Insights</h1>
        <div className="card stack-tight" style={{ maxWidth: 560 }}>
          <h2>Nothing to report yet</h2>
          <p className="muted">Once your games are analysed, this page shows the mistakes you keep making and what to work on.</p>
          {analysing}
        </div>
      </div>
    );
  }

  const top = report.leaks.slice(0, 3);
  const phaseMax = Math.max(1, ...report.phase.map((p) => p.count));
  const delta = report.earlier === null ? null : report.recent - report.earlier;

  return (
    <div className="insights" data-tab={tab}>
      <div className="row page-head">
        <h1>Insights</h1>
        <span className="muted small grow desk-only">From your last {report.n} analysed games.</span>
        {analysing}
      </div>

      {/* phones: one screen per tab instead of one long page */}
      <div className="tabs m-only" role="tablist">
        {TABS.map(([id, name]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? "on" : ""}`} onClick={() => setTab(id)}>
            {name}
          </button>
        ))}
      </div>

      <div className="stat-row t-overview">
        <Stat label="Accuracy" value={`${report.accuracy.toFixed(1)}%`} note={delta === null ? "average" : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(1)} over your last 10`} good={delta === null ? undefined : delta >= 0} />
        <Stat label="Blunders per game" value={per(report.blunders, report.n)} note={`${report.blunders} in total`} />
        <Stat label="Misses per game" value={per(report.misses, report.n)} note="chances you didn't punish" />
        <Stat label="Mistakes per game" value={per(report.mistakes, report.n)} note={`${report.mistakes} in total`} />
        <Stat label="Score" value={`${Math.round((report.wins / report.n) * 100)}%`} note={`${report.wins} wins of ${report.n}`} />
      </div>

      <section className="stack-tight t-mistakes">
        <h2>Fix these first</h2>
        <div className="leak-grid">
          {top.map((l, i) => (
            <div key={l.kind} className="card flat leak">
              <div className="leak-head">
                <span className="leak-rank">{i + 1}</span>
                <b className="grow">{KIND_TEXT[l.kind]}</b>
                <span className="chip">
                  {l.count}× in {l.games} game{l.games === 1 ? "" : "s"}
                </span>
              </div>
              <p className="small">{TIP[l.kind]}</p>
              <div className="row">
                <button className="btn sm grape" onClick={() => openPuzzles(l.kind)}>
                  Practise these
                </button>
                {l.worst?.code && (
                  <button className="btn sm ghost" onClick={() => openGame(l.worst!.code!)}>
                    See an example
                  </button>
                )}
              </div>
            </div>
          ))}
          {top.length === 0 && <p className="muted">No mistakes or blunders found yet. Nice.</p>}
        </div>
      </section>

      <div className="insight-cols">
        <section className="card flat stack-tight t-phases">
          <h2>When it goes wrong</h2>
          <p className="muted small">Mistakes, misses and blunders by phase of the game.</p>
          {report.phase.map((p) => (
            <div key={p.phase} className="bar-row">
              <span className="bar-label">{PHASE_NAME[p.phase]}</span>
              <div className="bar">
                <div style={{ width: `${(p.count / phaseMax) * 100}%` }} />
              </div>
              <b className="bar-value">{p.count}</b>
            </div>
          ))}
        </section>

        <section className="card flat stack-tight t-phases">
          <h2>White vs Black</h2>
          <div className="side-split">
            {report.side.map((s) => (
              <div key={s.color} className="side-box">
                <div className="row-tight">
                  <span className="pavatar" style={{ background: s.color === "white" ? "#fff" : "#2b2350" }} />
                  <b>{s.color === "white" ? "As White" : "As Black"}</b>
                </div>
                <div className="side-stat">{s.games ? `${s.accuracy.toFixed(1)}%` : "-"}</div>
                <div className="muted small">
                  {s.wins}/{s.games} won · {per(s.blunders, s.games)} blunders a game
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card flat stack-tight t-overview">
          <h2>Accuracy over time</h2>
          <Trend points={report.trend} />
        </section>
      </div>

      {openingRows.length > 0 ? (
        <section className="card flat stack-tight t-openings">
          <h2>Your openings</h2>
          <div className="open-table">
            <span className="muted small">Opening</span>
            <span className="muted small">Games</span>
            <span className="muted small">W / L</span>
            <span className="muted small">Accuracy</span>
            <span className="muted small col-early">Early mistakes</span>
            {openingRows.map((r) => (
              <OpeningRow key={`${r.color}|${r.name}`} {...r} />
            ))}
          </div>
        </section>
      ) : (
        <p className="muted t-openings m-only">No openings to show yet.</p>
      )}
    </div>
  );
}

function OpeningRow(r: { name: string; color: "white" | "black"; games: Game[]; wins: number; losses: number; accuracy: number; early: number }) {
  return (
    <>
      <span className="row-tight open-name" title={r.name}>
        <span className="pavatar" style={{ background: r.color === "white" ? "#fff" : "#2b2350" }} />
        <span>{r.name}</span>
      </span>
      <b>{r.games.length}</b>
      <span>
        <b className="win">{r.wins}</b> / <b className="loss">{r.losses}</b>
      </span>
      <b>{r.accuracy.toFixed(1)}%</b>
      <b className={`col-early ${r.early ? "loss" : ""}`}>{r.early}</b>
    </>
  );
}

function Stat({ label, value, note, good }: { label: string; value: string; note: string; good?: boolean }) {
  return (
    <div className="card flat stat">
      <span className="muted small">{label}</span>
      <b className="stat-value">{value}</b>
      <span className={`small ${good === undefined ? "muted" : good ? "win" : "loss"}`}>{note}</span>
    </div>
  );
}

interface TrendPoint {
  accuracy: number;
  playedAt: number;
  opponent: string;
  result: string;
}

const PAD = { top: 10, right: 12, bottom: 22, left: 34 };
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** Accuracy per game (dots) with a 5-game rolling average (line); hover or drag to read any game. */
function Trend({ points }: { points: TrendPoint[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const values = points.map((p) => p.accuracy);
  // a 5-game rolling average shows the direction better than single games
  const rolling = useMemo(() => values.map((_, i) => avg(values.slice(Math.max(0, i - 4), i + 1))), [values]);

  if (points.length < 2) return <p className="muted small">Needs a few more games.</p>;

  const lo = Math.max(0, Math.floor((Math.min(...values) - 2) / 10) * 10);
  const hi = Math.min(100, Math.ceil((Math.max(...values) + 2) / 10) * 10);
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += hi - lo > 40 ? 20 : 10) ticks.push(t);
  const iw = Math.max(0, size.w - PAD.left - PAD.right);
  const ih = Math.max(0, size.h - PAD.top - PAD.bottom);
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * iw;
  const y = (v: number) => PAD.top + ih - ((v - lo) / (hi - lo || 1)) * ih;
  const line = rolling.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = `${line}L${x(points.length - 1).toFixed(1)},${PAD.top + ih}L${PAD.left},${PAD.top + ih}Z`;
  // about four dates along the bottom
  const step = Math.max(1, Math.round((points.length - 1) / 3));
  const dateTicks = [...new Set([...Array.from({ length: Math.floor((points.length - 1) / step) + 1 }, (_, k) => k * step), points.length - 1])].filter(
    (i, k, all) => k === 0 || i - all[k - 1] >= step * 0.6,
  );

  const pick = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    const i = Math.round(((clientX - r.left - PAD.left) / (iw || 1)) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };
  const h = hover === null ? null : points[hover];
  const tipLeft = hover === null ? 0 : Math.min(Math.max(x(hover), 70), size.w - 70);

  return (
    <div
      className="trend"
      ref={box}
      onPointerMove={(e) => pick(e.clientX)}
      onPointerDown={(e) => pick(e.clientX)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
      role="img"
      aria-label={`Accuracy over your last ${points.length} games, from ${values[0].toFixed(0)}% to ${values[values.length - 1].toFixed(0)}%`}
    >
      {size.w > 0 && (
        <svg width={size.w} height={size.h}>
          <defs>
            <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--grape)" stopOpacity=".22" />
              <stop offset="1" stopColor="var(--grape)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={size.w - PAD.right} y1={y(t)} y2={y(t)} className="trend-grid" />
              <text x={PAD.left - 6} y={y(t)} className="trend-axis" textAnchor="end" dominantBaseline="middle">
                {t}%
              </text>
            </g>
          ))}
          {dateTicks.map((i, k) => (
            <text key={i} x={x(i)} y={size.h - 6} className="trend-axis" textAnchor={k === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>
              {day(points[i].playedAt)}
            </text>
          ))}
          <path d={area} fill="url(#trend-fill)" />
          {values.map((v, i) => (
            <circle key={i} cx={x(i)} cy={y(v)} r={2.5} className="trend-dot" />
          ))}
          <path d={line} className="trend-line" />
          {h && hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ih} className="trend-cross" />
              <circle cx={x(hover)} cy={y(h.accuracy)} r={5} className="trend-hit" />
              <circle cx={x(hover)} cy={y(rolling[hover])} r={4} className="trend-hit-avg" />
            </g>
          )}
        </svg>
      )}
      {h && hover !== null && (
        <div className="trend-tip" style={{ left: tipLeft }}>
          <span className="muted">
            {day(h.playedAt)} · vs {h.opponent}
          </span>
          <span>
            <b>{h.accuracy.toFixed(1)}%</b> accuracy <span className={`trend-res ${h.result}`}>{h.result === "win" ? "Won" : h.result === "loss" ? "Lost" : "Draw"}</span>
          </span>
          <span className="muted">5-game average {rolling[hover].toFixed(1)}%</span>
        </div>
      )}
    </div>
  );
}
