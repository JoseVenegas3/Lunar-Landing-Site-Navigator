/**
 * Procedural sound of the Beginner training (v3.0): WebAudio only, no files,
 * no licences, no network.
 *
 * - Effects: one synth function each, with a short subtitle shown when the
 *   sound is muted or subtitles are on.
 * - Music: a slow generative space ambience (detuned pad through a lowpass
 *   filter, sparse pentatonic bells through a feedback delay and a synthetic
 *   reverb), switchable on its own and quiet under the effects.
 * - The AudioContext is created on the first user gesture (autoplay policy)
 *   and lives for the whole page: it is suspended, not closed, when the
 *   training ends, so React StrictMode re-mounts cannot kill it.
 * - Alarms pulse at 2 Hz at most (WCAG 2.3.1 allows up to 3).
 *
 * Tests replace the output with a log through `window.__clpsAudioMock`.
 */
import { useBeginner } from './state';

export type Sfx =
  | 'landing' | 'deploy' | 'message' | 'unlock' | 'success' | 'alarm' | 'radio' | 'static' | 'siren' | 'error'
  | 'whoosh' | 'thrusters' | 'objective' | 'xp' | 'fanfare' | 'click' | 'servo';

export const SFX_CAPTION: Record<Sfx, [string, string]> = {
  landing: ['[thud of the landing legs, dust]', '[golpe de las patas al alunizar, polvo]'],
  deploy: ['[solar arrays unfolding]', '[paneles solares desplegándose]'],
  message: ['[incoming transmission]', '[transmisión entrante]'],
  unlock: ['[console unlocked]', '[consola desbloqueada]'],
  success: ['[success chord]', '[acorde de éxito]'],
  alarm: ['[intermittent alarm]', '[alarma intermitente]'],
  radio: ['[radio pulses]', '[pulsos de radio]'],
  static: ['[radio static and tones]', '[estática y tonos de radio]'],
  siren: ['[emergency siren]', '[sirena de emergencia]'],
  error: ['[soft error tone]', '[tono suave de error]'],
  whoosh: ['[whoosh]', '[zumbido de paso]'],
  thrusters: ['[descent engine rumble]', '[rugido del motor de descenso]'],
  objective: ['[new objective]', '[nuevo objetivo]'],
  xp: ['[points earned]', '[puntos ganados]'],
  fanfare: ['[mission complete fanfare]', '[fanfarria de misión cumplida]'],
  click: ['[click]', '[clic]'],
  servo: ['[mast motor]', '[motor del mástil]'],
};

declare global {
  interface Window { __clpsAudioMock?: { played: string[] } }
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let reverb: ConvolverNode | null = null;

/** Create (or resume) the audio graph; call from a user gesture. */
export function unlockAudio(): void {
  if (typeof window === 'undefined' || window.__clpsAudioMock) return;
  if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return; }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.connect(master);
  musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
  reverb = ctx.createConvolver(); reverb.buffer = impulse(ctx, 4.5); reverb.connect(master);
  applyVolume();
}

/** Any gesture after the page loaded can start the audio (e.g. ?mode=beginner skips the gate). */
if (typeof window !== 'undefined') {
  const first = (): void => { if (useBeginner.getState().step >= 0) unlockAudio(); };
  window.addEventListener('pointerdown', first, { capture: true });
  window.addEventListener('keydown', first, { capture: true });
}

/** End of the training: music off, context suspended (kept for the page). */
export function closeAudio(): void {
  stopMusic();
  if (ctx && ctx.state === 'running') void ctx.suspend().catch(() => undefined);
}

export function applyVolume(): void {
  const { muted, volume, music } = useBeginner.getState();
  if (!master || !ctx) return;
  master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.05);
  if (musicBus) musicBus.gain.setTargetAtTime(music && !muted ? 0.32 : 0, ctx.currentTime, 0.8);
  if (music && !muted) startMusic(); else stopMusic();
}

