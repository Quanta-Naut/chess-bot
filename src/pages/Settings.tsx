import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { playMove, setSoundEnabled, soundEnabled } from "../lib/sound";
import { Loader } from "../components/Loader";

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
  profile: { chesscom?: string; lichess?: string; email?: string };
  onSaved: () => void;
  onSignOut: () => void;
}) {
  const saveProfile = useMutation(api.profile.set);
  const [chesscom, setChesscom] = useState(profile.chesscom ?? "");
  const [lichess, setLichess] = useState(profile.lichess ?? "");
  const [busy, setBusy] = useState(false);
  const [sound, setSound] = useState(soundEnabled);
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
