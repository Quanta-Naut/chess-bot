import { useState } from "react";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import type { Id } from "../convex/_generated/dataModel";
import { SignIn } from "./components/SignIn";
import { Sidebar, type Page } from "./components/Sidebar";
import { Games } from "./pages/Games";
import { Review } from "./pages/Review";
import { Settings } from "./pages/Settings";

function Shell() {
  const { signOut } = useAuthActions();
  const [page, setPage] = useState<Page>("games");
  const [gameId, setGameId] = useState<Id<"games"> | null>(null);

  const navigate = (p: Page) => {
    setGameId(null);
    setPage(p);
  };

  return (
    <div className="shell">
      <Sidebar page={page} onNavigate={navigate} onSignOut={() => void signOut()} />
      <main className="page">
        {page === "settings" ? (
          <Settings onSaved={() => navigate("games")} />
        ) : gameId ? (
          <Review gameId={gameId} />
        ) : (
          <Games openGame={setGameId} openSettings={() => navigate("settings")} />
        )}
      </main>
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
