/**
 * Derived analyses that are too slow to run on every keystroke: the suitability
 * score (it needs a shadow sweep of the window) and the 5 x 5 dispersion grid
 * (25 full mission evaluations). Both are debounced and time-sliced, and their
 * latest results are kept in a small store (the 3-D escape arrow reads the
 * grid from it).
 */
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import {
  DEFAULT_UNCERTAINTY, DEFAULT_WINDOW_CONFIG, DispersionCell, DispersionResult, EnsembleStats, LandingCandidate, MemberOutcome, MissionInput,
  MissionResult, STATE_RF_PHYSICAL, STATE_SUN, SiteMetrics, SiteScience, SiteScore, UncertaintyConfig, WindowConfig, WindowSearch,
  INDEX_CRITERIA, candidateTimes, computeHorizon, computeHorizonEnsemble, computeSOMRandomForestSiteScore, evaluateLandingCandidate, evaluateMission, feoAt, staticStabilityDeg,
  gravityAt, makeEllipseSweep, makeObserver, persistentShadowDistanceKm, psrDistanceKm, rankDispersion, relocatedXY, siteScience,
  summariseEnsemble, summariseWindowSearch,
} from '../engine';
import { useScience } from './science';
import { useCallback, useRef } from 'react';
import { ScenarioData } from './mission';
import { ScenarioKey, useApp } from './store';

interface Insights {
  score: Partial<Record<ScenarioKey, SiteScore>>;
  dispersion: Partial<Record<ScenarioKey, DispersionResult>>;
  /** Last landing-date search of each scenario and the input it was run for. */
  windows: Partial<Record<ScenarioKey, { search: WindowSearch; input: MissionInput }>>;
  windowConfig: WindowConfig;
  setScore: (k: ScenarioKey, s: SiteScore) => void;
  setDispersion: (k: ScenarioKey, d: DispersionResult | undefined) => void;
  setWindows: (k: ScenarioKey, search: WindowSearch, input: MissionInput) => void;
  setWindowConfig: (patch: Partial<WindowConfig>) => void;
}
export const useInsights = create<Insights>((set) => ({
  score: {},
  dispersion: {},
  windows: {},
  windowConfig: DEFAULT_WINDOW_CONFIG,
  setWindows: (k, search, input) => set((st) => ({ windows: { ...st.windows, [k]: { search, input } } })),
  setWindowConfig: (patch) => set((st) => ({ windowConfig: { ...st.windowConfig, ...patch } })),
  setScore: (k, s) => set((st) => ({ score: { ...st.score, [k]: s } })),
  setDispersion: (k, d) => set((st) => ({ dispersion: { ...st.dispersion, [k]: d } })),
}));

export interface PersistentShadow { distanceKm: number | null; shadowedPct: number }
/** Half-size of the local grid: the farthest a persistent shadow can be detected, km. */
export const SHADOW_SEARCH_KM = 8.2;

/** Farthest a permanently shadowed region is searched for in the PSR layer, km. */
export const PSR_SEARCH_KM = 20;

export interface SiteScoreView {
  score: SiteScore | null;
  metrics: SiteMetrics;
  /** Window-shadow proxy, only computed when the PSR layer is not loaded. */
  shadow: PersistentShadow | null;
  /** True when the PSR distance comes from the LOLA layer rather than the proxy. */
  psrFromLayer: boolean;
  /** No shadowed ground inside the search radius: the distance shown is a lower bound. */
  psrBeyond: boolean;
  /** Layer record of the candidate site, when the scenario uses one. */
  site: SiteScience | null;
}

