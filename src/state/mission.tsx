/**
 * Mission context: turns the two scenario configurations into engine results
 * and shares them with every panel.
 */
import { ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  DemStack, Grid, HorizonProfile, MissionInput, MissionResult, computeHorizon, evaluateMission, makeObserver, relocatedXY, siteScience,
} from '../engine';
import { StreamStatus, TerrainKind, ensureLocal, getLocal, getRegional, localKey, localSourceResolutionM, terrainKind, useTerrainStream } from './dem';
import { useScience } from './science';
import { ScenarioKey, scenarioLatLon, useApp } from './store';

export interface ScenarioData {
  key: ScenarioKey;
  name: string;
  short: string;
  /** Nominal coordinates (before relocation). */
  latDeg: number;
  lonDeg: number;
  dem: DemStack | null;
  result: MissionResult | null;
  /** The exact input behind `result`, for panels that re-evaluate around it. */
  input: MissionInput | null;
  /** 0..1 while the local DEM is being loaded, null when ready. */
  loading: number | null;
  /** Where the terrain comes from, and the pixel size (m) of the data under this site. */
  terrain: TerrainKind;
  terrainResolutionM: number | null;
  /** State of the on-demand 20 m patch of this point (undefined before the first load). */
  stream: StreamStatus | undefined;
  /** Share of the local grid that holds 20 m data, percent. */
  streamCoveragePct: number | null;
}

const MissionContext = createContext<Record<ScenarioKey, ScenarioData> | null>(null);

function useScenarioData(key: ScenarioKey): ScenarioData {
  // Without a comparison B mirrors A (no terrain of its own to load) and is not evaluated.
  const enabled = useApp((s) => key === 'A' || s.compare);
  const cfg = useApp((s) => (enabled ? s.scenarios[key] : s.scenarios.A));
  const power = useApp((s) => s.power);
  const rf = useApp((s) => s.rf);
  const relay = useApp((s) => s.relay);
  const attitude = useApp((s) => s.attitude);
  const thermal = useApp((s) => s.thermal);
  const thermalOn = useApp((s) => s.thermalOn);
  const asset = useApp((s) => s.asset);
  const layers = useScience((s) => s.layers);
  const mastM = useApp((s) => s.mastM);
  const { latDeg, lonDeg, name, short } = scenarioLatLon(cfg);

  const tKey = localKey(latDeg, lonDeg);
  const gridVersion = useTerrainStream((s) => s.version[tKey] ?? 0);
  const stream = useTerrainStream((s) => s.status[tKey]);
  const streamCoverage = useTerrainStream((s) => s.coverage[tKey]);
  const [local, setLocal] = useState<Grid | null>(() => getLocal(latDeg, lonDeg));
  const [loading, setLoading] = useState<number | null>(local ? null : 0);

  useEffect(() => {
    let alive = true;
    const ready = getLocal(latDeg, lonDeg);
    if (ready) {
      setLocal(ready);
      setLoading(null);
      return;
    }
    setLoading(0);
    void ensureLocal(latDeg, lonDeg, (f) => { if (alive) setLoading(f); }).then((g) => {
      if (!alive) return;
      setLocal(g);
      setLoading(null);
    });
    return () => { alive = false; };
    // gridVersion: the 20 m patch replaced the coarse grid of this point.
  }, [latDeg, lonDeg, gridVersion]);

  const dem = useMemo<DemStack | null>(() => {
    const regional = getRegional();
    if (!regional || !local) return null;
    // Guard against a stale grid from the previously selected site.
    const centre = local.x0 + ((local.n - 1) / 2) * local.spacingKm;
    const [cx] = relocatedXY(latDeg, lonDeg, 0, 0);
    if (Math.abs(centre - cx) > 1e-6) return null;
    return { regional, local };
  }, [local, latDeg, lonDeg]);

  const horizon = useMemo<HorizonProfile | null>(() => {
    if (!dem) return null;
    const [x, y] = relocatedXY(latDeg, lonDeg, cfg.dxM, cfg.dyM);
    return computeHorizon(dem, makeObserver(dem, x, y, mastM));
  }, [dem, latDeg, lonDeg, cfg.dxM, cfg.dyM, mastM]);

  // At a candidate site the sunlit sink temperature of the thermal model is the annual
  // maximum surface temperature measured by Diviner there, instead of the generic default.
  const siteThermal = useMemo(() => {
    const rec = layers ? siteScience(layers, latDeg, lonDeg) : null;
    return rec ? { ...thermal, envLitK: Math.min(400, Math.max(thermal.envDarkK + 10, rec.diviner.tMaxK)) } : thermal;
  }, [layers, latDeg, lonDeg, thermal]);

  const input = useMemo<MissionInput | null>(() => (dem && enabled ? {
    latDeg, lonDeg, dxM: cfg.dxM, dyM: cfg.dyM, startMs: cfg.startMs, days: cfg.days, stepHours: 1, mastM, power, rf, relay,
    attitude, thermal: thermalOn ? siteThermal : null, asset,
  } : null), [enabled, dem, latDeg, lonDeg, cfg.dxM, cfg.dyM, cfg.startMs, cfg.days, mastM, power, rf, relay, attitude, siteThermal, thermalOn, asset]);

  const result = useMemo<MissionResult | null>(() => {
    if (!dem || !horizon || !input) return null;
    return evaluateMission(dem, input, horizon);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dem, horizon, input]);

  return {
    key, name, short, latDeg, lonDeg, dem, result, input, loading: dem ? null : loading ?? 0,
    terrain: terrainKind(), terrainResolutionM: dem ? localSourceResolutionM(latDeg, lonDeg) : null,
    stream, streamCoveragePct: streamCoverage ?? null,
  };
}

export function MissionProvider({ children }: { children: ReactNode }) {
  const A = useScenarioData('A');
  const B = useScenarioData('B');
  const value = useMemo(() => ({ A, B }), [A, B]);
  return <MissionContext.Provider value={value}>{children}</MissionContext.Provider>;
}

export function useMission(): Record<ScenarioKey, ScenarioData> {
  const ctx = useContext(MissionContext);
  if (!ctx) throw new Error('useMission must be used inside MissionProvider');
  return ctx;
}

export function useActiveScenario(): ScenarioData {
  const active = useApp((s) => s.active);
  return useMission()[active];
}

/** Sample index of a result for the shared cursor (fractional). */
export function cursorIndex(result: { count: number; stepHours: number }, cursorHours: number): number {
  return Math.max(0, Math.min(result.count - 1, cursorHours / result.stepHours));
}

/**
 * Cursor value for React rendering, throttled to ~12 Hz. Canvases and the 3-D
 * scene read the store directly every frame instead.
 */
export function useThrottledCursor(): number {
  const [value, setValue] = useState(() => useApp.getState().cursorHours);
  useEffect(() => {
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useApp.subscribe((s, prev) => {
      if (s.cursorHours === prev.cursorHours) return;
      const now = performance.now();
      if (now - last > 80) {
        last = now;
        setValue(s.cursorHours);
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          last = performance.now();
          setValue(useApp.getState().cursorHours);
        }, 90);
      }
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, []);
  return value;
}
