/**
 * Site catalogue (v2.1, change 6): every selectable site has valid
 * coordinates inside the 80–90 S coverage of the terrain model; missions north
 * of it are reference markers only; no duplicates.
 */
import { describe, expect, it } from 'vitest';
import { ALL_SITES, CUSTOM_LAT_MAX, CUSTOM_LAT_MIN, MISSION_SITES, REFERENCE_MARKERS, inCoverage, latLonToXY } from '..';

describe('site catalogue', () => {
  it('every selectable site has a finite latitude and longitude in range and inside the 80–90 S coverage', () => {
    for (const s of ALL_SITES) {
      expect(Number.isFinite(s.latDeg) && Number.isFinite(s.lonDeg), s.name).toBe(true);
      expect(s.lonDeg, s.name).toBeGreaterThanOrEqual(-180);
      expect(s.lonDeg, s.name).toBeLessThanOrEqual(180);
      expect(s.latDeg, s.name).toBeGreaterThanOrEqual(CUSTOM_LAT_MIN);
      expect(s.latDeg, s.name).toBeLessThanOrEqual(CUSTOM_LAT_MAX);
      expect(inCoverage(s.latDeg), s.name).toBe(true);
    }
  });

  it('missions outside the coverage are not selectable', () => {
    expect(REFERENCE_MARKERS.find((m) => m.id === 'chandrayaan-3')?.latDeg).toBeCloseTo(-69.37, 2);
    for (const m of REFERENCE_MARKERS) {
      expect(inCoverage(m.latDeg), m.name).toBe(false);
      expect(ALL_SITES.some((s) => s.id === m.id), m.name).toBe(false);
    }
  });

  it('ids and names are unique, names are full (no bare codes), and no two sites share a point', () => {
    expect(new Set(ALL_SITES.map((s) => s.id)).size).toBe(ALL_SITES.length);
    expect(new Set(ALL_SITES.map((s) => s.name.toLowerCase())).size).toBe(ALL_SITES.length);
    for (const s of ALL_SITES) expect(s.name.length, s.id).toBeGreaterThan(4);
    for (let i = 0; i < ALL_SITES.length; i++) {
      for (let j = i + 1; j < ALL_SITES.length; j++) {
        const [x0, y0] = latLonToXY(ALL_SITES[i].latDeg, ALL_SITES[i].lonDeg);
        const [x1, y1] = latLonToXY(ALL_SITES[j].latDeg, ALL_SITES[j].lonDeg);
        expect(Math.hypot(x1 - x0, y1 - y0), `${ALL_SITES[i].name} / ${ALL_SITES[j].name}`).toBeGreaterThan(1);
      }
    }
  });

  it('longitudes given in 0–360° E are converted to the −180…180 convention of the catalogue', () => {
    const cabeus = MISSION_SITES.find((s) => s.id === 'artemis-cabeus-b-peak');
    expect(cabeus?.lonDeg).toBeCloseTo(292.335 - 360, 6);
    expect(MISSION_SITES.find((s) => s.id === 'ilrs-base')?.lonDeg).toBeCloseTo(-3, 6);
    expect(MISSION_SITES.filter((s) => s.group === 'artemis').every((s) => s.approximate)).toBe(true);
  });
});
