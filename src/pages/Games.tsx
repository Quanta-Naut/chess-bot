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

export function Games({ openGame }: { openGame: (id: Id<"games">) => void }) {
  const profile = useQuery(api.profile.get);
  const games = useQuery(api.games.list);
  const importBatch = useMutation(api.games.importBatch);
  const saveProfile = useMutation(api.profile.set);

  const [chesscom, setChesscom] = useState("");
  const [lichess, setLichess] = useState("");
  const [editing, setEditing] = useState(false);
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

  const connect = async () => {
    autoSynced.current = true;
    await saveProfile({ chesscom, lichess });
    setEditing(false);
    await sync(chesscom, lichess);
  };

  return (
    <div className="stack">
      <div className="row page-head">
        <h1>Latest games</h1>
        {hasAccounts && !editing && (
          <>
            <button className="btn sm" disabled={busy} onClick={() => void sync(profile?.chesscom, profile?.lichess)}>
              {busy ? "Refreshing..." : "Refresh"}
            </button>
            <button
              className="btn ghost sm"
              onClick={() => {
                setChesscom(profile?.chesscom ?? "");
                setLichess(profile?.lichess ?? "");
                setEditing(true);
              }}
            >
              Accounts
            </button>
          </>
        )}
      </div>

      {!hasAccounts || editing ? (
        <div className="card stack account-form">
          <p className="muted small" style={{ margin: 0 }}>
            Add your chess.com and/or Lichess username (no password needed).
          </p>
          <div className="row">
            <div style={{ flex: 1, minWidth: 180 }}>
              <label htmlFor="cc">chess.com</label>
              <input id="cc" type="text" value={chesscom} onChange={(e) => setChesscom(e.target.value)} placeholder="username" />
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label htmlFor="li">Lichess</label>
              <input id="li" type="text" value={lichess} onChange={(e) => setLichess(e.target.value)} placeholder="username" />
            </div>
          </div>
          <div className="row">
            <button className="btn grape" disabled={busy || (!chesscom.trim() && !lichess.trim())} onClick={() => void connect()}>
              {busy ? "Fetching..." : "Save & import games"}
            </button>
            {editing && (
              <button className="btn ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : null}

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
