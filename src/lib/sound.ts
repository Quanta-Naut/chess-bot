// Board sounds, synthesised with Web Audio: a short filtered-noise "click" plus a low body tone
// reads as a wooden piece landing, so there are no audio files to fetch.

export type MoveSound = "move" | "capture" | "check" | "castle" | "promote";

const STORAGE_KEY = "pawnie.sound";

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

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

function audio(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** One wooden knock at time `t`. */
function knock(a: AudioContext, t: number, { pitch = 1, gain = 1 } = {}) {
  const out = a.createGain();
  out.gain.value = 0.55 * gain;
  out.connect(a.destination);

  // the click of the piece hitting the board
  const src = a.createBufferSource();
  src.buffer = noise;
  const band = a.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 1700 * pitch;
  band.Q.value = 1.2;
  const clickEnv = a.createGain();
  clickEnv.gain.setValueAtTime(1, t);
  clickEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  src.connect(band).connect(clickEnv).connect(out);
  src.start(t);

  // the hollow body of the board
  const body = a.createOscillator();
  body.type = "sine";
  body.frequency.setValueAtTime(230 * pitch, t);
  body.frequency.exponentialRampToValueAtTime(120 * pitch, t + 0.08);
  const bodyEnv = a.createGain();
  bodyEnv.gain.setValueAtTime(0.0001, t);
  bodyEnv.gain.exponentialRampToValueAtTime(0.7, t + 0.004);
  bodyEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
  body.connect(bodyEnv).connect(out);
  body.start(t);
  body.stop(t + 0.12);
}

function tone(a: AudioContext, t: number, from: number, to: number, length: number, gain: number) {
  const osc = a.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + length);
  const env = a.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  env.gain.exponentialRampToValueAtTime(0.001, t + length);
  osc.connect(env).connect(a.destination);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

export function playMove(kind: MoveSound) {
  if (!soundEnabled()) return;
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.005;
  switch (kind) {
    case "move":
      knock(a, t);
      break;
    case "capture":
      // sharper and heavier: the captured piece is knocked off first
      knock(a, t, { pitch: 1.45, gain: 0.75 });
      knock(a, t + 0.035, { pitch: 0.95, gain: 1.15 });
      break;
    case "castle":
      knock(a, t, { pitch: 1.05 });
      knock(a, t + 0.09, { pitch: 0.9 });
      break;
    case "check":
      knock(a, t, { gain: 1.1 });
      tone(a, t + 0.02, 880, 860, 0.16, 0.12);
      break;
    case "promote":
      knock(a, t);
      tone(a, t + 0.03, 520, 1040, 0.18, 0.1);
      break;
  }
}