/** Suitability score of a scenario. Slow parts run shortly after the inputs settle. */
export function useSiteScore(data: ScenarioData): SiteScoreView {
  const layers = useScience((s) => s.layers);
  const mode = useApp((s) => s.scoreMode);
  const science = useApp((s) => s.science[data.key]);
  const tipover = useApp((s) => s.tipover);
  const slopeLimitDeg = staticStabilityDeg(tipover);
  const setScore = useInsights((s) => s.setScore);
  const [shadow, setShadow] = useState<PersistentShadow | null>(null);
  const { dem, result } = data;

  // Without the PSR layer, fall back to "no sunlight during the analysed window".
  useEffect(() => {
    setShadow(null);
    if (!dem || !result || layers) return;
    const id = setTimeout(() => setShadow(persistentShadowDistanceKm(dem, result)), 250);
    return () => clearTimeout(id);
  }, [dem, result, layers]);

  const site = useMemo(() => (layers ? siteScience(layers, data.latDeg, data.lonDeg) : null), [layers, data.latDeg, data.lonDeg]);

  const view = useMemo(() => {
    if (!result) return { metrics: {} as SiteMetrics, psrBeyond: false };
    const obs = result.observer;
    let psr: number | null = null, psrBeyond = false;
    if (layers) {
      // 160 m mask at the actual lander position. The 20 m mask also holds hundreds of thousands of
      // crater-floor shadows a few tens of metres across, which sit within ~300 m of every site and
      // would make this criterion the same everywhere; those are reported separately, not scored.
      const d = psrDistanceKm(layers, obs.x, obs.y, PSR_SEARCH_KM);
      psrBeyond = d === null;
      psr = d ?? PSR_SEARCH_KM;
    } else if (shadow) {
      psrBeyond = shadow.distanceKm === null;
      psr = shadow.distanceKm ?? SHADOW_SEARCH_KM;
    }
    // v2.1: only the criteria whose range is anchored (INDEX_CRITERIA) enter the index; the others are left out.
    const all: SiteMetrics = {
      earthVisibility: result.kpis.dtePct,
      illumination: result.kpis.illuminationPct,
      slope: result.kpis.slopeDeg,
      roughness: result.adv.kpis.roughnessM,
      psrProximity: psr,
      feo: layers ? feoAt(layers, obs.latDeg, obs.lonDeg) : null,
      gravity: layers ? gravityAt(layers, obs.x, obs.y) : null,
      hydrogen: science.hydrogen ?? null,
      geology: science.geology ?? null,
    };
    const metrics: SiteMetrics = Object.fromEntries(INDEX_CRITERIA.map((id) => [id, all[id] ?? null]));
    return { metrics, psrBeyond };
  }, [result, layers, shadow, science]);

  const score = useMemo(() => (result ? computeSOMRandomForestSiteScore(view.metrics, mode, { slopeLimitDeg }) : null), [result, view, mode, slopeLimitDeg]);
  useEffect(() => { if (score) setScore(data.key, score); }, [score, data.key, setScore]);
  return { score, metrics: view.metrics, shadow, psrFromLayer: layers !== null, psrBeyond: view.psrBeyond, site };
}

export const DISPERSION_RADIUS_M = 200;
export const DISPERSION_SIZE = 5;

