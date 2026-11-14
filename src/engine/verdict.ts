/**
 * Executive verdict of a mission (GO / CAUTION / NO-GO) and the emergency
 * countdowns, derived from the figures the engine already computes. No new
 * physics: this is the reading of the result a flight director would make,
 * with the thresholds in one place.
 */
import { STATE_DEPLETED, STATE_DTE, STATE_RELAY } from './analysis';
import { MissionResult, STATE_RF_PHYSICAL } from './missionAnalysis';

export type VerdictLevel = 'go' | 'caution' | 'nogo';
export type VerdictCause =
  | 'ok' | 'thermal' | 'battery' | 'no-link' | 'link-gap' | 'needs-relay' | 'deep-discharge' | 'low-sun' | 'tilt' | 'tipover' | 'slope';

export const VERDICT_LIMITS = {
  /** A mission that talks to the Earth less than this share of the time has no usable link, percent. */
  noLinkPct: 1,
  /** Longest silence that is still routine, hours. */
  linkGapH: 48,
  lowSunPct: 50,
  tiltDeg: 12,
  slopeDeg: 10,
  tipoverP: 0.05,
};

export interface Verdict {
  level: VerdictLevel;
  /** Most serious finding; `also` lists the rest in order. */
  cause: VerdictCause;
  also: VerdictCause[];
  survives: boolean;
  survivalHours: number;
  windowHours: number;
  illuminationPct: number;
  /** Share of the window with a path to the Earth (direct downlink that closes, or relay), percent. */
  linkPct: number;
  longestLinkGapH: number;
  minBusC: number | null;
  tiltDeg: number;
  slopeDeg: number;
  tipoverP: number | null;
}

/** Longest run of samples without any path to the Earth while the lander is alive, hours. */
export function longestSilenceH(r: MissionResult): number {
  let run = 0, best = 0;
  for (let i = 0; i < r.count; i++) {
    if (r.state[i] & STATE_DEPLETED) break;
    const talks = (r.state[i] & STATE_RF_PHYSICAL) !== 0 || ((r.state[i] & STATE_RELAY) !== 0 && !(r.state[i] & STATE_DTE));
    run = talks ? 0 : run + 1;
    if (run > best) best = run;
  }
  return best * r.stepHours;
}

export function missionVerdict(r: MissionResult, tipoverP: number | null = null): Verdict {
  const k = r.kpis, a = r.adv.kpis, L = VERDICT_LIMITS;
  const windowHours = (r.count - 1) * r.stepHours;
  const relayOn = !!(r.input.relay && r.input.relay.enabled);
  let talk = 0;
  for (let i = 0; i < r.count; i++) {
    if ((r.state[i] & STATE_RF_PHYSICAL) || (relayOn && (r.state[i] & STATE_RELAY) && !(r.state[i] & STATE_DEPLETED))) talk++;
  }
  const linkPct = (100 * talk) / r.count;
  const gap = longestSilenceH(r);
  const stop: VerdictCause[] = [], warn: VerdictCause[] = [];
  if (!k.survives) stop.push(a.thermalDeathH !== null ? 'thermal' : 'battery');
  if (linkPct < L.noLinkPct) stop.push('no-link');
  else if (gap > L.linkGapH) warn.push(relayOn ? 'link-gap' : 'needs-relay');
  if (k.survives && k.dodAlert) warn.push('deep-discharge');
  if (a.tiltDeg > L.tiltDeg) warn.push('tilt');
  if (tipoverP !== null && tipoverP > L.tipoverP) warn.push('tipover');
  if (k.slopeDeg > L.slopeDeg) warn.push('slope');
  if (k.illuminationPct < L.lowSunPct && k.survives) warn.push('low-sun');
  const all = [...stop, ...warn];
  return {
    level: stop.length > 0 ? 'nogo' : warn.length > 0 ? 'caution' : 'go',
    cause: all[0] ?? 'ok', also: all.slice(1),
    survives: k.survives, survivalHours: a.survivalHours, windowHours,
    illuminationPct: k.illuminationPct, linkPct, longestLinkGapH: gap, minBusC: a.minBusC,
    tiltDeg: a.tiltDeg, slopeDeg: k.slopeDeg, tipoverP,
  };
}

const RANK: Record<VerdictLevel, number> = { nogo: 0, caution: 1, go: 2 };

/** True when verdict `b` is better than `a`: higher level, then longer life, then more link. */
export function verdictImproves(a: Verdict, b: Verdict): boolean {
  if (RANK[b.level] !== RANK[a.level]) return RANK[b.level] > RANK[a.level];
  if (Math.abs(b.survivalHours - a.survivalHours) > 0.5) return b.survivalHours > a.survivalHours;
  return b.linkPct > a.linkPct + 0.5;
}

export interface Countdown {
  /** Hours from `fromHours` until the event, or null when it does not happen inside the window. */
  toLossH: number | null;
  /** Hours until the battery is first empty (the bus may live on for a while on array power), or null. */
  toBatteryFlatH: number | null;
  /** What kills the lander, when it is lost. */
  lossCause: 'thermal' | 'battery' | null;
  /** Hours until the downlink that is open now closes (0 when it is already closed). */
  toLinkLossH: number | null;
  /** Hours until the next downlink opens, when it is closed now. */
  toLinkH: number | null;
  /** Hours until the Sun that is up now is hidden (0 when the lander is in the dark). */
  toDarkH: number | null;
  /** Hours until the next sunrise, when the lander is in the dark now. */
  toSunH: number | null;
  linkNow: boolean;
  sunNow: boolean;
  aliveNow: boolean;
}

/** Time left before the lander is lost, before the link closes and before the next shadow, from a mission time. */
export function emergencyCountdown(r: MissionResult, fromHours = 0): Countdown {
  const i0 = Math.max(0, Math.min(r.count - 1, Math.round(fromHours / r.stepHours)));
  const next = (test: (i: number) => boolean): number | null => {
    for (let i = i0; i < r.count; i++) if (test(i)) return (i - i0) * r.stepHours;
    return null;
  };
  const flat = (i: number): boolean => (r.state[i] & STATE_DEPLETED) !== 0;
  // The engine's own time of loss: battery freezing with the thermal model, first depletion without it.
  const lostAt = r.kpis.survives ? null : r.adv.kpis.survivalHours;
  const t0 = i0 * r.stepHours;
  const link = (i: number): boolean => (r.state[i] & STATE_RF_PHYSICAL) !== 0;
  const sun = (i: number): boolean => r.sunFrac[i] >= 0.5;
  const linkNow = link(i0), sunNow = sun(i0);
  return {
    toLossH: lostAt === null ? null : Math.max(0, lostAt - t0),
    toBatteryFlatH: next(flat),
    lossCause: lostAt === null ? null : r.adv.kpis.thermalDeathH !== null ? 'thermal' : 'battery',
    toLinkLossH: linkNow ? next((i) => !link(i)) : 0,
    toLinkH: linkNow ? 0 : next(link),
    toDarkH: sunNow ? next((i) => !sun(i)) : 0,
    toSunH: sunNow ? 0 : next(sun),
    linkNow, sunNow, aliveNow: lostAt === null || t0 < lostAt,
  };
}
