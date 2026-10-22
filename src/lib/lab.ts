import { Chess, type Move, type Square } from "chess.js";

// Opening Lab content: popular openings as one main line each, with the idea behind every move.
// Every move carries a principle (the "why" in one word) so the trainer can ask you to explain a move
// and give hints that point at the idea before they point at the piece.

export type Principle = "centre" | "develop" | "king" | "attack" | "defend" | "space" | "prevent" | "prepare" | "trade";

export const PRINCIPLES: Record<Principle, { name: string; ask: string }> = {
  centre: { name: "Centre", ask: "Claim the centre with a pawn" },
  develop: { name: "Develop", ask: "Bring a new piece into play" },
  king: { name: "King safety", ask: "Get the king safe" },
  attack: { name: "Attack", ask: "Attack something of theirs" },
  defend: { name: "Defend", ask: "Defend something that's attacked" },
  space: { name: "Space", ask: "Gain space and cramp their pieces" },
  prevent: { name: "Prevention", ask: "Stop their next idea" },
  prepare: { name: "Preparation", ask: "Prepare a move for later" },
  trade: { name: "Trade", ask: "Trade pieces or win back a pawn" },
};

export interface LabPly {
  san: string;
  principle: Principle;
  /** what the move does, in a sentence a 1300 player would say out loud */
  idea: string;
}

export interface LabOpening {
  id: string;
  name: string;
  /** part of the Lichess opening name, to find this opening in your games */
  family: string;
  blurb: string;
  /** the plan in one line, shown before you start */
  plan: { white: string; black: string };
  line: LabPly[];
}

const p = (san: string, principle: Principle, idea: string): LabPly => ({ san, principle, idea });