let captionTimer = 0;
/** Play one effect and post its subtitle. */
export function play(s: Sfx, lang: 'en' | 'es'): void {
  const b = useBeginner.getState();
  if (s !== 'click') b.set({ caption: SFX_CAPTION[s][lang === 'es' ? 1 : 0] });
  if (typeof window !== 'undefined') {
    window.clearTimeout(captionTimer);
    captionTimer = window.setTimeout(() => useBeginner.getState().set({ caption: null }), 2600);
    if (window.__clpsAudioMock) { window.__clpsAudioMock.played.push(s); return; }
  }
  if (!ctx || !sfxBus || b.muted) return;
  if (ctx.state === 'suspended') void ctx.resume();
  SYNTH[s](ctx, sfxBus, ctx.currentTime + 0.01);
}

/** Soft blip for the typewriter text (rate-limited, no subtitle). */
let lastBlip = 0;
export function blip(): void {
  if (!ctx || !sfxBus || useBeginner.getState().muted || (typeof window !== 'undefined' && window.__clpsAudioMock)) return;
  const now = ctx.currentTime;
  if (now - lastBlip < 0.055) return;
  lastBlip = now;
  tone(ctx, sfxBus, now, 1500 + Math.random() * 500, 1300, 0.03, 'sine', 0.035);
}

// ------------------------------------------------------------------ synthesis helpers

function impulse(c: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  return buf;
}

function tone(c: AudioContext, out: AudioNode, t: number, f0: number, f1: number, dur: number, type: OscillatorType = 'sine', peak = 0.5, wet = 0): void {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  if (wet > 0 && reverb) { const w = c.createGain(); w.gain.value = wet; g.connect(w).connect(reverb); }
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(c: AudioContext, out: AudioNode, t: number, dur: number, freq: number, peak = 0.4, q = 0.8, sweepTo?: number): void {
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = buf;
  f.type = 'bandpass'; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.08, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t);
}

type Synth = (c: AudioContext, o: AudioNode, t: number) => void;
const chord = (c: AudioContext, o: AudioNode, t: number, fs: number[], dur: number, type: OscillatorType, peak: number, stagger = 0): void =>
  fs.forEach((f, k) => tone(c, o, t + k * stagger, f, f, dur, type, peak, 0.5));

const SYNTH: Record<Sfx, Synth> = {
  landing: (c, o, t) => { tone(c, o, t, 95, 32, 0.9, 'sine', 0.9); noise(c, o, t + 0.04, 1.6, 500, 0.4, 0.6, 120); },
  deploy: (c, o, t) => { for (let k = 0; k < 4; k++) { tone(c, o, t + k * 0.28, 180 + k * 40, 260 + k * 40, 0.22, 'sawtooth', 0.07); noise(c, o, t + k * 0.28 + 0.2, 0.08, 3000, 0.12, 4); } chord(c, o, t + 1.2, [523, 784], 0.6, 'triangle', 0.08); },
  message: (c, o, t) => { noise(c, o, t, 0.12, 2400, 0.08, 3); tone(c, o, t + 0.1, 880, 880, 0.08, 'sine', 0.12); tone(c, o, t + 0.2, 1320, 1320, 0.1, 'sine', 0.1); },
  unlock: (c, o, t) => { tone(c, o, t, 220, 110, 0.25, 'square', 0.08); chord(c, o, t + 0.15, [523, 659, 784, 1046, 1318], 0.9, 'triangle', 0.12, 0.07); },
  success: (c, o, t) => chord(c, o, t, [392, 494, 587, 784], 1.4, 'sine', 0.12, 0.04),
  alarm: (c, o, t) => { for (let k = 0; k < 3; k++) tone(c, o, t + k * 0.5, 880, 660, 0.3, 'square', 0.08); },
  radio: (c, o, t) => { for (let k = 0; k < 4; k++) tone(c, o, t + k * 0.35, 1800, 1700, 0.12, 'sine', 0.12, 0.3); },
  static: (c, o, t) => { noise(c, o, t, 1.0, 2500, 0.18, 0.5); tone(c, o, t + 1.0, 1000, 1000, 0.15, 'sine', 0.14); tone(c, o, t + 1.25, 1400, 1400, 0.15, 'sine', 0.14); },
  siren: (c, o, t) => { tone(c, o, t, 600, 1100, 0.9, 'sawtooth', 0.08); tone(c, o, t + 0.9, 1100, 600, 0.9, 'sawtooth', 0.08); },
  error: (c, o, t) => tone(c, o, t, 300, 200, 0.25, 'triangle', 0.15),
  whoosh: (c, o, t) => noise(c, o, t, 1.1, 300, 0.25, 0.7, 4000),
  thrusters: (c, o, t) => { noise(c, o, t, 3.6, 180, 0.35, 0.5, 90); tone(c, o, t, 55, 48, 3.6, 'sawtooth', 0.05); },
  objective: (c, o, t) => { tone(c, o, t, 660, 660, 0.12, 'triangle', 0.12); tone(c, o, t + 0.12, 990, 990, 0.18, 'triangle', 0.12, 0.3); },
  xp: (c, o, t) => { for (let k = 0; k < 5; k++) tone(c, o, t + k * 0.06, 880 + k * 220, 880 + k * 220, 0.1, 'square', 0.04); },
  fanfare: (c, o, t) => { chord(c, o, t, [392, 523], 0.35, 'sawtooth', 0.06); chord(c, o, t + 0.3, [440, 587], 0.35, 'sawtooth', 0.06); chord(c, o, t + 0.6, [523, 659, 784, 1046], 1.6, 'triangle', 0.12, 0.03); },
  click: (c, o, t) => tone(c, o, t, 1800, 1200, 0.04, 'triangle', 0.06),
  servo: (c, o, t) => { tone(c, o, t, 140, 320, 1.4, 'sawtooth', 0.05); noise(c, o, t, 1.4, 900, 0.06, 2); },
};

