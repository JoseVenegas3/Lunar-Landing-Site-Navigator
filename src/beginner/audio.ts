/**
 * Procedural sound effects of the Beginner training (v3.0): WebAudio only, no
 * files, no licences, no network. The AudioContext is created on the first
 * user gesture (the gate button), as the autoplay policy requires, and closed
 * when the training ends. Every effect has a short subtitle, shown when the
 * sound is muted or subtitles are on. Alarms pulse at 2 Hz at most (under the
 * 3 flashes per second of WCAG 2.3.1, which the visual pulses follow too).
 *
 * Tests replace the module with a silent stub through `window.__clpsAudioMock`.
 */
import { useBeginner } from './state';

export type Sfx = 'landing' | 'deploy' | 'message' | 'unlock' | 'success' | 'alarm' | 'radio' | 'static' | 'siren' | 'error';

export const SFX_CAPTION: Record<Sfx, [string, string]> = {
  landing: ['[thud of the landing legs, dust]', '[golpe de las patas al alunizar, polvo]'],
  deploy: ['[servo motors deploying]', '[servomotores desplegando]'],
  message: ['[soft click]', '[clic suave]'],
  unlock: ['[unlock chime]', '[campanilla de desbloqueo]'],
  success: ['[success chord]', '[acorde de éxito]'],
  alarm: ['[intermittent alarm]', '[alarma intermitente]'],
  radio: ['[radio pulses]', '[pulsos de radio]'],
  static: ['[radio static and tones]', '[estática y tonos de radio]'],
  siren: ['[emergency siren]', '[sirena de emergencia]'],
  error: ['[soft error tone]', '[tono suave de error]'],
};

declare global {
  interface Window { __clpsAudioMock?: { played: Sfx[] } }
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

/** Create the audio graph; call from a user gesture. */
export function unlockAudio(): void {
  if (typeof window === 'undefined' || window.__clpsAudioMock || ctx) return;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.connect(ctx.destination);
  applyVolume();
}

/** Close the audio graph (end of the training): no context is left running. */
export function closeAudio(): void {
  if (ctx) void ctx.close().catch(() => undefined);
  ctx = null;
  master = null;
}

export function applyVolume(): void {
  const { muted, volume } = useBeginner.getState();
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : volume * 0.5, ctx.currentTime, 0.02);
}

let captionTimer = 0;
/** Play one effect and post its subtitle. */
export function play(s: Sfx, lang: 'en' | 'es'): void {
  const b = useBeginner.getState();
  b.set({ caption: SFX_CAPTION[s][lang === 'es' ? 1 : 0] });
  if (typeof window !== 'undefined') {
    window.clearTimeout(captionTimer);
    captionTimer = window.setTimeout(() => useBeginner.getState().set({ caption: null }), 2600);
    if (window.__clpsAudioMock) { window.__clpsAudioMock.played.push(s); return; }
  }
  if (!ctx || !master || b.muted) return;
  const t = ctx.currentTime;
  SYNTH[s](ctx, master, t);
}

type Synth = (c: AudioContext, out: AudioNode, t: number) => void;

function tone(c: AudioContext, out: AudioNode, t: number, f0: number, f1: number, dur: number, type: OscillatorType = 'sine', peak = 0.5): void {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(c: AudioContext, out: AudioNode, t: number, dur: number, freq: number, peak = 0.4): void {
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = buf;
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8;
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t);
}

const SYNTH: Record<Sfx, Synth> = {
  landing: (c, o, t) => { tone(c, o, t, 90, 38, 0.6, 'sine', 0.9); noise(c, o, t + 0.05, 1.2, 400, 0.35); },
  deploy: (c, o, t) => { for (let k = 0; k < 3; k++) tone(c, o, t + k * 0.22, 220, 330, 0.18, 'sawtooth', 0.12); },
  message: (c, o, t) => tone(c, o, t, 1200, 900, 0.06, 'triangle', 0.2),
  unlock: (c, o, t) => { [523, 659, 784, 1046].forEach((f, k) => tone(c, o, t + k * 0.09, f, f, 0.35, 'triangle', 0.25)); },
  success: (c, o, t) => { [392, 494, 587].forEach((f) => tone(c, o, t, f, f, 1.1, 'sine', 0.22)); },
  // Two pulses per second for 1.5 s: 2 Hz, under the 3 Hz limit.
  alarm: (c, o, t) => { for (let k = 0; k < 3; k++) tone(c, o, t + k * 0.5, 880, 660, 0.3, 'square', 0.12); },
  radio: (c, o, t) => { for (let k = 0; k < 4; k++) tone(c, o, t + k * 0.35, 1800, 1700, 0.12, 'sine', 0.18); },
  static: (c, o, t) => { noise(c, o, t, 0.9, 2500, 0.25); tone(c, o, t + 0.9, 1000, 1000, 0.15, 'sine', 0.2); tone(c, o, t + 1.15, 1400, 1400, 0.15, 'sine', 0.2); },
  siren: (c, o, t) => { tone(c, o, t, 600, 1100, 0.9, 'sawtooth', 0.12); tone(c, o, t + 0.9, 1100, 600, 0.9, 'sawtooth', 0.12); },
  error: (c, o, t) => tone(c, o, t, 300, 200, 0.25, 'triangle', 0.2),
};