export const LAB: LabOpening[] = [
  {
    id: "italian",
    name: "Italian Game",
    family: "Italian Game",
    blurb: "Quick development, a bishop aimed at f7, and a slow build-up in the centre.",
    plan: {
      white: "Develop fast, castle, then prepare d4 with c3 so you own the centre.",
      black: "Mirror White's development, castle, and keep your e5 pawn solid.",
    },
    line: [
      p("e4", "centre", "Takes the centre and opens lines for the queen and the light-squared bishop."),
      p("e5", "centre", "Black claims the centre too, so White can't have it alone."),
      p("Nf3", "attack", "Develops a knight and attacks the e5 pawn right away."),
      p("Nc6", "defend", "Defends e5 while developing a piece."),
      p("Bc4", "develop", "The bishop comes out and aims at f7, the weakest square near Black's king."),
      p("Bc5", "develop", "Black's bishop copies the idea and aims at f2."),
      p("c3", "prepare", "Prepares d4: a pawn on c3 supports a big centre."),
      p("Nf6", "attack", "Develops and attacks e4, so White has to look after it."),
      p("d3", "defend", "Calmly defends e4. White keeps d4 for later, when it's ready."),
      p("d6", "defend", "Supports e5 and opens the diagonal for the c8 bishop."),
      p("O-O", "king", "Castles: the king is safe and the rook gets closer to the centre."),
      p("O-O", "king", "Black castles too. Both sides are ready for the middlegame."),
    ],
  },
  {
    id: "ruy",
    name: "Ruy Lopez",
    family: "Ruy Lopez",
    blurb: "The classic: pressure on the knight that guards e5, and a long fight in the centre.",
    plan: {
      white: "Pressure the e5 pawn through its defender, castle early, and get ready for c3 and d4.",
      black: "Kick the bishop with a6 and b5, develop, and keep e5 well defended.",
    },
    line: [
      p("e4", "centre", "Takes the centre and opens lines for the queen and bishop."),
      p("e5", "centre", "Black stakes a claim in the centre."),
      p("Nf3", "attack", "Develops and attacks e5."),
      p("Nc6", "defend", "Defends e5 with a developing move."),
      p("Bb5", "attack", "Pins down the knight that defends e5. The pressure is indirect, but it lasts."),
      p("a6", "attack", "Asks the bishop a question: take, or retreat?"),
      p("Ba4", "develop", "Keeps the pin on the knight instead of trading."),
      p("Nf6", "attack", "Develops and attacks e4."),
      p("O-O", "king", "Castles. e4 is not really hanging: if Nxe4, Re1 wins it back."),
      p("Be7", "develop", "Develops and gets ready to castle."),
      p("Re1", "defend", "The rook defends e4 for good, so White really threatens Bxc6 and Nxe5."),
      p("b5", "attack", "Kicks the bishop away from the knight for good."),
      p("Bb3", "develop", "The bishop lands on a great diagonal, pointing at f7."),
      p("d6", "defend", "Supports e5 and frees the c8 bishop."),
    ],
  },
  {
    id: "scotch",
    name: "Scotch Game",
    family: "Scotch Game",
    blurb: "White breaks open the centre on move three. Open lines, quick play.",
    plan: {
      white: "Trade the e5 pawn off with d4, take back with the knight, and develop around your strong centre.",
      black: "Hit the d4 knight with your pieces and develop with tempo.",
    },
    line: [
      p("e4", "centre", "Takes the centre."),
      p("e5", "centre", "Black claims the centre too."),
      p("Nf3", "attack", "Develops and attacks e5."),
      p("Nc6", "defend", "Defends e5."),
      p("d4", "centre", "Strikes the centre at once instead of building up slowly."),
      p("exd4", "trade", "Takes the pawn: Black can't keep e5 any more."),
      p("Nxd4", "trade", "Wins the pawn back with a centralised knight."),
      p("Bc5", "attack", "Develops and attacks the knight on d4."),
      p("Be3", "defend", "Defends the knight and develops."),
      p("Qf6", "attack", "Adds a third attacker on d4."),
      p("c3", "defend", "Defends d4 with a pawn, the cheapest defender."),
      p("Nge7", "develop", "Develops the last knight. On e7 it doesn't block the queen."),
    ],
  },
  {
    id: "qgd",
    name: "Queen's Gambit",
    family: "Queen's Gambit Declined",
    blurb: "White offers a pawn to pull Black's centre away. Black declines and stays solid.",
    plan: {
      white: "Pressure d5 with c4 and your pieces, pin the knight with Bg5, and develop calmly.",
      black: "Hold d5 with e6, develop, castle, and wait for the right moment to free yourself.",
    },
    line: [
      p("d4", "centre", "Takes the centre. The d4 pawn is already protected by the queen."),
      p("d5", "centre", "Black stops e4 and claims the centre."),
      p("c4", "attack", "The gambit: attacks d5 to pull Black's pawn away from the centre."),
      p("e6", "defend", "Declines: d5 stays defended and the dark-squared bishop can come out."),
      p("Nc3", "attack", "Develops and adds pressure on d5."),
      p("Nf6", "defend", "Develops and defends d5 again."),
      p("Bg5", "attack", "Pins the knight to the queen, so it's not really defending d5."),
      p("Be7", "defend", "Breaks the pin and gets ready to castle."),
      p("e3", "develop", "Opens a path for the f1 bishop and supports d4."),
      p("O-O", "king", "Black's king is safe."),
      p("Nf3", "develop", "Develops the last minor piece toward the centre."),
      p("Nbd7", "develop", "Develops and supports the other knight."),
    ],
  },
  {
    id: "london",
    name: "London System",
    family: "London System",
    blurb: "The same easy set-up nearly every game: a pawn triangle and a bishop outside it.",
    plan: {
      white: "d4, Bf4, e3, c3 and knights to d2 and f3. Solid first, attack later.",
      black: "Hit the centre with c5, develop quickly and castle. Don't let the set-up go unchallenged.",
    },
    line: [
      p("d4", "centre", "Takes the centre."),
      p("d5", "centre", "Black claims the centre too."),
      p("Bf4", "develop", "Gets the bishop out before e3 locks it in."),
      p("Nf6", "develop", "Develops toward the centre."),
      p("e3", "defend", "Supports d4 and lets the other bishop out."),
      p("c5", "attack", "Hits d4 straight away. Passive play gives White an easy game."),
      p("c3", "defend", "Holds d4 with another pawn: the London triangle."),
      p("Nc6", "attack", "Develops and adds pressure on d4."),
      p("Nd2", "develop", "Develops and keeps the c-pawn free to defend."),
      p("e6", "develop", "Opens the diagonal for the dark-squared bishop."),
      p("Ngf3", "develop", "Both knights are out, and d4 is well covered."),
      p("Bd6", "trade", "Offers to trade off White's good bishop."),
      p("Bg3", "defend", "Keeps the bishop by stepping back to a safe square."),
      p("O-O", "king", "Black castles. Now the middlegame starts."),
    ],
  },
  {
    id: "sicilian",
    name: "Sicilian Defence",
    family: "Sicilian Defense",
    blurb: "Black answers e4 with c5: unbalanced, ambitious, and full of fight.",
    plan: {
      white: "Open the centre with d4, use your lead in development, and keep an eye on d5.",
      black: "Trade a wing pawn for White's centre pawn, then fight for d5 and use the half-open c-file.",
    },
    line: [
      p("e4", "centre", "Takes the centre."),
      p("c5", "prevent", "Controls d4 from the side and keeps the game unbalanced."),
      p("Nf3", "prepare", "Develops and prepares d4."),
      p("d6", "prevent", "Covers e5 so White's pieces can't jump there, and frees the c8 bishop."),
      p("d4", "centre", "Opens the centre while White is ahead in development."),
      p("cxd4", "trade", "Trades the c-pawn for White's centre pawn."),
      p("Nxd4", "trade", "Takes back with a strong central knight."),
      p("Nf6", "attack", "Develops and attacks e4."),
      p("Nc3", "defend", "Defends e4 and develops."),
      p("a6", "prevent", "Keeps White's pieces off b5 and prepares b5 later: the Najdorf."),
      p("Be2", "develop", "Develops quietly and prepares castling."),
      p("e5", "attack", "Kicks the d4 knight and grabs space in the centre."),
      p("Nb3", "defend", "The knight retreats to safety."),
      p("Be7", "develop", "Develops and gets ready to castle."),
    ],
  },
  {
    id: "caro",
    name: "Caro-Kann",
    family: "Caro-Kann Defense",
    blurb: "A solid answer to e4: support d5 first, then get the light bishop out.",
    plan: {
      white: "Grab space, chase the f5 bishop with your knight and h-pawn, and develop.",
      black: "Challenge e4 with d5, develop the light bishop before e6, and stay rock solid.",
    },
    line: [
      p("e4", "centre", "Takes the centre."),
      p("c6", "prepare", "Prepares d5, so Black can take on e4 with a pawn backup."),
      p("d4", "centre", "White builds a big two-pawn centre."),
      p("d5", "attack", "Challenges e4 right away."),
      p("Nc3", "defend", "Defends e4 with a developing move."),
      p("dxe4", "trade", "Takes the pawn and frees the light-squared bishop."),
      p("Nxe4", "trade", "Wins the pawn back with a central knight."),
      p("Bf5", "attack", "Develops the bishop and attacks the knight."),
      p("Ng3", "attack", "Steps away and hits the bishop back."),
      p("Bg6", "defend", "Keeps the bishop on its good diagonal."),
      p("h4", "space", "Threatens h5 to trap or chase the bishop and grabs kingside space."),
      p("h6", "prevent", "Makes room so the bishop can step back to h7 if h5 comes."),
      p("Nf3", "develop", "Develops and covers e5."),
      p("Nd7", "prevent", "Develops and stops White's knight from landing on e5."),
    ],
  },
  {
    id: "french",
    name: "French Defence",
    family: "French Defense",
    blurb: "Black lets White have space, then attacks the pawn chain from below.",
    plan: {
      white: "Push e5 for space, support it with f4 and Nf3, and attack on the kingside.",
      black: "Lock the centre with e6 and d5, then hit the base of White's chain with c5 and ...f6.",
    },
    line: [
      p("e4", "centre", "Takes the centre."),
      p("e6", "prepare", "Prepares d5 with a pawn ready to back it up."),
      p("d4", "centre", "Builds a big centre."),
      p("d5", "attack", "Attacks e4."),
      p("Nc3", "defend", "Defends e4 and develops."),
      p("Nf6", "attack", "Adds a second attacker on e4."),
      p("e5", "space", "Pushes forward with tempo, kicking the knight and gaining space."),
      p("Nfd7", "defend", "The knight retreats, ready to attack e5 from d7."),
      p("f4", "defend", "Supports e5 with another pawn."),
      p("c5", "attack", "Hits the base of White's pawn chain on d4."),
      p("Nf3", "defend", "Develops and supports d4 and e5."),
      p("Nc6", "attack", "Adds another attacker on d4."),
    ],
  },
  {
    id: "scandi",
    name: "Scandinavian",
    family: "Scandinavian Defense",
    blurb: "Black hits e4 on move one and develops the queen early, then plays solid.",
    plan: {
      white: "Develop with tempo by chasing the queen, take the centre with d4, and get ahead in development.",
      black: "Put the queen on a5, develop the light bishop to f5, and build a solid c6-e6 shell.",
    },
    line: [
      p("e4", "centre", "Takes the centre."),
      p("d5", "attack", "Challenges e4 on the very first move."),
      p("exd5", "trade", "Takes the pawn."),
      p("Qxd5", "trade", "Wins the pawn back, even though the queen comes out early."),
      p("Nc3", "attack", "Develops with tempo by attacking the queen."),
      p("Qa5", "defend", "Steps away to a safe square, and pins the c3 knight once d2 moves."),
      p("d4", "centre", "Takes the centre and opens the c1 bishop."),
      p("Nf6", "develop", "Develops toward the centre."),
      p("Nf3", "develop", "Develops."),
      p("c6", "prepare", "Gives the queen a retreat on c7 or d8 and covers b5 and d5."),
      p("Bc4", "develop", "The bishop comes out to an active diagonal."),
      p("Bf5", "develop", "Develops the light bishop before e6 locks it in."),
    ],
  },
  {
    id: "kid",
    name: "King's Indian",
    family: "King's Indian Defense",
    blurb: "Black lets White build a big centre, castles fast, then strikes back with e5.",
    plan: {
      white: "Take the whole centre with pawns, develop, castle, and push on the queenside.",
      black: "Fianchetto, castle quickly, then attack the centre with e5 and later f5.",
    },
    line: [
      p("d4", "centre", "Takes the centre."),
      p("Nf6", "prevent", "Develops and stops e4 for now."),
      p("c4", "space", "Grabs more space and controls d5."),
      p("g6", "prepare", "Prepares to fianchetto the bishop on g7."),
      p("Nc3", "prepare", "Develops and prepares e4."),
      p("Bg7", "develop", "The bishop on the long diagonal pressures the centre from far away."),
      p("e4", "centre", "Builds a huge pawn centre."),
      p("d6", "prevent", "Stops e5 from kicking the knight, and prepares ...e5."),
      p("Nf3", "develop", "Develops and supports the centre."),
      p("O-O", "king", "Castles early, before opening the position."),
      p("Be2", "king", "Develops and gets ready to castle."),
      p("e5", "attack", "Hits the centre: the key King's Indian strike."),
      p("O-O", "king", "White castles too."),
      p("Nc6", "attack", "Adds pressure on d4."),
    ],
  },
];

