import { useCallback } from 'react';
import { useApp } from '../state/store';

/** Inline bilingual strings: `t('Sunlight', 'Luz solar')`. */
export function useT(): (en: string, es: string) => string {
  const lang = useApp((s) => s.lang);
  return useCallback((en: string, es: string) => (lang === 'es' ? es : en), [lang]);
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 2027-09-01 */
export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** 2027-09-01 14:00 */
export function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  return `${fmtDate(ms)} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** 09-01 */
export function fmtMonthDay(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Hours as "3 d 04 h" or "17 h". */
export function fmtDuration(hours: number): string {
  const h = Math.round(hours);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} d ${pad2(h % 24)} h`;
}

export function fmtNum(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '--';
  return v.toFixed(digits);
}

/** Signed with explicit plus. */
export function fmtSigned(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '--';
  const s = v.toFixed(digits);
  return v > 0 && Number(s) !== 0 ? `+${s}` : s;
}

export function fmtEnergy(wh: number): string {
  if (wh >= 1e6) return `${(wh / 1e6).toFixed(2)} MWh`;
  if (wh >= 1e4) return `${(wh / 1e3).toFixed(0)} kWh`;
  if (wh >= 1e3) return `${(wh / 1e3).toFixed(1)} kWh`;
  return `${wh.toFixed(0)} Wh`;
}

export function fmtData(gb: number): string {
  if (gb >= 1000) return `${(gb / 1000).toFixed(2)} TB`;
  if (gb >= 10) return `${gb.toFixed(0)} GB`;
  if (gb >= 0.1) return `${gb.toFixed(1)} GB`;
  return `${(gb * 1000).toFixed(0)} MB`;
}

export function fmtRate(mbps: number): string {
  if (mbps >= 1) return `${mbps.toFixed(mbps >= 10 ? 0 : 2)} Mbps`;
  if (mbps > 0) return `${(mbps * 1000).toFixed(0)} kbps`;
  return '0';
}

export function fmtLat(deg: number): string {
  return `${Math.abs(deg).toFixed(3)}° ${deg < 0 ? 'S' : 'N'}`;
}

export function fmtLon(deg: number): string {
  return `${Math.abs(deg).toFixed(3)}° ${deg < 0 ? 'W' : 'E'}`;
}

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const cardinal = (azDeg: number): string => CARDINALS[Math.round((((azDeg % 360) + 360) % 360) / 45) % 8];

/** yyyy-mm-dd string from a UTC ms value, for <input type="date">. */
export const toDateInput = fmtDate;
export function fromDateInput(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
