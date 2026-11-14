/**
 * Regression against NASA/JPL Horizons.
 *
 * The fixtures in data/horizons/ were exported with scripts/fetch_jpl_horizons.py
 * (observer tables, airless apparent azimuth/elevation from a lunar surface
 * site). The test runs offline against those caches.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bodyFixedVectors, siteFrame, topocentric, wrap180 } from '../index';

interface Row { ms: number; az: number; el: number; range_km: number }
interface Cache { site: { lat_deg: number; lon_deg: number; height_km: number }; sun: Row[]; earth: Row[] }

const dir = join(process.cwd(), 'data', 'horizons');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

describe('ephemeris engine vs JPL Horizons', () => {
  it('has reference caches to compare against', () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  for (const file of files) {
    it(`matches Horizons within 0.01 deg for ${file}`, () => {
      const cache = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Cache;
      const frame = siteFrame(cache.site.lat_deg, cache.site.lon_deg, cache.site.height_km);
      for (const body of ['sun', 'earth'] as const) {
        expect(cache[body].length).toBeGreaterThan(700);
        let maxAz = 0, maxEl = 0, maxRange = 0;
        for (const row of cache[body]) {
          const v = bodyFixedVectors(row.ms)[body];
          const p = topocentric(v[0], v[1], v[2], frame);
          maxAz = Math.max(maxAz, Math.abs(wrap180(p.azDeg - row.az)) * Math.cos((row.el * Math.PI) / 180));
          maxEl = Math.max(maxEl, Math.abs(p.elDeg - row.el));
          maxRange = Math.max(maxRange, Math.abs(p.rangeKm - row.range_km) / row.range_km);
        }
        // 0.01 deg = 36 arcsec, well inside the sub-arcminute requirement.
        expect(maxAz).toBeLessThan(0.01);
        expect(maxEl).toBeLessThan(0.01);
        expect(maxRange).toBeLessThan(2e-4);
      }
    });
  }
});
