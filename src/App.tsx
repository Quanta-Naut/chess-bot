import { useEffect, useState } from "react";
import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { SignIn } from "./components/SignIn";
import { BackgroundAnalysis } from "./components/BackgroundAnalysis";
import { Loader } from "./components/Loader";
import { Sidebar, type Page } from "./components/Sidebar";
import { Games } from "./pages/Games";
import { Insights } from "./pages/Insights";
import { Openings } from "./pages/Openings";
import { Play } from "./pages/Play";
import { Puzzles } from "./pages/Puzzles";
import { Review } from "./pages/Review";
import { Settings } from "./pages/Settings";
import { api } from "../convex/_generated/api";
import { boardTheme, isBoardTheme, setBoardTheme } from "./lib/boardTheme";

// The address bar is the source of truth: "/" games, "/<page>" for the other pages, "/g/<code>" one game's review.
const PAGES: Page[] = ["puzzles", "insights", "play", "openings", "settings"];

interface Route {
  page: Page;
  code?: string;
}

function parse(path: string): Route {
  const game = path.match(/^\/g\/([a-z0-9]+)\/?$/);
  if (game) return { page: "games", code: game[1] };
  const page = PAGES.find((p) => path === `/${p}` || path.startsWith(`/${p}/`));
  return { page: page ?? "games" };
}

/** Keep the board colour the same on every device: the account's colour wins over this browser's copy. */
function useAccountBoardTheme() {
  const profile = useQuery(api.profile.get);
  const save = useMutation(api.profile.setBoardTheme);
  const saved = profile?.boardTheme;
  useEffect(() => {
    if (!profile) return;
    if (isBoardTheme(saved)) {
      if (saved !== boardTheme()) setBoardTheme(saved);
    } else {
      // first time on an account: keep the colour this device already uses
      void save({ theme: boardTheme() });
    }
  }, [profile, saved, save]);
}

function Shell() {
  const { signOut } = useAuthActions();
  useAccountBoardTheme();
  const [route, setRoute] = useState(() => parse(window.location.pathname));
  const { page, code } = route;

  // browser back/forward
  useEffect(() => {
    const onPop = () => setRoute(parse(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = (path: string) => {
    if (path !== window.location.pathname + window.location.search) window.history.pushState(null, "", path);
    setRoute(parse(path.split("?")[0]));
  };
  const navigate = (p: Page) => go(p === "games" ? "/" : `/${p}`);
  const openGame = (c: string) => go(`/g/${c}`);

  return (
    <div className="shell">
      <Sidebar page={page} onNavigate={navigate} />
      <BackgroundAnalysis paused={!!code} />
      <main className="page">
        {code ? (
          <Review key={code} code={code} />
        ) : page === "settings" ? (
          <Settings onSaved={() => navigate("games")} onSignOut={() => void signOut()} />
        ) : page === "puzzles" ? (
          <Puzzles key={window.location.search} openGame={openGame} />
        ) : page === "insights" ? (
          <Insights openPuzzles={(kind) => go(`/puzzles${kind ? `?kind=${kind}` : ""}`)} openGame={openGame} />
        ) : page === "openings" ? (
          <Openings />
        ) : page === "play" ? (
          <Play openGame={openGame} />
        ) : (
          <Games openGame={openGame} openSettings={() => navigate("settings")} />
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <>
      <AuthLoading>
        <Loader full label="Opening Pawnie" />
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
