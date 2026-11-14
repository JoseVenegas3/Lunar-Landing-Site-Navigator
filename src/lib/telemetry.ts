/**
 * Thresholds of the telemetry strip, defined in one place. A reading is
 * 'crit' (red) when the lander is in danger, 'warn' (amber) when it is
 * approaching it, 'ok' otherwise.
 */
export type Tone = 'ok' | 'warn' | 'crit';

export const TELEMETRY_LIMITS = {
  /** Battery state of charge, percent: below warn = amber, below crit = red (the default 80 % depth-of-discharge limit leaves 20 %). */
  batteryWarnPct: 40,
  batteryCritPct: 20,
  /** Bus temperature, degC: heaters switch on at 0 degC, the battery freezes at -20 degC. */
  busWarnC: 0,
  busCritC: -20,
  /** Link margin over the required Eb/N0, dB. */
  marginWarnDb: 3,
  marginCritDb: 0,
  /** Visible share of the solar disc: partly hidden below warn, in shadow at 0. */
  sunWarnFrac: 0.98,
} as const;

const L = TELEMETRY_LIMITS;

export function batteryTone(socPct: number, depleted: boolean): Tone {
  if (depleted || socPct < L.batteryCritPct) return 'crit';
  return socPct < L.batteryWarnPct ? 'warn' : 'ok';
}

export function busTone(busC: number): Tone {
  if (busC <= L.busCritC) return 'crit';
  return busC < L.busWarnC ? 'warn' : 'ok';
}

/** Null margin: no signal at all. */
export function marginTone(marginDb: number | null): Tone {
  if (marginDb === null || marginDb < L.marginCritDb) return 'crit';
  return marginDb < L.marginWarnDb ? 'warn' : 'ok';
}

export function sunTone(fraction: number): Tone {
  if (fraction <= 0) return 'crit';
  return fraction < L.sunWarnFrac ? 'warn' : 'ok';
}
