import { create } from 'zustand';
import {
  ALL_SITES, AssetConfig, AttitudeConfig, CANDIDATE_SITES, CriterionId, DEFAULT_ASSET, DEFAULT_POWER, DEFAULT_RELAY, DEFAULT_RF, DEFAULT_THERMAL,
  DEFAULT_TIPOVER, NOMINAL_ATTITUDE, PowerConfig, RELOCATION_LIMIT_M, RelayConfig, RfConfig, ThermalConfig, TipoverConfig, WeightMode, clamp,
} from '../engine';

export type ScenarioKey = 'A' | 'B';
export type AppMode = 'planner' | 'explorer' | 'triage';
export type Lang = 'en' | 'es';
export type OverlayKind = 'none' | 'insolation' | 'dte' | 'slope';
export type ViewKind = 'orbit' | 'top' | 'eye';
/** Workspace panels of the planner: at most one tab open per side, or none (minimised). */
export type LeftTab = 'sites' | 'hardware' | 'contingency';
export type RightTab = 'vitals' | 'compare' | 'windows' | 'energy' | 'link' | 'survival' | 'score';
export type BottomTab = 'timeline' | 'horizon' | 'thermal';
export type PanelId = LeftTab | RightTab | BottomTab;

/** Mission subsystem the planner console is set to. Each one brings its own panels, accent and 3-D emphasis. */
export type Subsystem = 'overview' | 'power' | 'comms' | 'terrain' | 'science';

export interface SubsystemDef {
  left: LeftTab[];
  right: RightTab[];
  bottom: BottomTab[];
  /** Coverage overlay switched on when the subsystem is selected. */
  overlay: OverlayKind;
  /** Accent colour of the console in this subsystem. */
  accent: string;
}

export const SUBSYSTEMS: Record<Subsystem, SubsystemDef> = {
  overview: { left: ['sites'], right: ['vitals', 'compare', 'windows'], bottom: ['timeline'], overlay: 'none', accent: '#10B981' },
  power: { left: ['hardware'], right: ['energy'], bottom: ['thermal', 'timeline'], overlay: 'insolation', accent: '#F59E0B' },
  comms: { left: ['hardware'], right: ['link'], bottom: ['horizon', 'timeline'], overlay: 'dte', accent: '#06B6D4' },
  terrain: { left: ['contingency'], right: ['survival'], bottom: ['horizon', 'timeline'], overlay: 'slope', accent: '#E2E8F0' },
  science: { left: ['sites'], right: ['score'], bottom: ['timeline'], overlay: 'none', accent: '#B49CFF' },
};
export const SUBSYSTEM_ORDER: Subsystem[] = ['overview', 'power', 'comms', 'terrain', 'science'];

/** Subsystem a panel is reached from: the current one when it has the panel, else the first that does. */
export function panelOwner(id: PanelId, current: Subsystem): Subsystem {
  const has = (s: Subsystem): boolean => {
    const d = SUBSYSTEMS[s];
    return (d.left as PanelId[]).includes(id) || (d.right as PanelId[]).includes(id) || (d.bottom as PanelId[]).includes(id);
  };
  return has(current) ? current : SUBSYSTEM_ORDER.find(has) ?? 'overview';
}
/** Science layers the engine cannot derive; entered per scenario by the user. */
export type ScienceInputs = Partial<Record<CriterionId, number>>;

export interface PanelState {
  leftTab: LeftTab | null;
  rightTab: RightTab | null;
  bottomTab: BottomTab | null;
  /** Instantaneous telemetry strip under the 3-D view. */
  telemetry: boolean;
  /** Legend of the 3-D view. */
  legend: boolean;
}

const EXPERT_KEY = 'clps.expert';
/** First-visit mission briefing: 'done' once it was taken or skipped. */
export const BRIEFING_KEY = 'clps.briefing';
const readFlag = (key: string): boolean => {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1'; } catch { return false; }
};
const writeFlag = (key: string, on: boolean): void => {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* storage unavailable */ }
};
const briefingDone = (): boolean => {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(BRIEFING_KEY) === 'done'; } catch { return true; }
};

const panelsFor = (s: Subsystem, keep?: PanelState): PanelState => ({
  leftTab: SUBSYSTEMS[s].left[0], rightTab: SUBSYSTEMS[s].right[0], bottomTab: SUBSYSTEMS[s].bottom[0],
  telemetry: keep?.telemetry ?? false, legend: keep?.legend ?? false,
});

/** Mission briefing tour: offer at first visit, a step index while it runs, or off. */
export type BriefingState = 'offer' | 'off' | number;

export interface ScenarioCfg {
  /** Candidate site id, or 'custom' for free coordinates. */
  siteId: string;
  customLat: number;
  customLon: number;
  /** Micro-relocation, metres east / north of the nominal point. */
  dxM: number;
  dyM: number;
  startMs: number;
  days: number;
}

