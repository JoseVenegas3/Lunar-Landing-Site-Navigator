/**
 * The 3-minute video pitch (v3.1): 180.0 s in six acts and seventeen scenes.
 * Pure data and functions (no React), unit-tested: the scenes tile the
 * timeline with no gap or overlap and every act ends on a marker.
 *
 * The teleprompter text is what the speaker reads. Numbers are never typed
 * here: the player reads them from the engine (the `{…}` slots are filled by
 * PitchShow.tsx); facts from outside the app are named with their source.
 */
export const PITCH_DURATION_S = 180;

export type ActId = 'hook' | 'proposal' | 'training' | 'leader' | 'emergency' | 'close';

export interface Act {
  id: ActId;
  n: number;
  start: number;
  end: number;
  title: [string, string];
}

export const ACTS: Act[] = [
  { id: 'hook', n: 1, start: 0, end: 25, title: ['The hook: death at the lunar south pole', 'El gancho: la muerte en el Polo Sur lunar'] },
  { id: 'proposal', n: 2, start: 25, end: 45, title: ['The proposal and the dual gate', 'La propuesta y la puerta dual'] },
  { id: 'training', n: 3, start: 45, end: 80, title: ['Demo A: Flight Director training', 'Demo A: entrenamiento Flight Director'] },
  { id: 'leader', n: 4, start: 80, end: 135, title: ['Demo B: five differentiators in Mission Leader', 'Demo B: cinco diferenciadores en Mission Leader'] },
  { id: 'emergency', n: 5, start: 135, end: 160, title: ['Climax: live emergency triage', 'Clímax: triaje de emergencia en vivo'] },
  { id: 'close', n: 6, start: 160, end: 180, title: ['Close: rigour and vision', 'Cierre: rigor y visión'] },
];

/** Marks of the progress bar: the start of every act and the end. */
export const MARKS = [...ACTS.map((a) => a.start), PITCH_DURATION_S];

export type SceneId =
  | 'im1' | 'im2' | 'stat' | 'brand' | 'gate' | 'm0' | 'badges' | 'learn'
  | 'ocean1' | 'ocean2' | 'ocean3' | 'ocean4' | 'ocean5' | 'alert' | 'rescue' | 'trust' | 'finale';

export interface Scene {
  id: SceneId;
  act: ActId;
  start: number;
  end: number;
  /** Teleprompter / subtitle: [en, es]. `{slot}` is filled with a live value. */
  say: [string, string];
}

