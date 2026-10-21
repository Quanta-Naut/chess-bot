import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { fetchChessCom, fetchLichess, type ImportedGame } from "../lib/importGames";
import { MiniBoard } from "../components/MiniBoard";

const MAX_GAMES = 30;
const GRID_SIZE = 24;

const resultFor = (result: string, color: "white" | "black") =>
  result === "1/2-1/2" ? "draw" : (result === "1-0") === (color === "white") ? "win" : "loss";

export function Games({ openGame, openSettings }: { openGame: (id: Id<"games">) => void; openSettings: () => void }) {
  const profile = useQuery(api.profile.get);
  const games = useQuery(api.games.list);
  const importBatch = useMutation(api.games.importBatch);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoSynced = useRef(false);

  const hasAccounts = Boolean(profile?.chesscom || profile?.lichess);

  const sync = useCallback(
    async (cc?: string, li?: string) => {
      if (!cc && !li) return;
      setBusy(true);
      setError(null);
      try {
        let all: ImportedGame[] = [];
        if (cc) all = all.concat(await fetchChessCom(cc, MAX_GAMES));
        if (li) all = all.concat(await fetchLichess(li, MAX_GAMES));
        for (let i = 0; i < all.length; i += 50) {
          await importBatch({ games: all.slice(i, i + 50) });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't fetch your games");
      } finally {
        setBusy(false);
      }
    },
    [importBatch],
  );

  // keep the latest games fresh every time the page opens
  useEffect(() => {
    if (autoSynced.current || !profile) return;
    if (!profile.chesscom && !profile.lichess) return;
    autoSynced.current = true;
    void sync(profile.chesscom, profile.lichess);
  }, [profile, sync]);

  return (
    <div className="stack">
      <div className="row page-head">
        <h1>Latest games</h1>
        {hasAccounts && (
          <button className="btn sm" disabled={busy} onClick={() => void sync(profile?.chesscom, profile?.lichess)}>
            {busy ? "Refreshing..." : "Refresh"}
          </button>
        )}
      </div>

      {profile && !hasAccounts && (
        <div className="card row">
          <span className="grow">Add your chess.com or Lichess username to bring in your games.</span>
          <button className="btn grape sm" onClick={openSettings}>
            Open settings
          </button>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {games === undefined ? (
        <p className="muted">Loading...</p>
      ) : games.length === 0 ? (
        <p className="muted">{busy ? "Fetching your games..." : "No games yet."}</p>
      ) : (
        <div className="games-grid">
          {games.slice(0, GRID_SIZE).map((g) => {
            const r = resultFor(g.result, g.myColor);
            const opp = g.myColor === "white" ? g.black : g.white;
            return (
              <button key={g._id} className="game-card" onClick={() => openGame(g._id)}>
                {g.finalFen ? (
                  <MiniBoard fen={g.finalFen} orientation={g.myColor} />
                ) : (
                  <div className="mini-board mini-board-empty" />
                )}
                <span className="gc-meta">
                  <span className={`result ${r}`}>{r === "win" ? "Win" : r === "loss" ? "Loss" : "Draw"}</span>
                  <span className="gc-opp">{opp}</span>
                  <span className="gc-acc">{g.accuracy !== undefined ? `${g.accuracy}%` : "–"}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
