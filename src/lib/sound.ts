// Board sounds: chess.com's default set, played straight from their CDN (not bundled with the app),
// and a short buzz on phones that can vibrate (Android browsers; iPhones' Safari doesn't allow it).

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

const HAPTICS_KEY = "pawnie.haptics";
// a light tap for a move, a firmer one for a capture, two taps for a check
const BUZZ: Record<MoveSound, number | number[]> = { move: 12, castle: 12, promote: 20, capture: 22, check: [18, 60, 18] };

export const canVibrate = () => typeof navigator !== "undefined" && "vibrate" in navigator;

export function hapticsEnabled(): boolean {
  try {
    return localStorage.getItem(HAPTICS_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setHapticsEnabled(on: boolean) {
  try {
    localStorage.setItem(HAPTICS_KEY, on ? "on" : "off");
  } catch {
    // only a preference
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
  if (hapticsEnabled() && canVibrate()) navigator.vibrate(BUZZ[kind]);
  if (!soundEnabled()) return;
  const base = sounds()[kind];
  if (!base) return;
  // a fresh copy each time, so quick moves overlap instead of cutting each other off
  const a = base.cloneNode() as HTMLAudioElement;
  a.volume = 0.8;
  void a.play().catch(() => {});
}