export type Side = "white" | "black";
export const labKey = (id: string, side: Side) => `${id}:${side}`;

/** Spaced review: after a clean sparring run, the next one is due in 1, 3, 7, 14, then 30 days. */
export const REVIEW_DAYS = [1, 3, 7, 14, 30];

/**
 * The opening rule a move breaks, if any. The engine says how bad a move is; this says which habit to fix.
 * `history` is every move before it, `fenBefore` the position it was played in.
 */
export function brokenRule(move: Move, history: Move[], fenBefore: string): string | null {
  const plyNo = history.length;
  const file = move.to[0];
  if (move.piece === "k" && !move.san.startsWith("O-O")) return "Moving the king gives up castling, and it stays stuck in the middle.";
  if (move.piece === "q" && plyNo < 12) return "The queen comes out early, so their pieces can develop while chasing it.";
  if (move.piece === "n" && (file === "a" || file === "h")) return "A knight on the edge of the board controls half as many squares.";
  if (move.piece === "p" && file === "f" && plyNo < 14) return "Pushing the f-pawn this early weakens the squares around your king.";
  if (move.piece === "p" && "abgh".includes(file) && plyNo < 10 && !/^g[36]$/.test(move.to)) {
    return "A wing pawn move doesn't help the centre or your development.";
  }
  // the same minor piece again while others are still at home
  if (move.piece === "n" || move.piece === "b") {
    const board = new Chess(fenBefore);
    const rank = move.color === "w" ? "1" : "8";
    const home = (["b", "c", "f", "g"] as const).filter((f) => {
      const sq = board.get(`${f}${rank}` as Square);
      return sq && sq.color === move.color && (sq.type === "n" || sq.type === "b");
    });
    const movedBefore = history.some((m) => m.color === move.color && m.to === move.from);
    if (movedBefore && home.length >= 2) return "That piece already moved. Bring a new one out first.";
  }
  return null;
}