/** 5 x 5 dispersion grid around the current lander position, evaluated in the background. */
export function useDispersion(data: ScenarioData, enabled: boolean): { result: DispersionResult | null; progress: number | null } {
  const setDispersion = useInsights((s) => s.setDispersion);
  const [result, setResult] = useState<DispersionResult | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const { dem, input, key } = data;

  useEffect(() => {
    if (!enabled || !dem || !input) return;
    let cancelled = false;
    setProgress(0);
    const start = setTimeout(() => {
      const cells: DispersionCell[] = [];
      const step = (2 * DISPERSION_RADIUS_M) / (DISPERSION_SIZE - 1);
      const total = DISPERSION_SIZE * DISPERSION_SIZE;
      const windowHours = input.days * 24;
      const tick = (): void => {
        if (cancelled) return;
        const t0 = performance.now();
        while (cells.length < total && performance.now() - t0 < 30) {
          const k = cells.length;
          const eastM = -DISPERSION_RADIUS_M + (k % DISPERSION_SIZE) * step;
          const northM = -DISPERSION_RADIUS_M + Math.floor(k / DISPERSION_SIZE) * step;
          const at = { ...input, dxM: input.dxM + eastM, dyM: input.dyM + northM };
          const [x, y] = relocatedXY(at.latDeg, at.lonDeg, at.dxM, at.dyM);
          const r = evaluateMission(dem, at, computeHorizon(dem, makeObserver(dem, x, y, at.mastM)));
          cells.push({
            eastM, northM, merit: 0,
            survivalHours: r.adv.kpis.survivalHours,
            linkPct: r.adv.kpis.rfAvailabilityPct,
            energyWh: r.kpis.energyWh,
            lost: !r.kpis.survives,
          });
        }
        if (cells.length < total) {
          setProgress(cells.length / total);
          setTimeout(tick, 0);
          return;
        }
        const ranked = rankDispersion(cells, DISPERSION_SIZE, DISPERSION_RADIUS_M, windowHours);
        setResult(ranked);
        setDispersion(key, ranked);
        setProgress(null);
      };
      tick();
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(start);
    };
  }, [enabled, dem, input, key, setDispersion]);

  return { result: enabled ? result : null, progress: enabled ? progress : null };
}

// ------------------------------------------------------------ uncertainty

/** What the statistics keep from one ensemble member. */
export function memberOutcome(r: MissionResult): MemberOutcome {
  const flags = new Uint8Array(r.count);
  for (let i = 0; i < r.count; i++) flags[i] = ((r.state[i] & STATE_SUN) ? 1 : 0) | ((r.state[i] & STATE_RF_PHYSICAL) ? 2 : 0);
  return {
    illuminationPct: r.kpis.illuminationPct, dtePct: r.kpis.dtePct, downlinkPct: r.adv.kpis.rfAvailabilityPct,
    energyWh: r.kpis.energyWh, dataGb: r.kpis.dataGb, survivalHours: r.adv.kpis.survivalHours, survives: r.kpis.survives, flags,
  };
}

/** Members used per cell when the whole dispersion grid is analysed (25 cells). */
export const CELL_MEMBERS = 10;

export interface UncertaintyView {
  config: UncertaintyConfig;
  setConfig: (patch: Partial<UncertaintyConfig>) => void;
  /** Statistics of the ensemble at the lander position, or null before a run. */
  stats: EnsembleStats | null;
  /** Probability of surviving the window in each dispersion cell (row-major, south row first), or null. */
  cellSurvival: number[] | null;
  progress: number | null;
  /** True when the inputs changed after the last run. */
  stale: boolean;
  run: () => void;
  runCells: () => void;
}

/** Terrain-uncertainty ensemble of a scenario, run on demand in the background. */
export function useUncertainty(data: ScenarioData): UncertaintyView {
  const [config, setConfigState] = useState<UncertaintyConfig>(DEFAULT_UNCERTAINTY);
  const [stats, setStats] = useState<EnsembleStats | null>(null);
  const [cellSurvival, setCellSurvival] = useState<number[] | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [ranFor, setRanFor] = useState<unknown>(null);
  const token = useRef(0);
  const { dem, input, result } = data;

  const setConfig = useCallback((patch: Partial<UncertaintyConfig>) => setConfigState((c) => ({ ...c, ...patch })), []);

  // A relocation or a hardware change invalidates what is on screen.
  useEffect(() => { token.current++; setProgress(null); }, [input, dem]);

  const run = useCallback(() => {
    if (!dem || !input || !result) return;
    const my = ++token.current;
    const ens = computeHorizonEnsemble(dem, result.horizon, config);
    const outcomes: MemberOutcome[] = [];
    setProgress(0);
    const tick = (): void => {
      if (token.current !== my) return;
      const t0 = performance.now();
      while (outcomes.length < config.members && performance.now() - t0 < 30) {
        outcomes.push(memberOutcome(evaluateMission(dem, input, ens.member(outcomes.length))));
      }
      if (outcomes.length < config.members) {
        setProgress(outcomes.length / config.members);
        setTimeout(tick, 0);
        return;
      }
      setStats(summariseEnsemble(outcomes));
      setRanFor(input);
      setProgress(null);
    };
    setTimeout(tick, 0);
  }, [dem, input, result, config]);

  const runCells = useCallback(() => {
    if (!dem || !input) return;
    const my = ++token.current;
    const step = (2 * DISPERSION_RADIUS_M) / (DISPERSION_SIZE - 1);
    const total = DISPERSION_SIZE * DISPERSION_SIZE;
    const p: number[] = [];
    let cell = 0, k = 0, alive = 0;
    let ens: ReturnType<typeof computeHorizonEnsemble> | null = null;
    let at = input;
    setProgress(0);
    const tick = (): void => {
      if (token.current !== my) return;
      const t0 = performance.now();
      while (cell < total && performance.now() - t0 < 30) {
        if (!ens) {
          at = { ...input, dxM: input.dxM - DISPERSION_RADIUS_M + (cell % DISPERSION_SIZE) * step, dyM: input.dyM - DISPERSION_RADIUS_M + Math.floor(cell / DISPERSION_SIZE) * step };
          const [x, y] = relocatedXY(at.latDeg, at.lonDeg, at.dxM, at.dyM);
          ens = computeHorizonEnsemble(dem, computeHorizon(dem, makeObserver(dem, x, y, at.mastM)), { ...config, members: CELL_MEMBERS });
          k = 0; alive = 0;
        }
        if (evaluateMission(dem, at, ens.member(k)).kpis.survives) alive++;
        if (++k === CELL_MEMBERS) { p.push(alive / CELL_MEMBERS); cell++; ens = null; }
      }
      if (cell < total) {
        setProgress((cell + k / CELL_MEMBERS) / total);
        setTimeout(tick, 0);
        return;
      }
      setCellSurvival(p);
      setRanFor(input);
      setProgress(null);
    };
    setTimeout(tick, 0);
  }, [dem, input, config]);

  return { config, setConfig, stats, cellSurvival, progress, stale: ranFor !== null && ranFor !== input, run, runCells };
}

// --------------------------------------------------------- landing windows

/** True when two mission inputs differ only in their dates. */
function sameButDates(a: MissionInput, b: MissionInput): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof MissionInput>;
  for (const k of keys) {
    if (k === 'startMs' || k === 'days') continue;
    if (a[k] !== b[k]) return false;
  }
  return true;
}

