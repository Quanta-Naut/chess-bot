import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { setProgress } from "../lib/analysisProgress";
import { ANALYSIS_VERSION, REVIEW_DEPTH, reviewGame } from "../lib/review";

/**
 * Analyses every game that has no analysis yet (or one from older grading rules), one at a time,
 * so puzzles and insights cover all games. Paused while a game review is open, which needs the engine.
 */
export function BackgroundAnalysis({ paused }: { paused: boolean }) {
  const pending = useQuery(api.games.pendingAnalysis, { version: ANALYSIS_VERSION });
  const save = useMutation(api.games.saveAnalysis);
  const busy = useRef(false);
  // games that couldn't be analysed: skipped, not retried forever
  const [failed, setFailed] = useState<string[]>([]);

  const todo = pending?.filter((g) => !failed.includes(g._id));
  const next = todo?.[0];
  const left = todo?.length ?? 0;

  useEffect(() => {
    if (!busy.current) setProgress({ left, running: false });
  }, [left]);

  useEffect(() => {
    if (paused || !next || busy.current) return;
    busy.current = true;
    setProgress({ left, running: true });
    void (async () => {
      try {
        const { analysis, puzzles } = await reviewGame(next.pgn, next.myColor, REVIEW_DEPTH);
        await save({ id: next._id, analysis, puzzles });
      } catch {
        setFailed((f) => [...f, next._id]);
      } finally {
        busy.current = false;
        setProgress({ left: left - 1, running: false });
      }
    })();
  }, [paused, next, left, save]);

  return null;
}
