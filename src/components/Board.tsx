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
      coordinates: true,
      premovable: { enabled: false },
      movable: { free: false, showDests: true, events: { after: (orig, dest) => onMoveRef.current(orig, dest) } },
      drawable: { enabled: true, visible: true },
    });
    return () => api.current?.destroy();
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
