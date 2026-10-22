import { useEffect, useRef, type ReactNode } from "react";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import { Badge } from "./Badge";
import type { Label } from "../lib/review";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.cburnett.css";

interface Props {
  fen: string;
  orientation: "white" | "black";
  lastMove?: [Key, Key];
  shapes?: DrawShape[];
  /** quality badge shown in the top-right corner of a square */
  badge?: { square: Key; label: Label };
  turnColor: "white" | "black";
  check: boolean;
  dests: Map<Key, Key[]>;
  onMove: (orig: Key, dest: Key) => void;
  children?: ReactNode;
}

export function Board({ fen, orientation, lastMove, shapes = [], badge, turnColor, check, dests, onMove, children }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMoveRef = useRef(onMove);
  const prevFen = useRef(fen);

  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  useEffect(() => {
    if (!host.current) return;
    api.current = Chessground(host.current, {
      animation: { duration: 180 },
      coordinates: false, // drawn by us below, in the corners of the edge squares
      premovable: { enabled: false },
      movable: { free: false, showDests: true, events: { after: (orig, dest) => onMoveRef.current(orig, dest) } },
      drawable: { enabled: true, visible: true },
    });
    // chessground remembers where the board is on screen; re-measure on every touch, since an animation,
    // a sheet or a layout change can move the board after that first measurement (clicks then land a square off)
    const el = host.current;
    const remeasure = () => api.current?.state.dom.bounds.clear();
    el.addEventListener("pointerdown", remeasure, { capture: true });
    el.addEventListener("touchstart", remeasure, { capture: true, passive: true });
    el.addEventListener("mousedown", remeasure, { capture: true });
    const resize = new ResizeObserver(() => api.current?.redrawAll());
    resize.observe(el);
    return () => {
      el.removeEventListener("pointerdown", remeasure, { capture: true });
      el.removeEventListener("touchstart", remeasure, { capture: true });
      el.removeEventListener("mousedown", remeasure, { capture: true });
      resize.disconnect();
      api.current?.destroy();
    };
  }, []);

  useEffect(() => {
    const cg = api.current;
    if (!cg) return;
    if (fen !== prevFen.current) {
      cg.setShapes([]);
      prevFen.current = fen;
    }
    cg.set({
      fen,
      orientation,
      turnColor,
      check,
      lastMove,
      movable: { color: turnColor, dests },
      drawable: { autoShapes: shapes },
    });
    // chessground skips arrows while a piece animates; draw them now so they land with the move
    cg.state.dom.redrawNow();
  }, [fen, orientation, lastMove, shapes, turnColor, check, dests]);

  return (
    <div className="board-wrap">
      <div className="board-host" ref={host} />
      <Coords orientation={orientation} />
      {badge && (
        <div
          className="sq-badge"
          style={{
            left: `${(orientation === "white" ? badge.square.charCodeAt(0) - 97 : 104 - badge.square.charCodeAt(0)) * 12.5}%`,
            top: `${(orientation === "white" ? 8 - Number(badge.square[1]) : Number(badge.square[1]) - 1) * 12.5}%`,
          }}
        >
          <Badge label={badge.label} />
        </div>
      )}
      {children}
    </div>
  );
}

const FILES = "abcdefgh";

/** Rank numbers in the top-left corner of the left-hand squares, file letters in the bottom-right of the bottom row. */
function Coords({ orientation }: { orientation: "white" | "black" }) {
  const white = orientation === "white";
  return (
    <div className="coords-layer" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => {
        const rank = white ? 8 - i : i + 1; // row i from the top
        const file = white ? FILES[i] : FILES[7 - i]; // column i from the left
        // a1 is dark: a square is light when file index + rank is even
        const rankLight = ((white ? 0 : 7) + rank) % 2 === 0;
        const fileLight = (FILES.indexOf(file) + (white ? 1 : 8)) % 2 === 0;
        return [
          <span key={`r${i}`} className={`coord rank ${rankLight ? "on-light" : "on-dark"}`} style={{ top: `${i * 12.5}%` }}>
            {rank}
          </span>,
          <span key={`f${i}`} className={`coord file ${fileLight ? "on-light" : "on-dark"}`} style={{ left: `${i * 12.5}%` }}>
            {file}
          </span>,
        ];
      })}
    </div>
  );
}
