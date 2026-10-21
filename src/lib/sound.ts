// Board sounds: chess.com's default set, played straight from their CDN (not bundled with the app).

export type MoveSound = "move" | "capture" | "check" | "castle" | "promote";

const STORAGE_KEY = "pawnie.sound";
const BASE = "https://images.chesscomfiles.com/chess-themes/sounds/_MP3_/default/";
const FILES: Record<MoveSound, string> = {
  move: "move-self.mp3",
  capture: "capture.mp3",
  check: "move-check.mp3",
  castle: "castle.mp3",
  promote: "promote.mp3",
};

let loaded: Partial<Record<MoveSound, HTMLAudioElement>> | null = null;

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // only a preference
  }
}

/** Which sound a move makes, from its SAN. */
export function soundFor(san: string): MoveSound {
  if (san.includes("+") || san.includes("#")) return "check";
  if (san.startsWith("O-O")) return "castle";
  if (san.includes("=")) return "promote";
  if (san.includes("x")) return "capture";
  return "move";
}

/** Start fetching every sound, so the first move doesn't wait on the network. */
function sounds(): Partial<Record<MoveSound, HTMLAudioElement>> {
  if (!loaded) {
    loaded = {};
    for (const kind of Object.keys(FILES) as MoveSound[]) {
      const a = new Audio(BASE + FILES[kind]);
      a.preload = "auto";
      loaded[kind] = a;
    }
  }
  return loaded;
}

export function playMove(kind: MoveSound) {
  if (!soundEnabled()) return;
  const base = sounds()[kind];
  if (!base) return;
  // a fresh copy each time, so quick moves overlap instead of cutting each other off
  const a = base.cloneNode() as HTMLAudioElement;
  a.volume = 0.8;
  void a.play().catch(() => {});
}
