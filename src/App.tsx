import { useState } from "react";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import type { Id } from "../convex/_generated/dataModel";
import { SignIn } from "./components/SignIn";
import { Games } from "./pages/Games";
import { Review } from "./pages/Review";

function Shell() {
  const { signOut } = useAuthActions();
  const [gameId, setGameId] = useState<Id<"games"> | null>(null);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">Pawnie</div>
        {gameId && (
          <button className="btn ghost sm" onClick={() => setGameId(null)}>
            ← My games
          </button>
        )}
        <button className="btn ghost sm" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      <main className="page">{gameId ? <Review gameId={gameId} /> : <Games openGame={setGameId} />}</main>
    </div>
  );
}

export default function App() {
  return (
    <>
      <AuthLoading>
        <div className="center muted">Loading...</div>
      </AuthLoading>
      <Unauthenticated>
        <SignIn />
      </Unauthenticated>
      <Authenticated>
        <Shell />
      </Authenticated>
    </>
  );
}