export interface LandingWindowsView {
  config: WindowConfig;
  setConfig: (patch: Partial<WindowConfig>) => void;
  search: WindowSearch | null;
  progress: number | null;
  /** True when the site or the hardware changed after the last search (a new date alone does not count). */
  stale: boolean;
  run: () => void;
}

/** Landing-date search of a scenario, run on demand in the background from the scenario's start date. */
export function useLandingWindows(data: ScenarioData): LandingWindowsView {
  const config = useInsights((s) => s.windowConfig);
  const setConfig = useInsights((s) => s.setWindowConfig);
  const last = useInsights((s) => s.windows[data.key]);
  const setWindows = useInsights((s) => s.setWindows);
  const [progress, setProgress] = useState<number | null>(null);
  const token = useRef(0);
  const { dem, input, result, key } = data;

  useEffect(() => () => { token.current++; }, []);

  const run = useCallback(() => {
    if (!dem || !input || !result) return;
    const my = ++token.current;
    const horizon = result.horizon;
    const sweep = makeEllipseSweep(dem, horizon, config.ellipseRadiusM);
    const times = candidateTimes(input.startMs, config);
    const done: LandingCandidate[] = [];
    setProgress(0);
    const tick = (): void => {
      if (token.current !== my) return;
      const t0 = performance.now();
      while (done.length < times.length && performance.now() - t0 < 30) {
        done.push(evaluateLandingCandidate(dem, input, horizon, times[done.length], config, sweep));
      }
      if (done.length < times.length) {
        setProgress(done.length / times.length);
        setTimeout(tick, 0);
        return;
      }
      setWindows(key, summariseWindowSearch(done, config), input);
      setProgress(null);
    };
    setTimeout(tick, 0);
  }, [dem, input, result, config, key, setWindows]);

  return {
    config, setConfig, search: last?.search ?? null, progress,
    stale: !!last && !!input && !sameButDates(last.input, input), run,
  };
}