export interface AppState {
  mode: AppMode;
  lang: Lang;
  scenarios: Record<ScenarioKey, ScenarioCfg>;
  /** Scenario shown in the 3-D view and the horizon panorama. */
  active: ScenarioKey;
  power: PowerConfig;
  rf: RfConfig;
  relay: RelayConfig;
  /** Landing attitude of the lander (shared by both scenarios). */
  attitude: AttitudeConfig;
  /** Coupled electro-thermal model and its switch. */
  thermal: ThermalConfig;
  thermalOn: boolean;
  /** Neighbouring surface asset. */
  asset: AssetConfig;
  /** Vehicle geometry and touchdown dispersions of the tip-over estimate. */
  tipover: TipoverConfig;
  scoreMode: WeightMode;
  science: Record<ScenarioKey, ScienceInputs>;
  /** Engineering level: every panel and control. Off shows the quick view. */
  expert: boolean;
  /** Sub-pixel terrain (LOLA + fractal micro-relief) hazard analysis. */
  microRelief: boolean;
  /** Mission subsystem the planner console is set to. */
  subsystem: Subsystem;
  /** Mission briefing tour. */
  briefing: BriefingState;
  mastM: number;
  /** Mission elapsed time of the shared cursor, hours from each window start. */
  cursorHours: number;
  playing: boolean;
  /** Playback rate, simulated hours per real second. */
  speed: number;
  overlay: OverlayKind;
  view: ViewKind;
  tourStep: number;
  panels: PanelState;

  setSubsystem: (s: Subsystem) => void;
  /** Show a panel, switching to a subsystem that has it when the current one does not. */
  openPanel: (id: PanelId) => void;
  /** Reopen a minimised side with the first panel of the current subsystem. */
  openSide: (side: 'left' | 'right' | 'bottom') => void;
  setPanels: (patch: Partial<PanelState>) => void;
  setMode: (m: AppMode) => void;
  setLang: (l: Lang) => void;
  setActive: (k: ScenarioKey) => void;
  updateScenario: (k: ScenarioKey, patch: Partial<ScenarioCfg>) => void;
  setRelocation: (k: ScenarioKey, dxM: number, dyM: number) => void;
  setPower: (patch: Partial<PowerConfig>) => void;
  setRf: (patch: Partial<RfConfig>) => void;
  setRelay: (patch: Partial<RelayConfig>) => void;
  setAttitude: (patch: Partial<AttitudeConfig>) => void;
  setThermal: (patch: Partial<ThermalConfig>) => void;
  setThermalOn: (on: boolean) => void;
  setAsset: (patch: Partial<AssetConfig>) => void;
  setTipover: (patch: Partial<TipoverConfig>) => void;
  setScoreMode: (m: WeightMode) => void;
  setScience: (k: ScenarioKey, id: CriterionId, value: number | null) => void;
  setExpert: (on: boolean) => void;
  setMicroRelief: (on: boolean) => void;
  setBriefing: (b: BriefingState) => void;
  setMast: (m: number) => void;
  setCursor: (hours: number) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  setOverlay: (o: OverlayKind) => void;
  setView: (v: ViewKind) => void;
  setTourStep: (n: number) => void;
}

/** Playback rates of the transport, simulated hours per real second. */
export const PLAYBACK_SPEEDS = [1, 24, 72] as const;

const DEFAULT_START = Date.UTC(2027, 8, 1); // southern-summer approach, 2027

export const maxCursorHours = (s: Pick<AppState, 'scenarios' | 'mode' | 'active'>): number =>
  (s.mode !== 'planner' ? s.scenarios[s.active].days : Math.max(s.scenarios.A.days, s.scenarios.B.days)) * 24;

