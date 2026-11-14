/** The verification matrix and the exports, run against a real mission on LOLA terrain. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CANDIDATE_SITES, DEFAULT_ASSET, DEFAULT_POWER, DEFAULT_RF, DEFAULT_THERMAL, DemManifest, MissionResult, NOMINAL_ATTITUDE,
  computeSOMRandomForestSiteScore, decodeGrid, evaluateMission, latLonToXY,
} from '../../engine';
import { TELEMETRY_COLUMNS, buildTelemetryCsv, exportStem } from '../export';
import { buildVerificationMatrix } from '../verification';

describe('verification matrix and exports', () => {
  let mission: MissionResult;

  beforeAll(() => {
    const dir = join(process.cwd(), 'public', 'dem');
    const load = (file: string): ArrayBuffer => {
      const b = readFileSync(join(dir, file));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    };
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as DemManifest;
    const site = CANDIDATE_SITES[3]; // Nobile / Mons Mouton: long nights, a thermal case
    const info = manifest.sites.find((s) => s.id === site.id);
    if (!info) throw new Error('missing site grid');
    const [cx, cy] = latLonToXY(site.latDeg, site.lonDeg);
    const dem = { regional: decodeGrid(load(manifest.regional.file), manifest.regional), local: decodeGrid(load(info.file), info, cx, cy) };
    mission = evaluateMission(dem, {
      latDeg: site.latDeg, lonDeg: site.lonDeg, dxM: 0, dyM: 0, startMs: Date.UTC(2028, 2, 1), days: 30, stepHours: 1, mastM: 2,
      power: DEFAULT_POWER, rf: DEFAULT_RF, attitude: { ...NOMINAL_ATTITUDE, rollDeg: 30 }, thermal: DEFAULT_THERMAL,
      asset: { ...DEFAULT_ASSET, enabled: true },
    });
  });

  it('has no failing requirement, with or without an active scenario', () => {
    const empty = buildVerificationMatrix({ result: null, score: null, dispersion: null });
    expect(empty.filter((r) => r.parent === null).map((r) => r.id)).toEqual(['SyR-P1', 'SyR-P2', 'SyR-P3', 'SyR-P4', 'SyR-P5']);
    expect(empty.filter((r) => r.parent !== null)).toHaveLength(11);
    expect(empty.filter((r) => r.status === 'FAIL')).toEqual([]);

    const score = computeSOMRandomForestSiteScore({ earthVisibility: mission.kpis.dtePct, illumination: mission.kpis.illuminationPct, slope: mission.kpis.slopeDeg });
    const live = buildVerificationMatrix({ result: mission, score, dispersion: null });
    expect(live.filter((r) => r.status === 'FAIL')).toEqual([]);
    const row = (id: string) => live.find((r) => r.id === id);
    expect(row('SyR-C1.1')?.evidence).toContain('2878 m');
    expect(row('SyR-C1.3')?.status).toBe('VERIFIED');
    expect(row('SyR-C3.1')?.evidence).toContain('6.03 dB');
    expect(row('SyR-C3.2')?.evidence).toContain('Goldstone');
    expect(row('SyR-C2.2')?.status).toBe('INSPECTION');
    // The science layers are not loaded, so the score cannot be fully verified: it must say so.
    expect(row('SyR-C5.1')?.status).toBe('PARTIAL');
    expect(row('SyR-P5')?.status).toBe('PARTIAL');
    expect(row('SyR-P1')?.status).toBe('VERIFIED');
  });

  it('exports one consistent CSV row per sample', () => {
    const csv = buildTelemetryCsv(mission, { site: 'Nobile', scenario: 'A' });
    const lines = csv.trimEnd().split('\n');
    const header = lines.findIndex((l) => l.startsWith('utc,'));
    expect(header).toBeGreaterThan(3);
    expect(lines[header].split(',')).toEqual([...TELEMETRY_COLUMNS]);
    const rows = lines.slice(header + 1);
    expect(rows).toHaveLength(mission.count);
    for (const r of [rows[0], rows[200], rows[rows.length - 1]]) expect(r.split(',')).toHaveLength(TELEMETRY_COLUMNS.length);
    expect(rows[0].startsWith('2028-03-01T00:00:00Z,0.00,')).toBe(true);
    expect(csv).toContain('doi:10.3847/PSJ/acf3e1');
    expect(csv).toContain('roll_deg=30');
  });

  it('names the export after the full site name', () => {
    expect(TELEMETRY_COLUMNS).toHaveLength(26);
    expect(exportStem('Nobile rim / Mons Mouton', mission)).toBe('clps_nobile-rim-mons-mouton_2028-03-01_30d');
    expect(exportStem('Cráter Shackleton', mission)).toBe('clps_crater-shackleton_2028-03-01_30d');
  });
});
