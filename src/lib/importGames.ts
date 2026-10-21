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

/** chess.com's monthly archive URLs from the month of `since` up to this month, oldest first. */
function monthsSince(user: string, since: number): string[] {
  const urls: string[] = [];
  const d = new Date(since);
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth();
  const now = new Date();
  while (y < now.getUTCFullYear() || (y === now.getUTCFullYear() && m <= now.getUTCMonth())) {
    urls.push(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/${y}/${String(m + 1).padStart(2, "0")}`);
    if (++m === 12) {
      m = 0;
      y++;
    }
  }
  return urls;
}

/**
 * Newest games first, at most `max`. With `since` (ms), only games that ended after it,
 * read from just the months since then instead of the whole archive list.
 */
export async function fetchChessCom(username: string, max: number, since?: number): Promise<ImportedGame[]> {
  const user = username.trim().toLowerCase();
  let archives: string[];
  if (since !== undefined) {
    archives = monthsSince(user, since);
  } else {
    const res = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`);
    if (!res.ok) throw new Error(`chess.com says no (${res.status}) - check the username`);
    archives = ((await res.json()) as { archives: string[] }).archives;
  }
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
      if (since !== undefined && g.end_time * 1000 <= since) break; // the rest of the month is older
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

/** Newest games first, at most `max`. With `since` (ms), only games started after it. */
export async function fetchLichess(username: string, max: number, since?: number): Promise<ImportedGame[]> {
  const user = username.trim();
  const res = await fetch(
    `https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=${max}&pgnInJson=true&moves=true&rated=true${since !== undefined ? `&since=${since}` : ""}`,
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

export interface Rating {
  site: "chess.com" | "Lichess";
  kind: string;
  rating: number;
}

/** Your current ratings on each site, rapid first. Missing sites or failed requests are skipped. */
export async function fetchRatings(chesscom?: string, lichess?: string): Promise<Rating[]> {
  const out: Rating[] = [];
  const kinds = ["rapid", "blitz", "bullet"];
  await Promise.all([
    (async () => {
      if (!chesscom) return;
      try {
        const r = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(chesscom.trim().toLowerCase())}/stats`);
        if (!r.ok) return;
        const stats = (await r.json()) as Record<string, { last?: { rating: number } }>;
        for (const k of kinds) {
          const rating = stats[`chess_${k}`]?.last?.rating;
          if (rating) out.push({ site: "chess.com", kind: k, rating });
        }
      } catch {
        // ratings are only a starting point for the bot's strength
      }
    })(),
    (async () => {
      if (!lichess) return;
      try {
        const r = await fetch(`https://lichess.org/api/user/${encodeURIComponent(lichess.trim())}`);
        if (!r.ok) return;
        const { perfs } = (await r.json()) as { perfs?: Record<string, { rating: number; games: number }> };
        for (const k of kinds) {
          const p = perfs?.[k];
          if (p?.games) out.push({ site: "Lichess", kind: k, rating: p.rating });
        }
      } catch {
        // as above
      }
    })(),
  ]);
  return out.sort((a, b) => (a.site === b.site ? kinds.indexOf(a.kind) - kinds.indexOf(b.kind) : a.site === "chess.com" ? -1 : 1));
}
