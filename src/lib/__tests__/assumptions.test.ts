/**
 * v2.1 change 8, "improve or delete": the suitability index keeps only the
 * criteria whose range is anchored, the slope range is the stability angle of
 * the configured vehicle, and every assumption in the table says where it
 * comes from.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_TIPOVER, INDEX_CRITERIA, computeSOMRandomForestSiteScore, normaliseCriterion, staticStabilityDeg } from '../../engine';
import { ASSUMPTIONS } from '../../components/dashboard/AssumptionsTable';
import { EMERGENCY_HORIZON_DAYS, SYNODIC_MONTH_D } from '../../components/EmergencyFlow';

describe('suitability index ranges', () => {
  it('keeps only Earth view, sunlight, slope and FeO', () => {
    expect([...INDEX_CRITERIA].sort()).toEqual(['earthVisibility', 'feo', 'illumination', 'slope']);
  });
  it('scales the slope to the static stability angle of the vehicle', () => {
    const limit = staticStabilityDeg(DEFAULT_TIPOVER);
    expect(limit).toBeCloseTo((Math.atan2(2.0, 1.8) * 180) / Math.PI, 9);
    expect(normaliseCriterion('slope', 0, { slopeLimitDeg: limit })).toBe(1);
    expect(normaliseCriterion('slope', limit, { slopeLimitDeg: limit })).toBe(0);
    expect(normaliseCriterion('slope', limit / 2, { slopeLimitDeg: limit })).toBeCloseTo(0.5, 9);
  });
  it('a score over the four criteria covers about half of the published weight', () => {
    const s = computeSOMRandomForestSiteScore({ earthVisibility: 100, illumination: 100, slope: 0, feo: 20 }, 'synthesized', { slopeLimitDeg: 48 });
    expect(s.score).toBeCloseTo(100, 9);
    expect(s.coveragePct).toBeCloseTo((100 * (23.16 + 11.55 + 9.83 + 6.03)) / 97.37, 6);
  });
});

describe('model assumptions table', () => {
  it('every row has a value, a unit, an origin and where it is used', () => {
    expect(ASSUMPTIONS.length).toBeGreaterThanOrEqual(25);
    for (const r of ASSUMPTIONS) {
      expect(r.value.length, r.p[0]).toBeGreaterThan(0);
      expect(r.unit.length, r.p[0]).toBeGreaterThan(0);
      expect(r.where[0].length && r.where[1].length, r.p[0]).toBeTruthy();
      if (r.source) expect(r.source[0].length && r.source[1].length, r.p[0]).toBeTruthy();
    }
  });
  it('the emergency horizon is half a synodic month rounded up to whole days', () => {
    expect(SYNODIC_MONTH_D / 2).toBeCloseTo(14.77, 2);
    expect(EMERGENCY_HORIZON_DAYS).toBe(15);
  });
});
