/**
 * Every tutorial scenario still meets its condition with the current engine
 * (v3.0). If the engine changes and a story no longer holds, this fails:
 * run `npm run find-scenarios` and review the script.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { checkBadDate, checkFirstLanding, checkMast, checkRelay, fly, im1Attitude, inputFor, slopeAt } from '../scenarioCheck';
import { TUTORIAL_SCENARIOS as SC } from '../scenarios';
import { OfflineData, loadOffline } from '../../../scripts/tutorialData';
import { SLOPE_STOPS } from '../../components/3d/Terrain';

let data: OfflineData;
const site = (id: string) => {
  const s = data.sites.find((x) => x.siteId === id);
  if (!s) throw new Error(`no offline terrain for ${id}`);
  return s;
};

beforeAll(() => { data = loadOffline(); });

describe('tutorial scenarios, re-checked with the engine', () => {
  it('every scenario uses a site whose 20 m terrain ships with the app (no network)', () => {
    for (const k of ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm7'] as const) expect(() => site(SC[k].siteId)).not.toThrow();
  });

  it('mission 0: low Sun at touchdown, best array power later the same day, Earth link open then and closing within a day', () => {
    const s = site(SC.m0.siteId);
    const c = checkFirstLanding(fly(s.dem, inputFor(s, data.layers, { startMs: SC.m0.startMs, days: 3 })));
    expect(c.ok).toBe(true);
    expect(c.bestHour).toBe(SC.m0.bestHour);
  });

  it('mission 1: no sunlight and no Earth link on the requested date, landing windows in the next 60 days', () => {
    const s = site(SC.m1.siteId);
    const input = inputFor(s, data.layers, { startMs: SC.m1.startMs, days: 14 });
    const c = checkBadDate(s.dem, input, fly(s.dem, input));
    expect(c.ok).toBe(true);
  }, 120_000);

  it('mission 2: the aim point is red on the slope map and level ground is within 150 m', () => {
    const s = site(SC.m2.siteId);
    const a = slopeAt(s.dem, s, SC.m2.dxM, SC.m2.dyM), b = slopeAt(s.dem, s, SC.m2.safeDxM, SC.m2.safeDyM);
    expect(a.slopeDeg).toBeGreaterThan(SLOPE_STOPS[3][0]);
    expect(b.slopeDeg).toBeLessThan(SLOPE_STOPS[1][0]);
    expect(b.tipP).toBeLessThan(0.01);
    expect(Math.hypot(SC.m2.safeDxM - SC.m2.dxM, SC.m2.safeDyM - SC.m2.dyM)).toBeLessThanOrEqual(150);
  });

  it('mission 3: on the deck the battery freezes, on the 10 m mast the lander survives', () => {
    const s = site(SC.m3.siteId);
    const low = fly(s.dem, inputFor(s, data.layers, { startMs: SC.m3.startMs, days: 14, mastM: 2 }));
    const high = fly(s.dem, inputFor(s, data.layers, { startMs: SC.m3.startMs, days: 14, mastM: 10 }));
    expect(checkMast(low, high).ok).toBe(true);
  });

  it('mission 4: the Earth is hidden half the window or more, and the relay restores the link', () => {
    const s = site(SC.m4.siteId);
    const direct = fly(s.dem, inputFor(s, data.layers, { startMs: SC.m4.startMs, days: 14 }));
    const relay = fly(s.dem, inputFor(s, data.layers, { startMs: SC.m4.startMs, days: 14, relay: { enabled: true } }));
    expect(checkRelay(direct, relay).ok).toBe(true);
  });

  it('mission 5: the IM-1 tilt with a fixed antenna cuts the downlink; the gimbal range found brings it back', () => {
    const s = site(SC.m5.siteId);
    const run = (g: number, tilt: boolean) => fly(s.dem, inputFor(s, data.layers, { startMs: SC.m5.startMs, days: 14, attitude: tilt ? { ...im1Attitude(), gimbalRangeDeg: g } : undefined })).adv.kpis.rfAvailabilityPct;
    const n = run(20, false), cut = run(0, true), fixed = run(SC.m5.gimbalDeg, true);
    expect(cut).toBeLessThanOrEqual(0.5 * n);
    expect(fixed).toBeGreaterThanOrEqual(0.9 * n);
  });

  it('mission 7: from the fixed "now" the lander is lost as declared, and moving within 500 m saves it', () => {
    const s = site(SC.m7.siteId);
    const base = fly(s.dem, inputFor(s, data.layers, { startMs: SC.m7.nowMs, days: SC.m7.days }));
    expect(base.kpis.survives).toBe(false);
    const m = SC.m7.move;
    expect(m).not.toBeNull();
    expect(Math.hypot(m!.eastM, m!.northM)).toBeLessThanOrEqual(500);
    const moved = fly(s.dem, inputFor(s, data.layers, { startMs: SC.m7.nowMs, days: SC.m7.days, dxM: m!.eastM, dyM: m!.northM }));
    expect(moved.kpis.survives).toBe(true);
  });
});