export const SCENES: Scene[] = [
  { id: 'im1', act: 'hook', start: 0, end: 8, say: [
    'February 2024. IM-1 Odysseus touches down near Malapert A and comes to rest tilted, its antenna pointing the wrong way.',
    'Febrero de 2024. IM-1 Odysseus aluniza cerca de Malapert A y queda inclinado, con la antena apuntando mal.'] },
  { id: 'im2', act: 'hook', start: 8, end: 16, say: [
    'March 2025. IM-2 Athena ends on its side in a small crater, in shadow, on ground the 20 m maps show as flat.',
    'Marzo de 2025. IM-2 Athena termina de costado en un pequeño cráter en sombra, en un suelo que los mapas de 20 m muestran plano.'] },
  { id: 'stat', act: 'hook', start: 16, end: 25, say: [
    'At the lunar south pole the Sun never climbs more than a few degrees, the Earth rocks on the horizon, and survival depends on light, terrain, radio and cold at the same time.',
    'En el Polo Sur lunar el Sol no sube más de unos pocos grados, la Tierra se mece en el horizonte y sobrevivir depende a la vez de luz, relieve, radio y frío.'] },
  { id: 'brand', act: 'proposal', start: 25, end: 34, say: [
    'GISAT UdeC built the Lunar Landing Site Navigator: real LOLA terrain, ephemerides checked against JPL Horizons, and one engine behind every number.',
    'GISAT UdeC creó Lunar Landing Site Navigator: terreno LOLA real, efemérides contrastadas con JPL Horizons y un solo motor detrás de cada cifra.'] },
  { id: 'gate', act: 'proposal', start: 34, end: 45, say: [
    'The NASA challenge asks for rigour and for intuition. One gate gives both: a guided training for students and the public, and the full engineering console.',
    'El desafío de NASA pide rigor e intuición. Una sola puerta da ambos: un entrenamiento guiado para estudiantes y público, y la consola de ingeniería completa.'] },
  { id: 'm0', act: 'training', start: 45, end: 57, say: [
    'In the training, the user lands, deploys the arrays, finds the grazing Sun and calls home. Nothing is pre-recorded: it is the real 3-D scene.',
    'En el entrenamiento, el usuario aluniza, despliega los paneles, encuentra el Sol rasante y llama a casa. Nada está pregrabado: es la escena 3D real.'] },
  { id: 'badges', act: 'training', start: 57, end: 70, say: [
    'Eight missions unlock the subsystems one by one: approach heading, mast height, radio, attitude, science, emergency. One badge per subsystem.',
    'Ocho misiones desbloquean los subsistemas uno a uno: rumbo de aproximación, altura del mástil, radio, actitud, ciencia, emergencia. Una insignia por subsistema.'] },
  { id: 'learn', act: 'training', start: 70, end: 80, say: [
    'After each mission, "Learn more" explains why the Moon is different: no air, no refraction, one sixth of the gravity, and why 200 metres change everything.',
    'Tras cada misión, «Aprender más» explica por qué la Luna es distinta: sin aire, sin refracción, un sexto de la gravedad, y por qué 200 metros lo cambian todo.'] },
  { id: 'ocean1', act: 'leader', start: 80, end: 91, say: [
    'One: terrain. Slopes, a cursor ruler that keeps measuring beyond 500 metres, 25 touchdown points, and the terrain error propagated as P10, P50 and P90.',
    'Uno: terreno. Pendientes, un telémetro de cursor que sigue midiendo más allá de 500 metros, 25 puntos de contacto y el error del terreno propagado como P10, P50 y P90.'] },
  { id: 'ocean2', act: 'leader', start: 91, end: 102, say: [
    'Two: power and cold, coupled. The solar elevation is a power KPI; a 10 metre mast and a Sun tracker change the thermal fate of the lander.',
    'Dos: energía y frío, acoplados. La elevación solar es un KPI de potencia; un mástil de 10 metros y un seguidor solar cambian el destino térmico del módulo.'] },
  { id: 'ocean3', act: 'leader', start: 102, end: 113, say: [
    'Three: real radio physics. Knife-edge diffraction over up to three ridges, multipath on the regolith, the DSN, a hypothetical GISAT 3.7 m station in Concepción, and a relay in a frozen elliptical orbit.',
    'Tres: física de radio real. Difracción de filo de cuchillo sobre hasta tres crestas, multitrayecto en el regolito, la DSN, una estación hipotética GISAT de 3,7 m en Concepción y un relevo en órbita elíptica congelada.'] },
  { id: 'ocean4', act: 'leader', start: 113, end: 124, say: [
    'Four: what IM-1 taught us. A 30 degree tilt, the antenna gimbal recovering the link, and the exclusion radius for the dust a landing blasts at a neighbour.',
    'Cuatro: lo que enseñó IM-1. Una inclinación de 30 grados, el cardán de la antena recuperando el enlace y el radio de exclusión por el polvo que un alunizaje lanza sobre un vecino.'] },
  { id: 'ocean5', act: 'leader', start: 124, end: 135, say: [
    'Five: where we want to go versus where we can go. A multi-criteria index, and "Optimise" flies dozens of missions in a background worker to find a better spot or date.',
    'Cinco: dónde queremos ir frente a dónde podemos ir. Un índice multicriterio, y «Optimizar» vuela decenas de misiones en un worker en segundo plano para hallar un mejor punto o fecha.'] },
  { id: 'alert', act: 'emergency', start: 135, end: 147, say: [
    'Live emergency. A lander comes down off course. In seconds the app answers in plain words: {head}',
    'Emergencia en vivo. Una nave cae fuera de curso. En segundos la app responde en lenguaje llano: {head}'] },
  { id: 'rescue', act: 'emergency', start: 147, end: 160, say: [
    'And it finds the way out. One click: {move}. Now: {head}',
    'Y encuentra la salida. Un clic: {move}. Ahora: {head}'] },
  { id: 'trust', act: 'close', start: 160, end: 170, say: [
    'Every assumption has its source, the limits of the LOLA data are on screen, and it all works offline: {tests}.',
    'Cada supuesto tiene su fuente, los límites de los datos LOLA están en pantalla y todo funciona sin conexión: {tests}.'] },
  { id: 'finale', act: 'close', start: 170, end: 180, say: [
    'At the lunar south pole, 200 metres or a few hours write the story. Now we know where to touch down. GISAT UdeC.',
    'En el Polo Sur lunar, 200 metros o unas pocas horas escriben la historia. Hoy sabemos dónde tocar suelo. GISAT UdeC.'] },
];

export const clampT = (t: number): number => Math.max(0, Math.min(PITCH_DURATION_S, t));

/** Scene playing at time t (the last one at t = 180). */
export function sceneAt(t: number): Scene {
  const x = clampT(t);
  return SCENES.find((s) => x >= s.start && x < s.end) ?? SCENES[SCENES.length - 1];
}

export function actAt(t: number): Act {
  const x = clampT(t);
  return ACTS.find((a) => x >= a.start && x < a.end) ?? ACTS[ACTS.length - 1];
}

/** Start of the next / previous scene, for the ← / → keys. */
export function nextSceneStart(t: number): number {
  const s = sceneAt(t);
  return s.end >= PITCH_DURATION_S ? PITCH_DURATION_S : s.end;
}
export function prevSceneStart(t: number): number {
  const s = sceneAt(t);
  const i = SCENES.indexOf(s);
  // within the first second of a scene, ← goes to the previous one
  return t - s.start < 1 && i > 0 ? SCENES[i - 1].start : s.start;
}

/** m:ss */
export function clock(t: number): string {
  const x = Math.floor(clampT(t));
  return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
}

/** Fill the `{slot}` placeholders of a line. */
export function fill(text: string, slots: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => slots[k] ?? '…');
}
