import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { canVibrate, hapticsEnabled, playMove, setHapticsEnabled, setSoundEnabled, soundEnabled } from "../lib/sound";
import { BOARD_THEMES, boardTheme, isBoardTheme, setBoardTheme } from "../lib/boardTheme";
import { Loader } from "../components/Loader";
import { MiniBoard } from "../components/MiniBoard";

// an Italian Game middlegame, to see the colour with pieces on it
const PREVIEW_FEN = "r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2PP1N2/PP3PPP/RNBQ1RK1 w - - 0 7";

export function Settings({ onSaved, onSignOut }: { onSaved: () => void; onSignOut: () => void }) {
  const profile = useQuery(api.profile.get);
  if (profile === undefined) return <Loader label="Loading settings" />;
  if (profile === null) return null;
  return <SettingsForm key={profile.email ?? ""} profile={profile} onSaved={onSaved} onSignOut={onSignOut} />;
}

function SettingsForm({
  profile,
  onSaved,
  onSignOut,
}: {
  profile: { chesscom?: string; lichess?: string; boardTheme?: string; email?: string };
  onSaved: () => void;
  onSignOut: () => void;
}) {
  const saveProfile = useMutation(api.profile.set);
  const [chesscom, setChesscom] = useState(profile.chesscom ?? "");
  const [lichess, setLichess] = useState(profile.lichess ?? "");
  const [busy, setBusy] = useState(false);
  const [sound, setSound] = useState(soundEnabled);
  const [haptics, setHaptics] = useState(hapticsEnabled);
  const saveTheme = useMutation(api.profile.setBoardTheme);
  const [theme, setTheme] = useState(() => (isBoardTheme(profile.boardTheme) ? profile.boardTheme : boardTheme()));
  // your colour leads the list; the order is fixed while the page is open, so nothing jumps under your finger
  const [themeOrder] = useState(() => [...BOARD_THEMES].sort((a, b) => Number(b.id === theme) - Number(a.id === theme)));
  const changed = chesscom.trim() !== (profile.chesscom ?? "") || lichess.trim() !== (profile.lichess ?? "");

  const save = async () => {
    setBusy(true);
    try {
      await saveProfile({ chesscom, lichess });
      // the games page imports from the new accounts as soon as it opens
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings">
      <h1>Settings</h1>

      <section className="card stack-tight">
        <h2>Chess accounts</h2>
        <p className="muted small desk-only">Your chess.com and/or Lichess username. No password needed: games are read from their public APIs.</p>
        <div className="settings-fields">
          <div>
            <label htmlFor="cc">chess.com</label>
            <input id="cc" type="text" value={chesscom} onChange={(e) => setChesscom(e.target.value)} placeholder="username" />
          </div>
          <div>
            <label htmlFor="li">Lichess</label>
            <input id="li" type="text" value={lichess} onChange={(e) => setLichess(e.target.value)} placeholder="username" />
          </div>
        </div>
        <div className="row">
          <button className="btn grape" disabled={busy || !changed || (!chesscom.trim() && !lichess.trim())} onClick={() => void save()}>
            {busy ? "Saving..." : "Save & import games"}
          </button>
        </div>
      </section>

      <section className="card row">
        <div className="grow">
          <h2>Move sounds</h2>
          <p className="muted small desk-only">Play a sound when pieces move on the board.</p>
        </div>
        <button
          className={`btn sm ${sound ? "grape" : "ghost"}`}
          aria-pressed={sound}
          onClick={() => {
            setSoundEnabled(!sound);
            setSound(!sound);
            if (!sound) playMove("move");
          }}
        >
          {sound ? "On" : "Off"}
        </button>
      </section>

      {canVibrate() && (
        <section className="card row">
          <div className="grow">
            <h2>Vibration</h2>
            <p className="muted small desk-only">A short buzz when a piece moves.</p>
          </div>
          <button
            className={`btn sm ${haptics ? "grape" : "ghost"}`}
            aria-pressed={haptics}
            onClick={() => {
              setHapticsEnabled(!haptics);
              setHaptics(!haptics);
              if (!haptics) navigator.vibrate(22);
            }}
          >
            {haptics ? "On" : "Off"}
          </button>
        </section>
      )}

      <section className="card stack-tight">
        <h2>Board colour</h2>
        <div className="theme-row">
          {themeOrder.map((t) => (
            <button
              key={t.id}
              className={`theme-card ${theme === t.id ? "on" : ""}`}
              onClick={() => {
                setBoardTheme(t.id);
                setTheme(t.id);
                void saveTheme({ theme: t.id });
              }}
              aria-pressed={theme === t.id}
              style={{ ["--sq-dark" as string]: t.dark }}
            >
              <MiniBoard fen={PREVIEW_FEN} orientation="white" />
              <span className="theme-name">
                {t.name}
                {theme === t.id && <span aria-hidden> ✓</span>}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="card row">
        <div className="grow">
          <h2>Signed in</h2>
          {profile.email && <p className="muted small">{profile.email}</p>}
        </div>
        <button className="btn sm coral" onClick={onSignOut}>
          Sign out
        </button>
      </section>
    </div>
  );
}
