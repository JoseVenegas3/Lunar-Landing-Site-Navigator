/**
 * Display unit system (v3.1, SR-711): SI (m, km, °C, K) or Imperial (ft, mi,
 * °F). Only what is shown changes: the engine, the store and the CSV export
 * always work in SI. Power (W), energy (Wh), frequency (GHz), data rates,
 * decibels and angles are the same in both systems, as is usual in
 * aerospace engineering.
 */
import { useMemo } from 'react';
import { UnitSystem, useApp } from '../state/store';

export type { UnitSystem };

export const FT_PER_M = 3.28084;
export const MI_PER_KM = 0.621371;
export const FT2_PER_M2 = FT_PER_M * FT_PER_M;

export const mToFt = (m: number): number => m * FT_PER_M;
export const ftToM = (ft: number): number => ft / FT_PER_M;
export const kmToMi = (km: number): number => km * MI_PER_KM;
export const miToKm = (mi: number): number => mi / MI_PER_KM;
export const cToF = (c: number): number => c * 1.8 + 32;
export const fToC = (f: number): number => (f - 32) / 1.8;
export const kToC = (k: number): number => k - 273.15;
export const kToF = (k: number): number => cToF(kToC(k));
export const msToFts = (ms: number): number => ms * FT_PER_M;
export const m2ToFt2 = (m2: number): number => m2 * FT2_PER_M2;

const fix = (v: number, d: number): string => {
  if (!Number.isFinite(v)) return '--';
  const s = v.toFixed(d);
  return Number(s) === 0 ? (0).toFixed(d) : s;
};
const signed = (v: number, d: number): string => {
  const s = fix(v, d);
  return v > 0 && Number(s) !== 0 ? `+${s}` : s;
};
/** Thousands separator for long distances: 1,840 m. */
const group = (v: number, d: number): string => {
  if (!Number.isFinite(v)) return '--';
  const [i, f] = Math.abs(v).toFixed(d).split('.');
  const g = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${v < 0 ? '−' : ''}${g}${f ? `.${f}` : ''}`;
};

export interface Units {
  sys: UnitSystem;
  /** Unit labels. */
  lenU: string;
  kmU: string;
  tempU: string;
  speedU: string;
  areaU: string;
  /** Converted numbers (no unit). */
  len: (m: number) => number;
  km: (km: number) => number;
  tempC: (c: number) => number;
  /** A length in metres: "320 m" / "1050 ft". */
  m: (m: number, digits?: number) => string;
  /** A signed length in metres: "+12 m" / "+39 ft". */
  mSigned: (m: number, digits?: number) => string;
  /** A distance that switches to km / mi when long: "320 m", "1,840 m (1.84 km)" / "6,037 ft (1.14 mi)". */
  dist: (m: number) => string;
  /** A distance given in km: "12.4 km" / "7.7 mi". */
  kmStr: (km: number, digits?: number) => string;
  /** A temperature in °C: "−20 °C" / "−4 °F". */
  c: (c: number, digits?: number) => string;
  cSigned: (c: number, digits?: number) => string;
  /** A temperature in K: "150 K" (SI keeps kelvin) / "−190 °F". */
  k: (k: number, digits?: number) => string;
  /** A speed in m/s: "0.8 m/s" / "2.6 ft/s". */
  ms: (ms: number, digits?: number) => string;
  /** An area in m²: "2.0 m²" / "21.5 ft²". */
  m2: (m2: number, digits?: number) => string;
}

export function makeUnits(sys: UnitSystem): Units {
  const imp = sys === 'imperial';
  const len = (m: number): number => (imp ? mToFt(m) : m);
  const km = (k: number): number => (imp ? kmToMi(k) : k);
  const tempC = (c: number): number => (imp ? cToF(c) : c);
  const lenU = imp ? 'ft' : 'm';
  const kmU = imp ? 'mi' : 'km';
  const tempU = imp ? '°F' : '°C';
  return {
    sys, lenU, kmU, tempU, speedU: imp ? 'ft/s' : 'm/s', areaU: imp ? 'ft²' : 'm²',
    len, km, tempC,
    m: (m, d = 0) => `${fix(len(m), d)} ${lenU}`,
    mSigned: (m, d = 0) => `${signed(len(m), d)} ${lenU}`,
    dist: (m) => {
      const a = Math.abs(m);
      if (a < 1000) return `${fix(len(m), 0)} ${lenU}`;
      return `${group(len(m), 0)} ${lenU} (${fix(km(m / 1000), 2)} ${kmU})`;
    },
    kmStr: (k, d = 1) => `${fix(km(k), d)} ${kmU}`,
    c: (c, d = 0) => `${fix(tempC(c), d)} ${tempU}`.replace(/^-/, '−'),
    cSigned: (c, d = 1) => `${signed(tempC(c), d)} ${tempU}`,
    k: (k, d = 0) => (imp ? `${fix(kToF(k), d)} °F`.replace(/^-/, '−') : `${fix(k, d)} K`),
    ms: (v, d = 1) => `${fix(imp ? msToFts(v) : v, d)} ${imp ? 'ft/s' : 'm/s'}`,
    m2: (v, d = 1) => `${fix(imp ? m2ToFt2(v) : v, d)} ${imp ? 'ft²' : 'm²'}`,
  };
}

const SI = makeUnits('si');
const IMP = makeUnits('imperial');
export const unitsFor = (sys: UnitSystem): Units => (sys === 'imperial' ? IMP : SI);

/** Reactive unit formatters for components. */
export function useUnits(): Units {
  const sys = useApp((s) => s.unitSystem);
  return useMemo(() => unitsFor(sys), [sys]);
}

/** Non-reactive read, for canvases and 3-D labels that redraw on their own. */
export const currentUnits = (): Units => unitsFor(useApp.getState().unitSystem);
