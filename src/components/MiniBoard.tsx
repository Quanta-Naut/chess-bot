const PIECES: Record<string, string> = {
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

interface Square {
  piece: string | null;
  light: boolean;
}

function parseBoard(fen: string): Square[][] {
  const rows = fen.split(" ")[0].split("/");
  return rows.map((row, ri) => {
    const squares: Square[] = [];
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) {
          squares.push({ piece: null, light: (file + (7 - ri)) % 2 === 1 });
          file++;
        }
      } else {
        squares.push({ piece: ch, light: (file + (7 - ri)) % 2 === 1 });
        file++;
      }
    }
    return squares;
  });
}

export function MiniBoard({ fen, orientation }: { fen: string; orientation: "white" | "black" }) {
  const rows = parseBoard(fen);
  const display = orientation === "white" ? rows : [...rows].reverse().map((r) => [...r].reverse());
  return (
    <div className="mini-board">
      {display.map((row, ri) =>
        row.map((sq, ci) => (
          <div key={`${ri}-${ci}`} className={`mb-sq ${sq.light ? "light" : "dark"}`}>
            {sq.piece && <span className={sq.piece === sq.piece.toUpperCase() ? "mb-w" : "mb-b"}>{PIECES[sq.piece.toLowerCase()]}</span>}
          </div>
        )),
      )}
    </div>
  );
}
