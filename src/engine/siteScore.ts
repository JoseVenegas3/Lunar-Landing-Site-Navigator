/**
 * Multi-criteria site suitability and landing-dispersion analysis
 * (requirements SyR-C5.1 and SyR-C5.2).
 *
 * The weights are the ones listed in the team's state-of-the-art document,
 * attributed there to a self-organising-map / random-forest study of the lunar
 * south pole. They are reproduced as given and have not been checked against
 * the source paper.
 *
 * Five criteria are computed by the terrain and ephemeris engine. Three come
 * from orbital data layers (scienceLayers.ts): permanently shadowed regions,
 * FeO and gravity anomaly. Hydrogen and geological density have no layer and
 * are accepted as inputs; when absent they are left out. The score is the
 * weighted mean over the criteria that are available, and the share of the
 * total weight they cover is reported with it.
 */

export type CriterionId =
  | 'earthVisibility' | 'hydrogen' | 'roughness' | 'slope' | 'illumination' | 'psrProximity' | 'feo' | 'geology' | 'gravity';

export interface Criterion {
  id: CriterionId;
  /** Published weight, percent (they sum to 97.37; the score renormalises). */
  weightPct: number;
  group: 'engineering' | 'science';
  /** Derived by the terrain / ephemeris engine, read from an orbital data layer, or supplied by the user. */
  source: 'computed' | 'layer' | 'input';
  name: { en: string; es: string };
  unit: string;
}

export const CRITERIA: Criterion[] = [
  { id: 'earthVisibility', weightPct: 23.16, group: 'engineering', source: 'computed', name: { en: 'Earth visibility (DTE)', es: 'Visibilidad de la Tierra (DTE)' }, unit: '%' },
  { id: 'hydrogen', weightPct: 13.65, group: 'science', source: 'input', name: { en: 'Hydrogen abundance (WEH)', es: 'Abundancia de hidrógeno (WEH)' }, unit: 'wt.%' },
  { id: 'roughness', weightPct: 12.82, group: 'engineering', source: 'computed', name: { en: 'Kilometre-scale roughness', es: 'Rugosidad a escala kilométrica' }, unit: 'm' },
  { id: 'slope', weightPct: 11.55, group: 'engineering', source: 'computed', name: { en: 'Local slope', es: 'Pendiente local' }, unit: '°' },
  { id: 'illumination', weightPct: 9.83, group: 'engineering', source: 'computed', name: { en: 'Solar illumination', es: 'Iluminación solar' }, unit: '%' },
  { id: 'psrProximity', weightPct: 9.68, group: 'science', source: 'layer', name: { en: 'Distance to a permanent shadow (PSR)', es: 'Distancia a sombra permanente (PSR)' }, unit: 'km' },
  { id: 'feo', weightPct: 6.03, group: 'science', source: 'layer', name: { en: 'FeO abundance', es: 'Abundancia de FeO' }, unit: 'wt.%' },
  { id: 'geology', weightPct: 5.81, group: 'science', source: 'input', name: { en: 'Geological feature density (KDE)', es: 'Densidad geológica (KDE)' }, unit: '0–1' },
  { id: 'gravity', weightPct: 4.84, group: 'science', source: 'layer', name: { en: 'Gravity anomaly (free-air)', es: 'Anomalía gravitatoria (aire libre)' }, unit: 'mGal' },
];

export type WeightMode = 'synthesized' | 'engineering' | 'science';

/**
 * Weight sets. "Synthesized" is the published set. The other two are derived
 * here by doubling the weight of one group before renormalising; they are this
 * project's convention, not published values.
 */
