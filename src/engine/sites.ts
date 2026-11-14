/**
 * Candidate landing sites pre-loaded in the browser. Coordinates are
 * selenographic (longitude positive east).
 *
 * `latDeg` / `lonDeg` are landing points chosen on the real LOLA terrain by
 * scripts/optimise_sites.ts: within 4 km of the region centre, slope <= 10 deg,
 * maximising annual illumination plus annual direct-to-Earth coverage
 * (results in data/site_optimisation.json). `brief` keeps the coordinate that
 * came with the challenge brief, which names the region but, on measured
 * terrain, does not sit on the landform it describes.
 */
export interface CandidateSite {
  id: string;
  name: string;
  short: string;
  latDeg: number;
  lonDeg: number;
  summary: { en: string; es: string };
  brief: { latDeg: number; lonDeg: number };
}

export const CANDIDATE_SITES: CandidateSite[] = [
  {
    id: 'shackleton-ridge',
    name: 'Shackleton Connecting Ridge',
    short: 'SCR',
    latDeg: -89.4401,
    lonDeg: -137.3618,
    summary: {
      en: 'Crest of the ridge between Shackleton and de Gerlache. The best-lit ground near the pole.',
      es: 'Cima de la cresta entre Shackleton y de Gerlache. El terreno mejor iluminado cerca del polo.',
    },
    brief: { latDeg: -89.54, lonDeg: -129.78 },
  },
  {
    id: 'malapert-massif',
    name: 'Malapert Massif',
    short: 'MAL',
    latDeg: -85.9759,
    lonDeg: 1.573,
    summary: {
      en: 'Earth-facing shoulder of a 5 km massif. The longest direct-to-Earth windows of the five.',
      es: 'Hombro orientado a la Tierra de un macizo de 5 km. Las ventanas DTE más largas de los cinco.',
    },
    brief: { latDeg: -86.04, lonDeg: 2.7 },
  },
  {
    id: 'haworth-rim',
    name: 'Haworth Crater Rim',
    short: 'HAW',
    latDeg: -86.7573,
    lonDeg: -20.4744,
    summary: {
      en: 'North-west rim, 1.9 km high, above the permanently shadowed crater floor (PSR).',
      es: 'Borde noroeste, a 1,9 km de altura, sobre el piso del cráter en sombra permanente (PSR).',
    },
    // The brief coordinate is the crater centre (IAU: 87.45 S, 5.17 W), on the shadowed floor.
    brief: { latDeg: -87.45, lonDeg: -5.12 },
  },
  {
    id: 'nobile-rim',
    name: 'Nobile Crater Rim (VIPER site)',
    short: 'NOB',
    latDeg: -85.2682,
    lonDeg: 32.0028,
    summary: {
      en: 'Mons Mouton plateau west of Nobile, 6.3 km high. Good Earth view, moderate sunlight.',
      es: 'Meseta de Mons Mouton al oeste de Nobile, a 6,3 km de altura. Buena vista a la Tierra, luz moderada.',
    },
    brief: { latDeg: -85.2, lonDeg: 31.3 },
  },
  {
    id: 'de-gerlache-rim-2',
    name: 'De Gerlache Rim 2',
    short: 'DGR',
    latDeg: -88.7047,
    lonDeg: -68.4666,
    summary: {
      en: 'Flat spot on the rim crest. Well lit, with Earth view cut by neighbouring relief.',
      es: 'Punto plano en la cresta del borde. Bien iluminado, con la vista a la Tierra recortada por el relieve vecino.',
    },
    brief: { latDeg: -88.71, lonDeg: -68.7 },
  },
];

export const siteById = (id: string): CandidateSite | undefined => CANDIDATE_SITES.find((s) => s.id === id);

/** Latitude band of the tool: the regional DEM (+-520 km) gives a horizon search of 215 km or more down to 80 S. */
export const CUSTOM_LAT_MIN = -90;
export const CUSTOM_LAT_MAX = -80;
/** Largest micro-relocation offered by the UI, metres. */
export const RELOCATION_LIMIT_M = 500;

/**
 * Real landings used to replay the model against what happened (hindcast).
 * Coordinates are the ones published with the LRO camera images of each lander,
 * quoted from memory here: confirm them against the LROC release before citing.
 */
export interface HistoricalLanding extends CandidateSite {
  /** Touchdown, ms since the Unix epoch (UTC). */
  touchdownMs: number;
  /** Attitude preset (attitude.ts) that represents how the lander came to rest. */
  attitudePreset: string;
  /** Hours of surface operation actually achieved. */
  actualSurfaceHours: number;
  outcome: { en: string; es: string };
}

export const HISTORICAL_LANDINGS: HistoricalLanding[] = [
  {
    id: 'im2-athena',
    name: 'IM-2 Athena (Mons Mouton)',
    short: 'IM2',
    latDeg: -84.7906,
    lonDeg: 29.1957,
    summary: {
      en: 'Intuitive Machines IM-2, 6 March 2025: came to rest on its side inside a shadowed crater.',
      es: 'Intuitive Machines IM-2, 6 de marzo de 2025: quedó de costado dentro de un cráter en sombra.',
    },
    brief: { latDeg: -84.7906, lonDeg: 29.1957 },
    touchdownMs: Date.UTC(2025, 2, 6, 17, 28),
    attitudePreset: 'im2',
    actualSurfaceHours: 13,
    outcome: {
      en: 'About 250 m from its target, on its side in a crater; the arrays could not recharge the batteries and the mission ended within about 13 hours.',
      es: 'A unos 250 m de su objetivo, de costado en un cráter; los paneles no pudieron recargar las baterías y la misión terminó en unas 13 horas.',
    },
  },
];

/** Every pre-loaded site: the candidates plus the historical landings. */
export const ALL_SITES: CandidateSite[] = [...CANDIDATE_SITES, ...HISTORICAL_LANDINGS];
