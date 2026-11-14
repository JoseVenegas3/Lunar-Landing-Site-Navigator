/** Telemetry colouring follows the thresholds declared once in TELEMETRY_LIMITS. */
import { describe, expect, it } from 'vitest';
import { TELEMETRY_LIMITS as L, batteryTone, busTone, marginTone, sunTone } from '../telemetry';

describe('telemetry thresholds', () => {
  it('battery', () => {
    expect(batteryTone(100, false)).toBe('ok');
    expect(batteryTone(L.batteryWarnPct - 1, false)).toBe('warn');
    expect(batteryTone(L.batteryCritPct - 1, false)).toBe('crit');
    expect(batteryTone(90, true)).toBe('crit');
  });
  it('bus temperature: heaters at 0 degC, frozen at -20 degC', () => {
    expect(busTone(20)).toBe('ok');
    expect(busTone(-5)).toBe('warn');
    expect(busTone(-20)).toBe('crit');
  });
  it('link margin', () => {
    expect(marginTone(6)).toBe('ok');
    expect(marginTone(1)).toBe('warn');
    expect(marginTone(-1)).toBe('crit');
    expect(marginTone(null)).toBe('crit');
  });
  it('sunlight', () => {
    expect(sunTone(1)).toBe('ok');
    expect(sunTone(0.5)).toBe('warn');
    expect(sunTone(0)).toBe('crit');
  });
});