// ------------------------------------------------------------------ generative space music

let musicTimer = 0;
let pad: { stop: () => void } | null = null;
const SCALE = [220, 246.94, 277.18, 329.63, 369.99, 440, 493.88, 554.37, 659.25]; // A major pentatonic, two octaves

function startPad(): void {
  if (!ctx || !musicBus || pad) return;
  const c = ctx;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = 700; filter.Q.value = 0.4;
  const lfo = c.createOscillator(), lfoGain = c.createGain();
  lfo.frequency.value = 0.05; lfoGain.gain.value = 300;
  lfo.connect(lfoGain).connect(filter.frequency);
  const g = c.createGain(); g.gain.value = 0.0001;
  g.gain.setTargetAtTime(0.11, c.currentTime, 2.5);
  filter.connect(g).connect(musicBus);
  if (reverb) { const w = c.createGain(); w.gain.value = 0.6; g.connect(w).connect(reverb); }
  const oscs = [110, 110 * 1.003, 164.81, 220 * 0.997, 277.18].map((f) => {
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(filter); o.start(); return o;
  });
  lfo.start();
  pad = { stop: () => { g.gain.setTargetAtTime(0.0001, c.currentTime, 0.8); window.setTimeout(() => { oscs.forEach((o) => o.stop()); lfo.stop(); }, 3000); } };
}

function bell(): void {
  if (!ctx || !musicBus) return;
  const f = SCALE[Math.floor(Math.random() * SCALE.length)];
  const t = ctx.currentTime;
  const delay = ctx.createDelay(); delay.delayTime.value = 0.42;
  const fb = ctx.createGain(); fb.gain.value = 0.35;
  const out = ctx.createGain(); out.gain.value = 0.9;
  delay.connect(fb).connect(delay); delay.connect(out).connect(musicBus);
  tone(ctx, delay, t, f, f, 2.4, 'sine', 0.07, 0);
  tone(ctx, musicBus, t, f, f, 2.4, 'sine', 0.06, 0.8);
  tone(ctx, musicBus, t, f * 2.01, f * 2.01, 1.2, 'sine', 0.015, 0.8);
}

function startMusic(): void {
  if (!ctx || musicTimer) return;
  startPad();
  const loop = (): void => {
    if (Math.random() < 0.7) bell();
    musicTimer = window.setTimeout(loop, 1400 + Math.random() * 2600);
  };
  musicTimer = window.setTimeout(loop, 1500);
}

function stopMusic(): void {
  if (musicTimer) { window.clearTimeout(musicTimer); musicTimer = 0; }
  if (pad) { pad.stop(); pad = null; }
}
