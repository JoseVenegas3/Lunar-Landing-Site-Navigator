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

/**
 * Other missions shown in the site selector (v2.1), grouped under their own
 * headings. Longitudes are converted from the 0–360 deg E convention of the
 * source to the -180..180 deg E convention of this catalogue.
 *
 * Source of every coordinate below: the coordinate files supplied by the
 * user for v2.1 (prompt_cambios_v2_1.md, table of section 6), except IM-1 and
 * Chandrayaan-3, which are quoted from memory like the historical landings
 * above (confirm them against the LROC release before citing).
 *
 * `approximate` marks a region rather than a confirmed touchdown point. Every
 * Artemis III/IV entry is a candidate region named by NASA, not a landing
 * point. Left out as duplicates of entries already in the catalogue (one kept,
 * with its own coordinate): Haworth (Haworth Crater Rim), Malapert Massif and
 * de Gerlache Rim 2 (candidates of the same name), and IM-2, whose supplied
 * coordinate (89.43 S, 222.6 E) is its original Shackleton-ridge target, the
 * same point as the Shackleton Connecting Ridge candidate, while IM-2 Athena
 * keeps the real touchdown.
 */
export type MissionGroup = 'artemis' | 'other';

export interface MissionSite extends CandidateSite {
  group: MissionGroup;
  /** A region, not a confirmed landing point: labelled "approximate coordinate". */
  approximate: boolean;
}

const mission = (
  id: string, name: string, group: MissionGroup, latDeg: number, lonDegEast360: number, approximate: boolean, summary: { en: string; es: string },
): MissionSite => {
  const lonDeg = lonDegEast360 > 180 ? lonDegEast360 - 360 : lonDegEast360;
  return { id, name, short: '', group, latDeg, lonDeg, approximate, summary, brief: { latDeg, lonDeg } };
};

const ARTEMIS_NOTE = { en: 'NASA candidate region for Artemis III/IV.', es: 'Región candidata de la NASA para Artemis III/IV.' };

export const MISSION_SITES: MissionSite[] = [
  // Artemis III/IV candidate regions: user coordinate files (v2.1 §6).
  mission('artemis-cabeus-b-peak', 'Peak near Cabeus B', 'artemis', -83.369, 292.335, true, ARTEMIS_NOTE),
  mission('artemis-mons-mouton-plateau', 'Mons Mouton Plateau', 'artemis', -84.805, 24.887, true, ARTEMIS_NOTE),
  mission('artemis-mons-mouton', 'Mons Mouton', 'artemis', -85.416, 31.851, true, ARTEMIS_NOTE),
  mission('artemis-nobile-rim-1', 'Nobile Rim 1', 'artemis', -85.295, 36.917, true, ARTEMIS_NOTE),
  mission('artemis-nobile-rim-2', 'Nobile Rim 2', 'artemis', -83.785, 57.683, true, ARTEMIS_NOTE),
  mission('artemis-slater-plain', 'Slater Plain', 'artemis', -87.478, 124.521, true, ARTEMIS_NOTE),
  // Other notable missions: user coordinate files (v2.1 §6).
  mission('viper-griffin', 'VIPER rover / Griffin Mission One', 'other', -85.4564, 36.3607, true, {
    en: 'Planned landing area of the Griffin lander carrying the VIPER rover, west of Nobile.',
    es: 'Zona de alunizaje planificada del lander Griffin con el rover VIPER, al oeste de Nobile.',
  }),
  mission('change-7', "Chang'e 7", 'other', -88.8, 123.4, true, {
    en: "Announced landing region of the Chinese Chang'e 7 mission.",
    es: "Región de alunizaje anunciada de la misión china Chang'e 7.",
  }),
  mission('ilrs-base', 'International Lunar Research Station base site (China / Russia)', 'other', -85.9, 357.0, true, {
    en: 'Proposed base region of the International Lunar Research Station.',
    es: 'Región propuesta para la base de la Estación Internacional de Investigación Lunar.',
  }),
  // IM-1 Odysseus touchdown, 22 February 2024 (quoted from memory, see above). At 80.13 S it sits on the edge of the terrain coverage.
  mission('im1-odysseus', 'IM-1 Odysseus (Malapert A)', 'other', -80.13, 1.44, false, {
    en: 'Intuitive Machines IM-1, 22 February 2024: landed near Malapert A and tipped onto its side. On the northern edge of the 80°–90° S coverage.',
    es: 'Intuitive Machines IM-1, 22 de febrero de 2024: alunizó cerca de Malapert A y quedó de costado. En el borde norte de la cobertura 80°–90° S.',
  }),
];

/**
 * Real missions outside the 80–90 S coverage of the LOLA terrain used here:
 * shown on the map as reference markers only, never offered for analysis.
 */
export interface ReferenceMarker { id: string; name: string; latDeg: number; lonDeg: number }
export const REFERENCE_MARKERS: ReferenceMarker[] = [
  // Chandrayaan-3 Vikram, 23 August 2023 (quoted from memory, see above).
  { id: 'chandrayaan-3', name: 'Chandrayaan-3 Vikram', latDeg: -69.37, lonDeg: 32.32 },
];

/** Every site that can be selected for analysis: candidates, historical landings and the other missions. */
export const ALL_SITES: CandidateSite[] = [...CANDIDATE_SITES, ...HISTORICAL_LANDINGS, ...MISSION_SITES];

/** True for a point the terrain model covers (80–90 S). */
export const inCoverage = (latDeg: number): boolean => latDeg >= CUSTOM_LAT_MIN && latDeg <= CUSTOM_LAT_MAX;
