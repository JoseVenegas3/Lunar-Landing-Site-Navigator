/**
 * Procedural sound of the video pitch (WebAudio, no files): an ambient space
 * pad on a slow chord progression, a soft telemetry pulse, and a crescendo
 * that follows the acts (calm hook, building demos, peak in the emergency and
 * the close). Effects reuse the synthesisers of the training (beginner/audio).
 * Its own context and mute, so the training's sound settings are untouched.
 */
import { Sfx, impulseFor, synthOn } from '../beginner/audio';

declare global {
  interface Window { __pitchAudio?: { played: string[] } }
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let padBus: GainNode | null = null;
let fxBus: GainNode | null = null;
let muted = false;
let timer = 0;
let intensity = 0.3;
const voices: { osc: OscillatorNode[]; gain: GainNode }[] = [];

/** A minor-ish progression in D, slow: Dm9 - Bbmaj7 - Fadd9 - C6. */
const CHORDS = [[146.83, 220, 261.63, 329.63], [116.54, 174.61, 220, 293.66], [174.61, 220, 261.63, 392], [130.81, 196, 261.63, 329.63]];

/** Start (or resume) the sound; call from a user gesture (or with autoplay allowed). */
export function startPitchAudio(): void {
  if (typeof window === 'undefined') return;
  if (window.__pitchAudio) return;
  if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return; }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(ctx.destination);
  const rev = ctx.createConvolver(); rev.buffer = impulseFor(ctx, 5); rev.connect(master);
  padBus = ctx.createGain(); padBus.gain.value = 0; padBus.connect(master); padBus.connect(rev);
  fxBus = ctx.createGain(); fxBus.gain.value = 0.8; fxBus.connect(master); fxBus.connect(rev);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.6; lp.connect(padBus);
  // slow filter sweep
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
  const lfoGain = ctx.createGain(); lfoGain.gain.value = 380; lfo.connect(lfoGain); lfoGain.connect(lp.frequency); lfo.start();
  for (let v = 0; v < 4; v++) {
    const gain = ctx.createGain(); gain.gain.value = 0.05; gain.connect(lp);
    const osc = [0, 1].map((k) => {
      const o = ctx!.createOscillator();
      o.type = k ? 'sawtooth' : 'triangle';
      o.detune.value = k ? 7 : -5;
      o.frequency.value = CHORDS[0][v];
      o.connect(gain); o.start();
      return o;
    });
    voices.push({ osc, gain });
  }
  let chord = 0;
  const step = (): void => {
    if (!ctx) return;
    chord = (chord + 1) % CHORDS.length;
    const now = ctx.currentTime;
    voices.forEach((v, k) => v.osc.forEach((o) => o.frequency.setTargetAtTime(CHORDS[chord][k], now, 1.2)));
    // telemetry pulse: two soft ticks per chord, louder with the intensity
    for (const d of [0, 2]) tick(now + d, 1320, 0.03 + 0.05 * intensity);
  };
  timer = window.setInterval(step, 4000);
  setPitchIntensity(intensity);
}

function tick(when: number, freq: number, amp: number): void {
  if (!ctx || !fxBus) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(amp, when + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.12);
  o.connect(g); g.connect(fxBus); o.start(when); o.stop(when + 0.15);
}

/** 0 (calm) to 1 (climax): pad loudness and brightness. */
export function setPitchIntensity(x: number): void {
  intensity = Math.max(0, Math.min(1, x));
  if (!ctx || !padBus) return;
  padBus.gain.setTargetAtTime(0.25 + 0.55 * intensity, ctx.currentTime, 1.5);
  voices.forEach((v) => v.gain.gain.setTargetAtTime(0.04 + 0.05 * intensity, ctx!.currentTime, 1.5));
}

export function setPitchMuted(m: boolean): void {
  muted = m;
  if (ctx && master) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.05);
}
export const pitchMuted = (): boolean => muted;

export function sfx(s: Sfx): void {
  if (typeof window !== 'undefined' && window.__pitchAudio) { window.__pitchAudio.played.push(s); return; }
  if (!ctx || !fxBus || muted) return;
  if (ctx.state === 'suspended') void ctx.resume();
  synthOn(s, ctx, fxBus, ctx.currentTime + 0.01);
}

/** The pitch audio as a stream, for the in-browser recorder. */
export function pitchAudioStream(): MediaStream | null {
  if (!ctx || !master) return null;
  const dest = ctx.createMediaStreamDestination();
  master.connect(dest);
  return dest.stream;
}

export function stopPitchAudio(): void {
  window.clearInterval(timer);
  if (ctx) void ctx.suspend().catch(() => undefined);
}