const PIECE_NAME: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

/**
 * Each move of a line in plain words, worked out from the board so the coach can't get it wrong:
 * "Their queen goes from d8 to g5. It now attacks your knight on e5 and your pawn on g2."
 * `you` is the learner's colour.
 */
export function describeLine(moves: Move[], you: "w" | "b"): string[] {
  const whose = (c: string) => (c === you ? "your" : "their");
  const mover = (c: string) => (c === you ? "Your" : "Their");
  return moves.map((m) => {
    const enemy = m.color === "w" ? "b" : "w";
    const what = m.san.startsWith("O-O")
      ? "king castles"
      : `${PIECE_NAME[m.piece]} ${m.captured ? `takes ${whose(enemy)} ${PIECE_NAME[m.captured]} on ${m.to}` : `goes from ${m.from} to ${m.to}`}`;
    const parts = [`${mover(m.color)} ${what}${m.promotion ? ` and becomes a ${PIECE_NAME[m.promotion]}` : ""}`];
    const after = new Chess(m.after);
    if (after.isCheckmate()) parts.push("Checkmate");
    else if (after.inCheck()) parts.push("Check");
    // what the moved piece hits now, most valuable first (pawns only when nothing defends them)
    const hits: { name: string; value: number }[] = [];
    for (const row of after.board()) {
      for (const sq of row) {
        if (!sq || sq.color !== enemy || sq.type === "k") continue;
        if (sq.type === "p" && after.attackers(sq.square, enemy).length) continue;
        if (after.attackers(sq.square, m.color).includes(m.to as Square)) {
          hits.push({ name: `${whose(enemy)} ${PIECE_NAME[sq.type]} on ${sq.square}`, value: PIECE_VALUE[sq.type] });
        }
      }
    }
    hits.sort((a, b) => b.value - a.value);
    if (hits.length) parts.push(`It now attacks ${hits.slice(0, 3).map((h) => h.name).join(" and ")}`);
    return `${parts.join(". ")}.`;
  });
}
