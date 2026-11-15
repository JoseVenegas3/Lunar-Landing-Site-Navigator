/**
 * Lunar and engineering glossary (v3.1, SR-706). One source for the tooltips
 * of the app and for the glossary at the end of both interface guides
 * (docs/guia-interfaz*.md, checked by a unit test). Plain words first, then
 * the rigorous part.
 */
export interface GlossEntry {
  id: string;
  /** Term as shown in the guide: [en, es]. */
  term: [string, string];
  /** Definition: [en, es]. */
  def: [string, string];
  /** Words in a running text that open this entry (case-sensitive acronyms, case-insensitive words). */
  match: RegExp;
}

export const GLOSSARY: GlossEntry[] = [
  {
    id: 'dte', term: ['DTE (Direct-to-Earth)', 'DTE (directo a la Tierra)'], match: /\bDTE\b/,
    def: ['A radio link from the lander straight to an antenna on Earth, with no relay satellite. It needs the Earth above the local horizon and a ground station that can see the Moon.',
      'Enlace de radio del módulo directo a una antena en la Tierra, sin satélite de relevo. Necesita la Tierra sobre el horizonte local y una estación terrena que vea la Luna.'],
  },
  {
    id: 'los', term: ['LOS (Line of Sight / Loss of Signal)', 'LOS (línea de visión / pérdida de señal)'], match: /\bLOS\b/,
    def: ['Line of sight: the straight path between the antenna and the target. When terrain cuts it, the signal is lost (also called LOS, loss of signal).',
      'Línea de visión: el camino recto entre la antena y el objetivo. Cuando el relieve la corta, se pierde la señal (también LOS, loss of signal).'],
  },
  {
    id: 'libration', term: ['Lunar libration', 'Libración lunar'], match: /\blibrati(?:on|ón)\b|\blibraci(?:on|ón)\b/i,
    def: ['The Moon always shows the same face to the Earth, but its tilted, elliptical orbit makes it seem to rock about ±7.9° in longitude and ±6.7° in latitude. Seen from the Moon, the Earth wanders inside a small box of the sky instead of rising and setting.',
      'La Luna muestra siempre la misma cara a la Tierra, pero su órbita inclinada y elíptica la hace oscilar unos ±7,9° en longitud y ±6,7° en latitud. Desde la Luna, la Tierra se pasea dentro de una pequeña caja del cielo en vez de salir y ponerse.'],
  },
  {
    id: 'dem', term: ['DEM (Digital Elevation Model)', 'DEM (modelo digital de elevación)'], match: /\bDEM\b/,
    def: ['A grid of ground heights, one value per cell (here 20 m per pixel near the sites). Every shadow, slope and horizon of the app comes from it.',
      'Una grilla de alturas del suelo, un valor por celda (aquí 20 m por píxel cerca de los sitios). Todas las sombras, pendientes y horizontes de la app salen de ella.'],
  },
  {
    id: 'lola', term: ['LOLA (Lunar Orbiter Laser Altimeter)', 'LOLA (altímetro láser del LRO)'], match: /\bLOLA\b/,
    def: ['Laser altimeter on NASA\'s Lunar Reconnaissance Orbiter. It measured the height of the surface along orbit tracks; between tracks the polar maps are interpolated (Barker et al. 2023).',
      'Altímetro láser del Lunar Reconnaissance Orbiter de la NASA. Midió la altura de la superficie a lo largo de trazas orbitales; entre trazas los mapas polares se interpolan (Barker et al. 2023).'],
  },
  {
    id: 'psr', term: ['PSR (Permanently Shadowed Region)', 'PSR (región permanentemente sombreada)'], match: /\bPSRs?\b/,
    def: ['Ground at the bottom of polar craters that the Sun never reaches, because near the pole it never climbs more than a degree or two above the horizon. PSRs are cold traps where water ice can last.',
      'Suelo en el fondo de cráteres polares al que el Sol nunca llega, porque cerca del polo no sube más de uno o dos grados sobre el horizonte. Las PSR son trampas frías donde el hielo de agua puede perdurar.'],
  },
  {
    id: 'weh', term: ['WEH (Water-Equivalent Hydrogen)', 'WEH (hidrógeno equivalente a agua)'], match: /\bWEH\b/,
    def: ['Hydrogen measured from orbit by neutron spectrometers, expressed as if it were all water ice (weight %). A clue to ice, not a direct detection.',
      'Hidrógeno medido desde órbita con espectrómetros de neutrones, expresado como si fuera todo hielo de agua (% en peso). Un indicio de hielo, no una detección directa.'],
  },
  {
    id: 'dod', term: ['DoD (Depth of Discharge)', 'DoD (profundidad de descarga)'], match: /\bDoD\b/,
    def: ['How much of the battery capacity has been used. Deep discharges shorten battery life, so missions set a safe limit.',
      'Cuánto de la capacidad de la batería se ha usado. Las descargas profundas acortan su vida, por eso las misiones fijan un límite seguro.'],
  },
  {
    id: 'deygout', term: ['Knife-edge diffraction (Deygout / ITU-R P.526)', 'Difracción de filo de cuchillo (Deygout / ITU-R P.526)'], match: /\bDeygout\b|knife-edge|filo de cuchillo|P\.526/i,
    def: ['Radio waves bend a little over a ridge, losing strength. ITU-R P.526 gives the loss of one sharp edge; the Deygout method adds the main ridge and the secondary ones (here up to three).',
      'Las ondas de radio se doblan un poco sobre una cresta y pierden potencia. ITU-R P.526 da la pérdida de un filo agudo; el método de Deygout suma la cresta principal y las secundarias (aquí hasta tres).'],
  },
  {
    id: 'fresnel', term: ['First Fresnel zone', 'Primera zona de Fresnel'], match: /\bFresnel\b/,
    def: ['The cigar-shaped volume around the line of sight that carries most of the radio energy. Its radius is √(λ·d1·d2/(d1+d2)); terrain inside it weakens the link even when the line of sight is clear.',
      'El volumen en forma de cigarro alrededor de la línea de visión que lleva la mayor parte de la energía de radio. Su radio es √(λ·d1·d2/(d1+d2)); el relieve dentro de ella debilita el enlace aunque la línea de visión esté libre.'],
  },
  {
    id: 'multipath', term: ['Multipath on regolith', 'Multipath en regolito'], match: /\bmultipath\b|multitrayecto/i,
    def: ['Part of the signal bounces off the ground and arrives slightly late, adding to or cancelling the direct signal. It matters most when the Earth is low, as at the pole. The regolith is modelled with permittivity εr = 3.7.',
      'Parte de la señal rebota en el suelo y llega con retraso, sumando o anulando la señal directa. Importa sobre todo con la Tierra baja, como en el polo. El regolito se modela con permitividad εr = 3,7.'],
  },
  {
    id: '6dof', term: ['6-DOF attitude (roll, pitch, yaw)', 'Actitud 6-DOF (alabeo, cabeceo, guiñada)'], match: /\b6-DOF\b/,
    def: ['A body has six degrees of freedom: three positions and three rotations. The attitude is the three rotations: roll, pitch and yaw. A tilted lander points its panels and antenna the wrong way.',
      'Un cuerpo tiene seis grados de libertad: tres posiciones y tres giros. La actitud son los tres giros: alabeo, cabeceo y guiñada. Un módulo inclinado apunta mal sus paneles y su antena.'],
  },
  {
    id: 'gimbal', term: ['Gimbal', 'Gimbal (cardán)'], match: /\bgimbal\b|\bcard[aá]n\b/i,
    def: ['A pivoting mount that lets the antenna turn relative to the lander body. Its range (degrees) says how far from the body axis it can still point at the Earth.',
      'Montura articulada que deja girar la antena respecto del cuerpo del módulo. Su rango (grados) dice cuánto puede alejarse del eje del cuerpo y aún apuntar a la Tierra.'],
  },
  {
    id: 'psi', term: ['PSI (Plume-Surface Interaction)', 'PSI (interacción pluma-superficie)'], match: /\bPSI\b/,
    def: ['The rocket exhaust of a landing lander blasts the regolith. With no air to slow it, the dust flies in fast, low ballistic paths that can sand-blast hardware far away.',
      'El chorro del motor de un módulo al alunizar arrastra el regolito. Sin aire que lo frene, el polvo vuela en trayectorias balísticas rápidas y rasantes que pueden dañar equipos lejanos.'],
  },
  {
    id: 'elfo', term: ['ELFO (Elliptical Lunar Frozen Orbit)', 'ELFO (órbita lunar elíptica congelada)'], match: /\bELFO\b/,
    def: ['A very elongated orbit whose shape stays nearly fixed for years, with its far point over the south pole: a relay satellite there sees the pole for many hours per orbit.',
      'Órbita muy alargada cuya forma se mantiene casi fija por años, con su punto lejano sobre el polo sur: un satélite de relevo ahí ve el polo muchas horas por órbita.'],
  },
  {
    id: 'somrf', term: ['SOM-RF index', 'Índice SOM-RF'], match: /\bSOM-RF\b/,
    def: ['The multi-criteria score this app uses to rank sites (Earth view, light, slope, roughness, ice, etc.). Its weights come from the team\'s state-of-the-art document, which cites a self-organising-map and random-forest study; they have not been checked against that paper.',
      'Puntaje multicriterio con que la app ordena los sitios (vista de la Tierra, luz, pendiente, rugosidad, hielo, etc.). Sus pesos vienen del documento de estado del arte del equipo, que cita un estudio de mapas autoorganizados y bosques aleatorios; no se han contrastado con ese artículo.'],
  },
];

export const glossById = (id: string): GlossEntry | undefined => GLOSSARY.find((g) => g.id === id);

/** Split a running text into plain pieces and glossary hits (first hit of each term only). */
export function glossSplit(text: string): (string | { id: string; text: string })[] {
  const hits: { start: number; end: number; id: string }[] = [];
  for (const g of GLOSSARY) {
    const re = new RegExp(g.match.source, g.match.flags.includes('i') ? 'i' : '');
    const m = re.exec(text);
    if (m && m[0]) hits.push({ start: m.index, end: m.index + m[0].length, id: g.id });
  }
  hits.sort((a, b) => a.start - b.start);
  const out: (string | { id: string; text: string })[] = [];
  let at = 0;
  for (const h of hits) {
    if (h.start < at) continue;
    if (h.start > at) out.push(text.slice(at, h.start));
    out.push({ id: h.id, text: text.slice(h.start, h.end) });
    at = h.end;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}
