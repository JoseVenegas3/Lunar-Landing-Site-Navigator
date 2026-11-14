/** Orbital science layers in public/science/ (built by scripts/fetch_science_layers.py). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CANDIDATE_SITES, CRITERIA, ScienceLayers, ScienceManifest, computeSOMRandomForestSiteScore, decodeScienceLayers, feoAt, gravityAt,
  inPsr, latLonToXY, psrDistanceKm, siteScience,
} from '../index';

describe('orbital science layers', () => {
  let layers: ScienceLayers;

  beforeAll(() => {
    const dir = join(process.cwd(), 'public', 'science');
    const buf = (file: string): ArrayBuffer => {
      const b = readFileSync(join(dir, file));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    };
    const manifest = JSON.parse(readFileSync(join(dir, 'layers.json'), 'utf8')) as ScienceManifest;
    layers = decodeScienceLayers(manifest, buf(manifest.layers.psr.file), buf(manifest.layers.gravity.file));
  });

  it('rejects assets of the wrong size', () => {
    expect(() => decodeScienceLayers(layers.manifest, new ArrayBuffer(10), layers.gravity.buffer as ArrayBuffer)).toThrow();
    expect(() => decodeScienceLayers(layers.manifest, layers.psrMask.buffer as ArrayBuffer, new ArrayBuffer(12))).toThrow();
  });

  it('places the permanently shadowed regions where they are known to be', () => {
    const at = (lat: number, lon: number): [number, number] => latLonToXY(lat, lon);
    // Floors of Shackleton and Haworth are permanently shadowed; the ridge crest is not.
    expect(inPsr(layers, ...at(-89.67, 129.78))).toBe(true);
    expect(inPsr(layers, ...at(-87.45, -5.17))).toBe(true);
    expect(psrDistanceKm(layers, ...at(-87.45, -5.17))).toBe(0);
    const ridge = CANDIDATE_SITES[0];
    const [rx, ry] = at(ridge.latDeg, ridge.lonDeg);
    expect(inPsr(layers, rx, ry)).toBe(false);
    const d = psrDistanceKm(layers, rx, ry);
    expect(d).not.toBeNull();
    expect(d as number).toBeGreaterThan(0.1);
    expect(d as number).toBeLessThan(12);
    // A tight search radius that excludes it returns null rather than a wrong distance.
    expect(psrDistanceKm(layers, rx, ry, 0.05)).toBeNull();
    // Off the cap there is no answer.
    expect(psrDistanceKm(layers, 400, 400)).toBeNull();
    // Roughly a tenth of the cap is permanently shadowed.
    let set = 0;
    const n = layers.manifest.layers.psr.n;
    for (let k = 0; k < n * n; k += 97) if ((layers.psrMask[k >> 3] >> (7 - (k & 7))) & 1) set++;
    const share = (100 * set) / Math.ceil((n * n) / 97);
    expect(Math.abs(share - layers.manifest.layers.psr.capPsrPct)).toBeLessThan(1);
    expect(share).toBeGreaterThan(4);
    expect(share).toBeLessThan(20);
  });

  it('returns highland FeO and massif gravity at the candidate sites', () => {
    for (const s of CANDIDATE_SITES) {
      const rec = siteScience(layers, s.latDeg, s.lonDeg);
      expect(rec, s.id).not.toBeNull();
      const feo = feoAt(layers, s.latDeg, s.lonDeg);
      // Polar highlands are anorthositic: a few weight percent FeO, far from the ~20 % of the maria.
      expect(feo).not.toBeNull();
      expect(feo as number).toBeGreaterThan(2);
      expect(feo as number).toBeLessThan(10);
      expect(feo).toBeCloseTo(rec?.feoWtPct as number, 6);
      const [x, y] = latLonToXY(s.latDeg, s.lonDeg);
      const g = gravityAt(layers, x, y);
      expect(g).not.toBeNull();
      // The 5 km grid smooths the 16 px/deg map a little.
      expect(Math.abs((g as number) - (rec?.gravityMgal as number))).toBeLessThan(60);
      // Diviner: polar surface temperatures, and the triangle found is the one under the site.
      expect(rec?.diviner.tAvgK).toBeGreaterThan(60);
      expect(rec?.diviner.tAvgK).toBeLessThan(200);
      expect(rec?.diviner.tMaxK).toBeGreaterThan(rec?.diviner.tAvgK as number);
      expect(rec?.diviner.tMaxK).toBeLessThan(330);
      expect(rec?.diviner.offsetKm).toBeLessThan(0.5);
    }
    // Free-air anomaly follows topography: the 5-6 km massifs stand out against the ridge.
    const g = (i: number): number => layers.manifest.sites[CANDIDATE_SITES[i].id].gravityMgal;
    expect(g(1)).toBeGreaterThan(g(0) + 200); // Malapert vs Shackleton ridge
    expect(g(3)).toBeGreaterThan(g(0) + 200); // Mons Mouton vs Shackleton ridge
    expect(feoAt(layers, -60, 0)).toBeNull();
    expect(gravityAt(layers, 900, 0)).toBeNull();
    expect(siteScience(layers, -88.123, 10)).toBeNull();
  });

  it('raises the share of the score that rests on data to 80 %', () => {
    const s = CANDIDATE_SITES[0];
    const [x, y] = latLonToXY(s.latDeg, s.lonDeg);
    const score = computeSOMRandomForestSiteScore({
      earthVisibility: 42, illumination: 84, slope: 0.8, roughness: 60,
      psrProximity: psrDistanceKm(layers, x, y) ?? 20, feo: feoAt(layers, s.latDeg, s.lonDeg), gravity: gravityAt(layers, x, y),
    });
    const total = CRITERIA.reduce((a, c) => a + c.weightPct, 0);
    expect(score.coveragePct).toBeCloseTo((100 * (total - 13.65 - 5.81)) / total, 6);
    expect(score.rows.filter((r) => !r.available).map((r) => r.id)).toEqual(['hydrogen', 'geology']);
    expect(CRITERIA.filter((c) => c.source === 'layer').map((c) => c.id)).toEqual(['psrProximity', 'feo', 'gravity']);
  });
});
