// A knight hopping around a little board while something loads. `full` centres it in the whole window.
// Its tour (a1 → b3 → d4 → c2 → a1, on a 4×4 board) is all knight moves, timed in index.css.
const TOUR = new Set(["0,0", "1,2", "3,3", "2,1"]);

export function Loader({ label = "Loading", full = false }: { label?: string; full?: boolean }) {
  const squares = [];
  for (let row = 3; row >= 0; row--) {
    for (let col = 0; col < 4; col++) {
      const stop = TOUR.has(`${col},${row}`) ? `stop-${col}${row}` : "";
      squares.push(<span key={`${col}${row}`} className={`loader-sq ${(col + row) % 2 ? "light" : "dark"} ${stop}`} />);
    }
  }
  return (
    <div className={`loader ${full ? "full" : ""}`} role="status" aria-live="polite">
      <div className="loader-board">
        {squares}
        <span className="loader-knight" aria-hidden>
          ♞
        </span>
      </div>
      <div className="loader-label">
        {label}
        <span className="loader-dots" aria-hidden>
          <i>.</i>
          <i>.</i>
          <i>.</i>
        </span>
      </div>
    </div>
  );
}