export const useApp = create<AppState>((set) => ({
  mode: 'planner',
  lang: 'en',
  scenarios: {
    A: { siteId: CANDIDATE_SITES[0].id, customLat: -89.2, customLon: 140, dxM: 0, dyM: 0, startMs: DEFAULT_START, days: 60 },
    B: { siteId: CANDIDATE_SITES[1].id, customLat: -87.45, customLon: -5.12, dxM: 0, dyM: 0, startMs: DEFAULT_START, days: 60 },
  },
  active: 'A',
  power: DEFAULT_POWER,
  rf: DEFAULT_RF,
  relay: DEFAULT_RELAY,
  attitude: NOMINAL_ATTITUDE,
  thermal: DEFAULT_THERMAL,
  thermalOn: true,
  asset: DEFAULT_ASSET,
  tipover: DEFAULT_TIPOVER,
  scoreMode: 'synthesized',
  science: { A: {}, B: {} },
  expert: readFlag(EXPERT_KEY),
  microRelief: false,
  subsystem: 'overview',
  briefing: briefingDone() ? 'off' : 'offer',
  mastM: 2,
  cursorHours: 96,
  playing: false,
  speed: 24,
  overlay: 'none',
  view: 'orbit',
  tourStep: 0,
  panels: panelsFor('overview'),

  setSubsystem: (subsystem) => set((s) => (s.subsystem === subsystem ? {} : {
    subsystem, panels: panelsFor(subsystem, s.panels), overlay: SUBSYSTEMS[subsystem].overlay,
  })),
  openPanel: (id) => set((s) => {
    const subsystem = panelOwner(id, s.subsystem);
    const switched = subsystem !== s.subsystem;
    const base = switched ? panelsFor(subsystem, s.panels) : s.panels;
    const d = SUBSYSTEMS[subsystem];
    const panels = { ...base };
    if ((d.left as PanelId[]).includes(id)) panels.leftTab = id as LeftTab;
    else if ((d.right as PanelId[]).includes(id)) panels.rightTab = id as RightTab;
    else panels.bottomTab = id as BottomTab;
    return switched ? { subsystem, panels, overlay: d.overlay } : { panels };
  }),
  openSide: (side) => set((s) => {
    const d = SUBSYSTEMS[s.subsystem];
    if (side === 'left') return { panels: { ...s.panels, leftTab: d.left[0] } };
    if (side === 'right') return { panels: { ...s.panels, rightTab: d.right[0] } };
    return { panels: { ...s.panels, bottomTab: d.bottom[0] } };
  }),
  setPanels: (patch) => set((s) => ({ panels: { ...s.panels, ...patch } })),

  setMode: (mode) => set({ mode }),
  setLang: (lang) => set({ lang }),
  setActive: (active) => set({ active }),
  updateScenario: (k, patch) => set((s) => {
    const next = { ...s.scenarios[k], ...patch };
    // A new site starts from its nominal point.
    if (patch.siteId !== undefined && patch.siteId !== s.scenarios[k].siteId) { next.dxM = 0; next.dyM = 0; }
    const scenarios = { ...s.scenarios, [k]: next };
    return { scenarios, cursorHours: Math.min(s.cursorHours, maxCursorHours({ ...s, scenarios })) };
  }),
  setRelocation: (k, dxM, dyM) => set((s) => ({
    scenarios: {
      ...s.scenarios,
      [k]: {
        ...s.scenarios[k],
        dxM: Math.round(clamp(dxM, -RELOCATION_LIMIT_M, RELOCATION_LIMIT_M)),
        dyM: Math.round(clamp(dyM, -RELOCATION_LIMIT_M, RELOCATION_LIMIT_M)),
      },
    },
  })),
  setPower: (patch) => set((s) => ({ power: { ...s.power, ...patch } })),
  setRf: (patch) => set((s) => ({ rf: { ...s.rf, ...patch } })),
  setRelay: (patch) => set((s) => ({ relay: { ...s.relay, ...patch } })),
  setAttitude: (patch) => set((s) => ({ attitude: { ...s.attitude, ...patch } })),
  setThermal: (patch) => set((s) => ({ thermal: { ...s.thermal, ...patch } })),
  setThermalOn: (thermalOn) => set({ thermalOn }),
  setAsset: (patch) => set((s) => ({ asset: { ...s.asset, ...patch } })),
  setTipover: (patch) => set((s) => ({ tipover: { ...s.tipover, ...patch } })),
  setScoreMode: (scoreMode) => set({ scoreMode }),
  setScience: (k, id, value) => set((s) => {
    const next = { ...s.science[k] };
    if (value === null) delete next[id]; else next[id] = value;
    return { science: { ...s.science, [k]: next } };
  }),
  setExpert: (expert) => set(() => { writeFlag(EXPERT_KEY, expert); return { expert }; }),
  setMicroRelief: (microRelief) => set({ microRelief }),
  setBriefing: (briefing) => set(() => {
    if (briefing === 'off') { try { localStorage.setItem(BRIEFING_KEY, 'done'); } catch { /* storage unavailable */ } }
    return { briefing };
  }),
  setMast: (mastM) => set({ mastM }),
  setCursor: (hours) => set((s) => ({ cursorHours: clamp(hours, 0, maxCursorHours(s)) })),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setOverlay: (overlay) => set({ overlay }),
  setView: (view) => set({ view }),
  setTourStep: (tourStep) => set({ tourStep }),
}));

/** Nominal selenographic coordinates of a scenario. */
export function scenarioLatLon(cfg: ScenarioCfg): { latDeg: number; lonDeg: number; name: string; short: string } {
  const site = ALL_SITES.find((s) => s.id === cfg.siteId);
  if (site) return { latDeg: site.latDeg, lonDeg: site.lonDeg, name: site.name, short: site.short };
  return { latDeg: cfg.customLat, lonDeg: cfg.customLon, name: 'Custom site', short: 'CUS' };
}

/** What the 3-D scene emphasises: the planner subsystem, the landing ground in the emergency mode, nothing in the explorer. */
export type SceneFocus = Subsystem | 'triage' | 'none';
export const sceneFocus = (s: Pick<AppState, 'mode' | 'subsystem'>): SceneFocus =>
  (s.mode === 'planner' ? s.subsystem : s.mode === 'triage' ? 'triage' : 'none');