export function criterionWeights(mode: WeightMode): Record<CriterionId, number> {
  const raw = CRITERIA.map((c) => c.weightPct * (mode === 'synthesized' || c.group !== mode ? 1 : 2));
  const sum = raw.reduce((a, b) => a + b, 0);
  return Object.fromEntries(CRITERIA.map((c, i) => [c.id, raw[i] / sum])) as Record<CriterionId, number>;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Raw value of each criterion in its own unit. `null` or `undefined` means "no
 * data". The normalisation to a 0-1 merit is:
 *   earthVisibility, illumination  percent of the window / 100
 *   slope        1 at 0 deg, 0 at 20 deg or more (beyond any lander's tolerance)
 *   roughness    1 for a perfectly planar kilometre, 0 at 200 m RMS relief
 *   psrProximity 1 on the edge of a shadowed region, 0 at 20 km or more
 *   hydrogen     0.5 wt.% water-equivalent hydrogen or more scores 1
 *   feo          20 wt.% (mare-like) or more scores 1
 *   gravity      magnitude of the free-air anomaly; 300 mGal or more scores 1
 *   geology      entered already normalised by whoever supplies it
 * These ranges are conventions of this project, chosen to span lunar values.
 */
export type SiteMetrics = Partial<Record<CriterionId, number | null>>;

export function normaliseCriterion(id: CriterionId, value: number): number {
  switch (id) {
    case 'earthVisibility':
    case 'illumination': return clamp01(value / 100);
    case 'slope': return clamp01(1 - value / 20);
    case 'roughness': return clamp01(1 - value / 200);
    case 'psrProximity': return clamp01(1 - value / 20);
    case 'hydrogen': return clamp01(value / 0.5);
    case 'feo': return clamp01(value / 20);
    case 'gravity': return clamp01(Math.abs(value) / 300);
    default: return clamp01(value);
  }
}

export interface ScoreBreakdownRow {
  id: CriterionId;
  /** Weight in the selected mode, 0..1 over all nine criteria. */
  weight: number;
  available: boolean;
  raw: number | null;
  /** Merit 0..1, when available. */
  merit: number;
  /** Points contributed to the 0-100 score. */
  points: number;
}

export interface SiteScore {
  /** 0-100, weighted mean over the available criteria. */
  score: number;
  /** Share of the total weight covered by the available criteria, percent. */
  coveragePct: number;
  rows: ScoreBreakdownRow[];
}

/** Suitability score with the published weights (or one of the derived sets). */
export function computeSOMRandomForestSiteScore(metrics: SiteMetrics, mode: WeightMode = 'synthesized'): SiteScore {
  const weights = criterionWeights(mode);
  let covered = 0, sum = 0;
  const rows: ScoreBreakdownRow[] = CRITERIA.map((c) => {
    const raw = metrics[c.id];
    const available = raw !== null && raw !== undefined && Number.isFinite(raw);
    const merit = available ? normaliseCriterion(c.id, raw as number) : 0;
    if (available) { covered += weights[c.id]; sum += weights[c.id] * merit; }
    return { id: c.id, weight: weights[c.id], available, raw: available ? (raw as number) : null, merit, points: 0 };
  });
  const score = covered > 0 ? (100 * sum) / covered : 0;
  for (const r of rows) r.points = r.available && covered > 0 ? (100 * r.weight * r.merit) / covered : 0;
  return { score, coveragePct: 100 * covered, rows };
}

// ------------------------------------------------------------ dispersion

export interface DispersionOutcome {
  /** Hours the lander stays alive from the window start. */
  survivalHours: number;
  /** Share of the window with a usable downlink, percent. */
  linkPct: number;
  /** Energy generated over the window, Wh. */
  energyWh: number;
  /** Lander lost (frozen or battery exhausted in darkness) before the window ends. */
  lost: boolean;
}

export interface DispersionCell extends DispersionOutcome {
  /** Offset from the aim point, metres east and north. */
  eastM: number;
  northM: number;
  /** 0..1 rank used for colouring: survival first, then link, then energy. */
  merit: number;
}

export interface DispersionResult {
  size: number;
  radiusM: number;
  /** Row-major, row 0 is the southernmost row. */
  cells: DispersionCell[];
  centre: DispersionCell;
  best: DispersionCell;
  /** Share of the cells in which the lander survives the whole window, percent. */
  survivingPct: number;
  /** Where to drive (or retarget the descent) from the aim point to reach the best cell. */
  escape: { azimuthDeg: number; distanceM: number; gainHours: number; gainLinkPct: number } | null;
}

/** Order two outcomes: longer survival wins, then more link, then more energy. */
export function betterOutcome(a: DispersionOutcome, b: DispersionOutcome): boolean {
  if (Math.abs(a.survivalHours - b.survivalHours) > 0.5) return a.survivalHours > b.survivalHours;
  if (Math.abs(a.linkPct - b.linkPct) > 0.05) return a.linkPct > b.linkPct;
  return a.energyWh > b.energyWh;
}

/**
 * Evaluate a size x size grid of touchdown points spanning +-radiusM around the
 * aim point and find the escape vector to the best one.
 *
 * `evaluate(eastM, northM)` runs the full mission model at an offset; this
 * function owns the grid, the ranking and the vector, so it can be tested
 * without terrain.
 */
export function computeDispersionGridAndEscapeVector(
  evaluate: (eastM: number, northM: number) => DispersionOutcome, radiusM = 200, size = 5, windowHours = Infinity,
): DispersionResult {
  const cells: DispersionCell[] = [];
  const step = size > 1 ? (2 * radiusM) / (size - 1) : 0;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const eastM = -radiusM + i * step, northM = -radiusM + j * step;
      cells.push({ eastM, northM, merit: 0, ...evaluate(eastM, northM) });
    }
  }
  return rankDispersion(cells, size, radiusM, windowHours);
}

/** Ranking and escape vector for an already-evaluated grid (used by the time-sliced UI path). */
export function rankDispersion(cells: DispersionCell[], size: number, radiusM: number, windowHours = Infinity): DispersionResult {
  const maxH = Math.max(...cells.map((c) => c.survivalHours), 1e-9);
  const maxE = Math.max(...cells.map((c) => c.energyWh), 1e-9);
  for (const c of cells) c.merit = 0.6 * (c.survivalHours / maxH) + 0.3 * (c.linkPct / 100) + 0.1 * (c.energyWh / maxE);
  const centre = cells[Math.floor(size / 2) * size + Math.floor(size / 2)];
  // Among equally good cells the nearest to the aim point wins: the shortest drive.
  const reach = (c: DispersionCell): number => Math.hypot(c.eastM - centre.eastM, c.northM - centre.northM);
  let best = centre;
  for (const c of cells) {
    if (betterOutcome(c, best) || (!betterOutcome(best, c) && reach(c) < reach(best))) best = c;
  }
  const moved = best !== centre;
  return {
    size, radiusM, cells, centre, best,
    survivingPct: (100 * cells.filter((c) => !c.lost && c.survivalHours >= Math.min(windowHours, maxH) - 0.5).length) / cells.length,
    escape: moved ? {
      azimuthDeg: ((Math.atan2(best.eastM - centre.eastM, best.northM - centre.northM) * 180) / Math.PI + 360) % 360,
      distanceM: Math.hypot(best.eastM - centre.eastM, best.northM - centre.northM),
      gainHours: best.survivalHours - centre.survivalHours,
      gainLinkPct: best.linkPct - centre.linkPct,
    } : null,
  };
}
