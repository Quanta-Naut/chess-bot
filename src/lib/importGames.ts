export interface ImportedGame {
  source: "chesscom" | "lichess";
  externalId: string;
  pgn: string;
  white: string;
  black: string;
  myColor: "white" | "black";
  result: string;
  playedAt: number;
  timeClass?: string;
}

function header(pgn: string, tag: string): string | undefined {
  return pgn.match(new RegExp(`\\[${tag} "([^"]*)"\\]`))?.[1];
}

export async function fetchChessCom(username: string, max: number): Promise<ImportedGame[]> {
  const user = username.trim().toLowerCase();
  const res = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`);
  if (!res.ok) throw new Error(`chess.com says no (${res.status}) - check the username`);
  const { archives } = (await res.json()) as { archives: string[] };
  const out: ImportedGame[] = [];
  for (const url of [...archives].reverse()) {
    if (out.length >= max) break;
    const r = await fetch(url);
    if (!r.ok) continue;
    const { games } = (await r.json()) as {
      games: {
        pgn?: string;
        uuid?: string;
        url: string;
        end_time: number;
        time_class: string;
        rules: string;
        white: { username: string };
        black: { username: string };
      }[];
    };
    for (const g of [...games].reverse()) {
      if (out.length >= max) break;
      if (!g.pgn || g.rules !== "chess") continue;
      const white = g.white.username;
      const black = g.black.username;
      out.push({
        source: "chesscom",
        externalId: g.uuid ?? g.url,
        pgn: g.pgn,
        white,
        black,
        myColor: white.toLowerCase() === user ? "white" : "black",
        result: header(g.pgn, "Result") ?? "*",
        playedAt: g.end_time * 1000,
        timeClass: g.time_class,
      });
    }
  }
  return out;
}

export async function fetchLichess(username: string, max: number): Promise<ImportedGame[]> {
  const user = username.trim();
  const res = await fetch(
    `https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=${max}&pgnInJson=true&moves=true&rated=true`,
    { headers: { Accept: "application/x-ndjson" } },
  );
  if (!res.ok) throw new Error(`Lichess says no (${res.status}) - check the username`);
  const text = await res.text();
  const out: ImportedGame[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const g = JSON.parse(line) as {
      id: string;
      variant: string;
      speed: string;
      createdAt: number;
      lastMoveAt?: number;
      winner?: "white" | "black";
      pgn?: string;
      players: { white: { user?: { name: string } }; black: { user?: { name: string } } };
    };
    if (g.variant !== "standard" || !g.pgn) continue;
    const white = g.players.white.user?.name ?? "Anonymous";
    const black = g.players.black.user?.name ?? "Anonymous";
    out.push({
      source: "lichess",
      externalId: g.id,
      pgn: g.pgn,
      white,
      black,
      myColor: white.toLowerCase() === user.toLowerCase() ? "white" : "black",
      result: g.winner === "white" ? "1-0" : g.winner === "black" ? "0-1" : "1/2-1/2",
      playedAt: g.lastMoveAt ?? g.createdAt,
      timeClass: g.speed,
    });
  }
  return out;
}
