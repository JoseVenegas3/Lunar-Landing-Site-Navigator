/**
 * The Beginner training script (v3.0), declarative: one entry per step.
 *
 * Rules: every number in a narration is read from the engine through the
 * context (`c.A.result`, the verdict, the store) at render time, never typed
 * here; the scenarios come from scenarios.ts, found with the engine. Every
 * step ends on a real action of the user (a click on the highlighted
 * element, a gesture on the 3-D view, a change in the store) except the ones
 * marked `auto` (timed narration) and `cont` (a "Continue" button).
 */
import {
  DEFAULT_POWER, DEFAULT_RELAY, NOMINAL_ATTITUDE, STATE_RF_PHYSICAL, T_BATTERY_DEATH_K, VERDICT_LIMITS, Verdict, emergencyCountdown, missionVerdict, tipoverMap,
} from '../engine';
import { SLOPE_STOPS } from '../components/3d/Terrain';
import { im1Attitude } from './scenarioCheck';
import { camProbe, landerAnim } from '../components/3d/sceneMath';
import { requestSubsystem, cancelSubsystemSwitch } from '../components/dashboard/SubsystemSwitch';
import { ScenarioData } from '../state/mission';
import { AppState, Subsystem, scenarioLatLon, useApp } from '../state/store';
import { useInsights } from '../state/insights';
import { cardinal, fmtDateTime, fmtDuration, fmtEnergy, fmtNum } from '../lib/format';
import { Sfx } from './audio';
import { Reveal, useBeginner } from './state';
import { TUTORIAL_SCENARIOS as SC } from './scenarios';

export type T = (en: string, es: string) => string;

export interface Ctx {
  app: AppState;
  A: ScenarioData;
  B: ScenarioData;
  /** Values remembered by earlier steps (e.g. the energy before a fix). */
  memo: Record<string, number>;
}

export interface Step {
  id: string;
  /** Mission 0..7. */
  mission: number;
  /** Drive the app to the state the step needs (scene, cards, hardware). */
  enter?: (c: Ctx) => void;
  say: (c: Ctx, t: T) => string;
  /** Element to spotlight: a CSS selector, the 3-D view, or nothing. */
  focus?: string | 'canvas' | null;
  /** Gestures allowed on the 3-D view while the step is on. */
  allow?: ('drag' | 'wheel' | 'dblclick')[];
  /** The step ends with a click on this element. */
  click?: string;
  /** The step ends when this is true. */
  until?: (c: Ctx) => boolean;
  /** Narration the user reads at their own pace: it ends with "Continue" (enabled once `until`, if any, holds). */
  auto?: number;
  /** Cinematic: ends by itself when `until` holds (the descent). */
  cine?: boolean;
  /** Big message with a "Continue" button. */
  cont?: boolean;
  /** "Do it for me" (offered after 45 s). Defaults to clicking `click`. */
  doIt?: (c: Ctx) => void;
  hint?: [string, string];
  sfx?: Sfx;
  reveal?: Reveal[];
  unlock?: Subsystem;
  /** Red alert border (≤ 3 Hz, fixed with reduced motion). */
  alert?: boolean;
  /** Last step of a mission: its seal is earned. */
  seal?: boolean;
  diploma?: boolean;
}

// ------------------------------------------------------------------ helpers

const s0 = (): AppState => useApp.getState();
const v = (d: ScenarioData): Verdict | null => (d.result ? missionVerdict(d.result) : null);
const at = (c: Ctx, h: number): string => (c.A.result ? fmtDateTime(c.A.result.eph.startMs + h * 3_600_000) : '…');
const site = (c: Ctx): string => scenarioLatLon(c.app.scenarios.A, c.app.lang).name;
const ready = (c: Ctx): boolean => c.A.result !== null && c.A.loading === null;
const tipP = (c: Ctx): number => {
  const d = c.A;
  if (!d.dem || !d.input) return 0;
  return tipoverMap(d.dem, { latDeg: d.latDeg, lonDeg: d.lonDeg, dxM: d.input.dxM, dyM: d.input.dyM }, c.app.tipover, 200, 3).centre.p;
};
const peakHour = (c: Ctx): number => {
  const r = c.A.result;
  if (!r) return SC.m0.bestHour;
  let best = 0;
  for (let i = 0; i <= Math.min(r.count - 1, 36); i++) if (r.powerW[i] > r.powerW[best]) best = i;
  return best;
};
const powerAt = (c: Ctx, h: number): number => c.A.result?.powerW[Math.max(0, Math.min(c.A.result.count - 1, Math.round(h)))] ?? 0;

/** Put scenario A on a tutorial scenario, with the default hardware (the training changes one thing at a time). */
function scenario(sc: { siteId: string; startMs: number; days: number }, patch: { dxM?: number; dyM?: number } = {}): void {
  const s = s0();
  cancelSubsystemSwitch();
  s.setPlaying(false);
  if (s.compare) s.setCompare(false);
  s.setPower({ ...DEFAULT_POWER });
  s.setRelay({ ...DEFAULT_RELAY });
  s.setAttitude({ ...NOMINAL_ATTITUDE });
  s.setMast(2);
  s.updateScenario('A', { siteId: sc.siteId, startMs: sc.startMs, days: sc.days });
  s.setRelocation('A', patch.dxM ?? 0, patch.dyM ?? 0);
  s.setCursor(0);
  s.setView('orbit');
}

// ------------------------------------------------------------------ the script

export const SCRIPT: Step[] = [
  // ---------------------------------------------------------------- mission 0: first landing
  {
    id: 'm0-approach', mission: 0, cine: true, sfx: 'thrusters',
    enter: () => {
      const s = s0();
      s.setMode('planner');
      if (s.subsystem !== 'overview') s.setSubsystem('overview');
      s.setOverlay('none');
      scenario(SC.m0);
      camProbe.aim = 'far';
      landerAnim.deploy = 0;
      landerAnim.drop = DESCENT_KM;
    },
    say: (c, t) => t(`Powered descent over ${site(c)}, ${at(c, 0)} UTC.`, `Descenso propulsado sobre ${site(c)}, ${at(c, 0)} UTC.`),
    until: () => landerAnim.drop === 0,
  },
  {
    id: 'm0-landed', mission: 0, auto: 3500, sfx: 'deploy', until: () => landerAnim.deploy >= 1,
    say: (_c, t) => t('Successful landing: deploying the solar arrays to recover energy.', 'Alunizaje exitoso: procedemos a recuperar energía desplegando los paneles solares.'),
  },
  {
    id: 'm0-find-sun', mission: 0, focus: 'canvas', allow: ['drag'],
    enter: () => { camProbe.aim = null; },
    say: (_c, t) => t('Find the Sun: hold the left mouse button and move the mouse to turn the view.', 'Ubica el Sol: mantén el clic izquierdo y mueve el ratón para girar la vista.'),
    until: () => camProbe.sunOffDeg < 30,
    doIt: () => { camProbe.aim = 'sun'; },
    hint: ['The Sun is the bright disc just above the horizon.', 'El Sol es el disco brillante apenas sobre el horizonte.'],
  },
  {
    id: 'm0-zoom', mission: 0, focus: 'canvas', allow: ['wheel', 'drag'],
    enter: (c) => { c.memo.zoom0 = camProbe.dist; },
    say: (_c, t) => t('Now use the mouse wheel to zoom in on the lander.', 'Ahora usa la rueda del ratón para acercarte al módulo.'),
    until: (c) => camProbe.dist < (c.memo.zoom0 || 3) * 0.7,
    doIt: () => { camProbe.aim = 'zoom'; },
  },
  {
    id: 'm0-low-sun', mission: 0, auto: 6000,
    say: (c, t) => {
      const h = peakHour(c), p0 = powerAt(c, 0), pm = powerAt(c, h);
      return t(
        `The Sun is low on the panels: ${fmtNum(p0, 0)} W now, ${fmtNum(pm > 0 ? (100 * p0) / pm : 0, 0)} % of what they will give at ${at(c, h)} UTC (T+${fmtDuration(h)}), when the Sun is in its best position of the day (${fmtNum(pm, 0)} W). At the pole the Sun never climbs more than a couple of degrees: "best position" means the most power, not a high Sun.`,
        `El Sol llega bajo a los paneles: ${fmtNum(p0, 0)} W ahora, el ${fmtNum(pm > 0 ? (100 * p0) / pm : 0, 0)} % de lo que darán a las ${at(c, h)} UTC (T+${fmtDuration(h)}), cuando el Sol esté en su mejor posición del día (${fmtNum(pm, 0)} W). En el polo el Sol nunca sube más de un par de grados: «mejor posición» es la de máxima potencia, no un Sol alto.`,
      );
    },
  },
  {
    id: 'm0-transport', mission: 0, auto: 4500, reveal: ['transport'], focus: '[data-testid="transport"]', sfx: 'message',
    say: (_c, t) => t('This is the mission clock: −1 h, Play / Pause, +1 h and the speed (hours per second).', 'Este es el reloj de la misión: −1 h, Reproducir / Pausa, +1 h y la velocidad (horas por segundo).'),
  },
  {
    id: 'm0-play', mission: 0, focus: '[data-testid="transport"]',
    say: (c, t) => t(`Run time until the Sun is in its best position: T+${fmtDuration(peakHour(c))}.`, `Activa el paso del tiempo hasta que el Sol esté en su mejor posición: T+${fmtDuration(peakHour(c))}.`),
    until: (c) => c.app.cursorHours >= peakHour(c) - 0.5,
    doIt: (c) => { s0().setPlaying(false); s0().setCursor(peakHour(c)); },
    hint: ['Press Play, or step with +1 h.', 'Pulsa Reproducir o avanza con +1 h.'],
  },
  {
    id: 'm0-charged', mission: 0, auto: 4500, sfx: 'success',
    enter: (c) => { s0().setPlaying(false); s0().setCursor(peakHour(c)); },
    say: (c, t) => t(`Charging at full efficiency: ${fmtNum(powerAt(c, peakHour(c)), 0)} W. Now let us get in touch with the Earth.`, `Recarga a máxima eficiencia: ${fmtNum(powerAt(c, peakHour(c)), 0)} W. Ahora pongámonos en contacto con la Tierra.`),
  },
  {
    id: 'm0-find-earth', mission: 0, focus: 'canvas', allow: ['drag', 'wheel'],
    say: (_c, t) => t('Find the Earth and zoom in towards it.', 'Encuentra la Tierra y haz zoom hacia ella.'),
    until: () => camProbe.earthOffDeg < 30,
    doIt: () => { camProbe.aim = 'earth'; },
    hint: ['The Earth is the blue disc low over the horizon.', 'La Tierra es el disco azul bajo sobre el horizonte.'],
  },
  {
    id: 'm0-earth-sets', mission: 0, auto: 6000, sfx: 'radio',
    say: (c, t) => {
      const r = c.A.result;
      const cd = r ? emergencyCountdown(r, c.app.cursorHours) : null;
      const h = cd?.toLinkLossH ?? null;
      return cd?.linkNow && h !== null
        ? t(`The Earth will hide behind the terrain in ${fmtDuration(h)}: good thing we arrived in time! Radio link open.`, `La Tierra se esconderá tras el relieve en ${fmtDuration(h)}: ¡menos mal llegamos a tiempo! Enlace de radio abierto.`)
        : t('The Earth is behind the terrain right now: the link opens again later.', 'La Tierra está ahora tras el relieve: el enlace vuelve a abrirse más tarde.');
    },
  },
  {
    id: 'm0-done', mission: 0, cont: true, seal: true, sfx: 'success',
    say: (_c, t) => t('Mission accomplished', 'Misión exitosa'),
  },

  // ---------------------------------------------------------------- mission 1: site and date
  {
    id: 'm1-brief', mission: 1, auto: 5000, reveal: ['subsys', 'trays'], sfx: 'message',
    enter: () => { scenario({ ...SC.m1, startMs: Date.UTC(2027, 8, 1) }); s0().setUnlocked(['overview']); requestSubsystem('overview'); },
    say: (c, t) => t(`Another lander must touch down in two weeks at ${site(c)}. Only the first console is open; the other four are locked.`, `Otra nave debe alunizar en dos semanas en ${site(c)}. Solo la primera consola está abierta; las otras cuatro, bloqueadas.`),
  },
  {
    id: 'm1-overview', mission: 1, click: '[data-testid="subsys-overview"]', focus: '[data-testid="subsys-overview"]',
    say: (_c, t) => t('Click "Overview".', 'Haz clic en «Resumen».'),
  },
  {
    id: 'm1-date', mission: 1, focus: '[data-testid="start-A"]',
    enter: () => { if (s0().panels.leftTab !== 'sites') s0().openPanel('sites'); },
    say: (c, t) => t(`Set the window start to ${fmtDateTime(SC.m1.startMs).slice(0, 10)} for ${site(c)}.`, `Pon el inicio de ventana en ${fmtDateTime(SC.m1.startMs).slice(0, 10)} para ${site(c)}.`),
    until: (c) => c.app.scenarios.A.startMs === SC.m1.startMs,
    doIt: () => s0().updateScenario('A', { startMs: SC.m1.startMs }),
  },
  {
    id: 'm1-bad', mission: 1, auto: 6500, sfx: 'error',
    until: ready,
    say: (c, t) => {
      const r = c.A.result;
      if (!r) return t('Evaluating that date…', 'Evaluando esa fecha…');
      const dark = r.sunFrac[0] === 0, silent = (r.state[0] & STATE_RF_PHYSICAL) === 0;
      return t(
        `On that date ${dark ? 'there is no sunlight' : 'there is sunlight'} and ${silent ? 'no link with the Earth' : 'a link with the Earth'} at touchdown. Verdict: ${v(c.A)?.level === 'nogo' ? 'the mission cannot be completed as declared' : 'see the verdict above'}.`,
        `En esa fecha ${dark ? 'no hay luz solar' : 'hay luz solar'} y ${silent ? 'no hay comunicación con la Tierra' : 'hay comunicación con la Tierra'} al alunizar. Veredicto: ${v(c.A)?.level === 'nogo' ? 'la misión no se puede cumplir así' : 'ver el veredicto arriba'}.`,
      );
    },
  },
  {
    id: 'm1-search', mission: 1, focus: '[data-testid="win-run"]',
    enter: () => { s0().openPanel('windows'); useInsights.getState().setWindowConfig({ searchDays: 60 }); },
    say: (_c, t) => t('This date is not viable. Let us search when we can land in the next 60 days: click the search button.', 'Esta fecha es inviable. Busquemos cuándo podremos alunizar en los próximos 60 días: pulsa el botón de búsqueda.'),
    until: () => Boolean(useInsights.getState().windows.A),
    doIt: () => (document.querySelector('[data-testid="win-run"]') as HTMLElement | null)?.click(),
  },
  {
    id: 'm1-pick', mission: 1, focus: '[data-testid="win-list"]',
    say: (_c, t) => {
      const n = useInsights.getState().windows.A?.search.windows.length ?? 0;
      return t(`Perfect: ${n} window${n === 1 ? '' : 's'} found. Choose a valid date with "Land there".`, `Perfecto: ${n} ventana${n === 1 ? '' : 's'} encontrada${n === 1 ? '' : 's'}. Selecciona una fecha válida con «Alunizar ahí».`);
    },
    until: (c) => c.app.scenarios.A.startMs !== SC.m1.startMs,
    doIt: () => (document.querySelector('[data-testid="win-use"]') as HTMLElement | null)?.click(),
  },
  {
    id: 'm1-done', mission: 1, cont: true, seal: true, unlock: 'terrain', sfx: 'unlock',
    say: (c, t) => t(`Mission accomplished: landing on ${at(c, 0)} UTC. New console: Terrain / landing.`, `Misión completada: alunizaje el ${at(c, 0)} UTC. Nueva consola: Terreno / alunizaje.`),
  },

  // ---------------------------------------------------------------- mission 2: terrain and tip-over
  {
    id: 'm2-brief', mission: 2, focus: '[data-testid="subsys-terrain"]', click: '[data-testid="subsys-terrain"]',
    enter: () => scenario({ siteId: SC.m2.siteId, startMs: SC.m0.startMs, days: 14 }, { dxM: SC.m2.dxM, dyM: SC.m2.dyM }),
    say: (c, t) => t(`Next lander: ${site(c)}. It has a safe date, but the terrain can destroy it at touchdown. Click "Terrain / landing".`, `Siguiente nave: ${site(c)}. Tiene una fecha segura, pero el terreno puede destruirla al tocar suelo. Haz clic en «Terreno / alunizaje».`),
  },
  {
    id: 'm2-danger', mission: 2, auto: 6000, alert: true, sfx: 'alarm',
    until: ready,
    say: (c, t) => {
      const sl = c.A.result?.kpis.slopeDeg ?? 0;
      return t(
        `TIP-OVER DANGER: slope ${fmtNum(sl, 1)}° (red on the slope map from ${SLOPE_STOPS[3][0]}°; the verdict warns above ${VERDICT_LIMITS.slopeDeg}°), tip-over risk ${fmtNum(100 * tipP(c), 1)} %.`,
        `PELIGRO DE VUELCO: pendiente ${fmtNum(sl, 1)}° (rojo en el mapa de pendientes desde ${SLOPE_STOPS[3][0]}°; el veredicto avisa sobre ${VERDICT_LIMITS.slopeDeg}°), riesgo de vuelco ${fmtNum(100 * tipP(c), 1)} %.`,
      );
    },
  },
  {
    id: 'm2-overlay', mission: 2, focus: '[data-testid="seg-slope"]', click: '[data-testid="seg-slope"]',
    say: (_c, t) => t('The lander could tip over on this hill. Turn on the slope map: click "Slope".', 'El módulo corre riesgo de volcarse por la inclinación de la colina. Activemos el mapa de pendientes: haz clic en «Pendiente».'),
  },
  {
    id: 'm2-move', mission: 2, focus: 'canvas', allow: ['dblclick', 'drag', 'wheel'],
    say: (_c, t) => t(
      `Red areas are steeper than ${SLOPE_STOPS[3][0]}°; green ones are under ${SLOPE_STOPS[1][0]}°. There is level ground about ${fmtNum(SC.m2.distanceM, 0)} m away: double-click on a green patch to move the landing point.`,
      `Las zonas rojas superan los ${SLOPE_STOPS[3][0]}°; las verdes están bajo ${SLOPE_STOPS[1][0]}°. Hay terreno nivelado a unos ${fmtNum(SC.m2.distanceM, 0)} m: haz doble clic sobre una zona verde para reubicar el punto de aterrizaje.`,
    ),
    until: (c) => ready(c) && (c.A.result?.kpis.slopeDeg ?? 99) < SLOPE_STOPS[1][0] && tipP(c) < 0.01,
    doIt: () => s0().setRelocation('A', SC.m2.safeDxM, SC.m2.safeDyM),
    hint: ['Look for green near the lander, inside the dashed box.', 'Busca verde cerca del módulo, dentro del cuadro punteado.'],
  },
  {
    id: 'm2-ok', mission: 2, auto: 5000, sfx: 'success',
    say: (c, t) => t(`Slope ${fmtNum(c.A.result?.kpis.slopeDeg ?? 0, 1)}° | tip-over probability ${fmtNum(100 * tipP(c), 1)} %. Excellent manoeuvre: the lander will touch down level and stable.`, `Pendiente ${fmtNum(c.A.result?.kpis.slopeDeg ?? 0, 1)}° | probabilidad de vuelco ${fmtNum(100 * tipP(c), 1)} %. ¡Excelente maniobra! El módulo aterrizará estable y nivelado.`),
  },
  {
    id: 'm2-done', mission: 2, cont: true, seal: true, unlock: 'power', sfx: 'unlock',
    enter: () => s0().setOverlay('none'),
    say: (_c, t) => t('Terrain secured. New console: Power / thermal.', 'Terreno asegurado. Nueva consola: Energía / térmico.'),
  },

  // ---------------------------------------------------------------- mission 3: energy and cold
  {
    id: 'm3-brief', mission: 3, focus: '[data-testid="subsys-power"]', click: '[data-testid="subsys-power"]',
    enter: () => scenario(SC.m3),
    say: (_c, t) => t('Being level is not enough: at the south pole the night freezes the batteries. Click "Power / thermal".', 'Estar nivelado no basta: en el polo sur la noche es mortal y congela las baterías. Haz clic en «Energía / térmico».'),
  },
  {
    id: 'm3-alarm', mission: 3, auto: 7500, alert: true, sfx: 'alarm', focus: '[data-testid="drawer-bottom"]',
    until: ready,
    say: (c, t) => {
      const a = c.A.result?.adv.kpis;
      c.memo.e2 = c.A.result?.kpis.energyWh ?? 0;
      if (!a || a.thermalDeathH === null) return t('Reading the thermal model…', 'Leyendo el modelo térmico…');
      return t(
        `Cryogenic alert: with the arrays on the deck (2 m), the shadow of the terrain starves them. At T+${fmtDuration(a.thermalDeathH)} (${at(c, a.thermalDeathH)} UTC) the bus reaches ${fmtNum(T_BATTERY_DEATH_K - 273.15, 0)} °C and the battery freezes, after ${fmtDuration(a.heaterHours)} of heaters. The chart shows the temperature falling.`,
        `Alerta criogénica: con los paneles sobre la cubierta (2 m), la sombra del relieve los deja sin luz. En T+${fmtDuration(a.thermalDeathH)} (${at(c, a.thermalDeathH)} UTC) el bus llega a ${fmtNum(T_BATTERY_DEATH_K - 273.15, 0)} °C y la batería se congela, tras ${fmtDuration(a.heaterHours)} de calefactores. La gráfica muestra la temperatura cayendo.`,
      );
    },
  },
  {
    id: 'm3-mast', mission: 3, focus: '[data-testid="mast"]',
    enter: () => { if (s0().panels.leftTab !== 'hardware') s0().openPanel('hardware'); },
    say: (_c, t) => t('If we raise the arrays on the mast, they catch the light passing over the ridge. Change "Array and antenna height" to 10 m.', 'Si elevamos los paneles sobre el mástil, captaremos la luz que pasa por encima de la cresta. Cambia «Altura de paneles y antena» a 10 m.'),
    until: (c) => c.app.mastM === 10,
    doIt: () => s0().setMast(10),
  },
  {
    id: 'm3-ok', mission: 3, auto: 7000, sfx: 'servo',
    until: (c) => ready(c) && c.A.input?.mastM === 10,
    say: (c, t) => {
      const r = c.A.result;
      return t(
        `Saved from freezing! On the mast the arrays collect ${fmtEnergy(r?.kpis.energyWh ?? 0)} over the window (${fmtEnergy(c.memo.e2 || 0)} on the deck) and the bus stays above ${fmtNum(Math.round(r?.adv.kpis.minBusC ?? 0) || 0, 0)} °C: the lander gets through the night.`,
        `¡Salvados del congelamiento! En el mástil los paneles captan ${fmtEnergy(r?.kpis.energyWh ?? 0)} en la ventana (${fmtEnergy(c.memo.e2 || 0)} sobre la cubierta) y el bus no baja de ${fmtNum(Math.round(r?.adv.kpis.minBusC ?? 0) || 0, 0)} °C: la nave resiste la noche.`,
      );
    },
  },
  {
    id: 'm3-done', mission: 3, cont: true, seal: true, unlock: 'comms', sfx: 'static',
    say: (_c, t) => t('Thermal survival confirmed. New console: Comms / RF.', 'Supervivencia térmica confirmada. Nueva consola: Comunicaciones / RF.'),
  },

  // ---------------------------------------------------------------- mission 4: communications
  {
    id: 'm4-brief', mission: 4, focus: '[data-testid="subsys-comms"]', click: '[data-testid="subsys-comms"]',
    enter: () => scenario(SC.m4),
    say: (_c, t) => t('We have energy and firm ground, but we are cut off from Mission Control. Click "Comms / RF".', 'Tenemos energía y suelo firme, pero estamos incomunicados con el Control de Misión. Haz clic en «Comunicaciones / RF».'),
  },
  {
    id: 'm4-los', mission: 4, auto: 6000, alert: true, sfx: 'static',
    until: ready,
    say: (c, t) => {
      const vv = v(c.A);
      return t(`Link with the Earth only ${fmtNum(vv?.linkPct ?? 0, 0)} % of the time; the longest silence lasts ${fmtDuration(vv?.longestLinkGapH ?? 0)}.`, `Enlace con la Tierra solo el ${fmtNum(vv?.linkPct ?? 0, 0)} % del tiempo; el silencio más largo dura ${fmtDuration(vv?.longestLinkGapH ?? 0)}.`);
    },
  },
  {
    id: 'm4-horizon', mission: 4, focus: '[data-testid="bottom-horizon"]', click: '[data-testid="bottom-horizon"]',
    say: (_c, t) => t('Open the horizon profile to see what blocks our signal: click "Horizon 360°".', 'Abre el perfil de horizonte para comprobar qué bloquea nuestra señal: haz clic en «Horizonte 360°».'),
  },
  {
    id: 'm4-why', mission: 4, auto: 7000, focus: '[data-testid="drawer-bottom"]',
    say: (_c, t) => t('The Earth rocks up and down in the sky (libration) and sinks behind the terrain. Rock blocks the microwaves to the ground stations. Without a direct view of the Earth, we need a relay satellite in lunar orbit.', 'La Tierra sube y baja en el cielo (libración) y se hunde tras el relieve. La roca bloquea las microondas hacia las antenas terrestres. Sin visión directa a la Tierra, debemos recurrir a un satélite repetidor en órbita lunar.'),
  },
  {
    id: 'm4-relay', mission: 4, focus: '[data-testid="relay-enable"]',
    enter: () => { if (s0().panels.leftTab !== 'hardware') s0().openPanel('hardware'); },
    say: (_c, t) => t('Turn on the orbital relay.', 'Activa el relevo orbital.'),
    until: (c) => c.app.relay.enabled,
    doIt: () => s0().setRelay({ enabled: true }),
  },
  {
    id: 'm4-ok', mission: 4, auto: 6000, sfx: 'radio',
    until: (c) => ready(c) && Boolean(c.A.input?.relay?.enabled),
    say: (c, t) => {
      const vv = v(c.A);
      return t(`Live telemetry restored: with the relay there is a path to the Earth ${fmtNum(vv?.linkPct ?? 0, 0)} % of the time, at ${fmtNum(c.app.relay.rateMbps, 1)} Mbps from the lander to the relay.`, `¡Telemetría en vivo restablecida! Con el relevo hay camino a la Tierra el ${fmtNum(vv?.linkPct ?? 0, 0)} % del tiempo, a ${fmtNum(c.app.relay.rateMbps, 1)} Mbps del módulo al relevo.`);
    },
  },
  {
    id: 'm4-done', mission: 4, cont: true, seal: true,
    say: (_c, t) => t('Communications linked.', 'Comunicaciones enlazadas.'),
  },

  // ---------------------------------------------------------------- mission 5: contingency
  {
    id: 'm5-brief', mission: 5, focus: '[data-testid="subsys-terrain"]', click: '[data-testid="subsys-terrain"]',
    enter: () => { scenario(SC.m5); s0().setAttitude({ gimbalRangeDeg: 0 }); },
    say: (c, t) => t(`Even with the best plan, real landings can go wrong. This lander has its antenna fixed (gimbal range ${fmtNum(c.app.attitude.gimbalRangeDeg, 0)}°). Click "Terrain / landing" to open "Attitude and tip-over".`, `Incluso con el mejor plan, los alunizajes reales pueden salir mal. Esta nave tiene la antena fija (rango del cardán ${fmtNum(c.app.attitude.gimbalRangeDeg, 0)}°). Haz clic en «Terreno / alunizaje» para abrir «Actitud y vuelco».`),
  },
  {
    id: 'm5-preset', mission: 5, focus: '[data-testid="preset-im1"]',
    enter: (c) => { c.memo.rf0 = c.A.result?.adv.kpis.rfAvailabilityPct ?? 0; if (s0().panels.leftTab !== 'contingency') s0().openPanel('contingency'); },
    say: (_c, t) => t(`On IM-1 Odysseus the lander hit the ground and came to rest tilted about ${fmtNum(im1Attitude().rollDeg, 0)}°. Click the "IM-1 Odysseus" preset to simulate it.`, `En IM-1 Odysseus la nave golpeó el suelo y quedó inclinada unos ${fmtNum(im1Attitude().rollDeg, 0)}°. Haz clic en el preset «IM-1 Odysseus» para simular el incidente.`),
    until: (c) => c.app.attitude.rollDeg === im1Attitude().rollDeg,
  },
  {
    id: 'm5-lost', mission: 5, auto: 6500, alert: true, sfx: 'error',
    until: (c) => ready(c) && (c.A.input?.attitude?.rollDeg ?? 0) === im1Attitude().rollDeg,
    say: (c, t) => {
      const a = c.A.result?.adv.kpis;
      return t(`The tilted antenna points away from the Earth: the downlink closes ${fmtNum(a?.rfAvailabilityPct ?? 0, 0)} % of the time (it was ${fmtNum(c.memo.rf0 || 0, 0)} % level), mean pointing loss ${fmtNum(a?.meanPointingLossDb ?? 0, 1)} dB.`, `La antena inclinada apunta lejos de la Tierra: la descarga cierra el ${fmtNum(a?.rfAvailabilityPct ?? 0, 0)} % del tiempo (nivelada era el ${fmtNum(c.memo.rf0 || 0, 0)} %), pérdida media de apuntamiento ${fmtNum(a?.meanPointingLossDb ?? 0, 1)} dB.`);
    },
  },
  {
    id: 'm5-gimbal', mission: 5, focus: '[data-testid="gimbal-range"]',
    say: (_c, t) => t(`Free the antenna gimbal so it can steer back towards the Earth: raise "Antenna gimbal range" (about ${SC.m5.gimbalDeg}° is enough here).`, `Liberemos el cardán de la antena para que vuelva a apuntar a la Tierra: sube «Rango del cardán de antena» (aquí bastan unos ${SC.m5.gimbalDeg}°).`),
    until: (c) => ready(c) && (c.A.input?.attitude?.gimbalRangeDeg ?? 0) > 0 && (c.A.result?.adv.kpis.rfAvailabilityPct ?? 0) >= 0.9 * (c.memo.rf0 || 1),
    doIt: () => s0().setAttitude({ gimbalRangeDeg: SC.m5.gimbalDeg }),
  },
  {
    id: 'm5-ok', mission: 5, auto: 5500, sfx: 'success',
    say: (c, t) => t(`Link recovered despite the impact: the downlink closes ${fmtNum(c.A.result?.adv.kpis.rfAvailabilityPct ?? 0, 0)} % of the time again with a ${fmtNum(c.app.attitude.gimbalRangeDeg, 0)}° gimbal.`, `¡Enlace recuperado a pesar del impacto! La descarga vuelve a cerrar el ${fmtNum(c.A.result?.adv.kpis.rfAvailabilityPct ?? 0, 0)} % del tiempo con un cardán de ${fmtNum(c.app.attitude.gimbalRangeDeg, 0)}°.`),
  },
  {
    id: 'm5-done', mission: 5, cont: true, seal: true, unlock: 'science', sfx: 'unlock',
    say: (_c, t) => t('Contingency overcome. New console: Science.', 'Contingencia superada. Nueva consola: Ciencia.'),
  },

  // ---------------------------------------------------------------- mission 6: science
  {
    id: 'm6-brief', mission: 6, focus: '[data-testid="subsys-science"]', click: '[data-testid="subsys-science"]',
    enter: () => scenario({ siteId: 'shackleton-ridge', startMs: SC.m0.startMs, days: 14 }),
    say: (_c, t) => t('Now that you can keep the lander alive, decide WHERE it is worth sending. Click "Science".', 'Ahora que sabes mantener viva la nave, debes decidir DÓNDE vale la pena enviarla. Haz clic en «Ciencia».'),
  },
  {
    id: 'm6-score', mission: 6, auto: 7000, focus: '[data-testid="score-panel"]',
    until: () => Boolean(useInsights.getState().score.A),
    say: (c, t) => {
      const sc = useInsights.getState().score.A;
      return t(
        `${site(c)} scores ${fmtNum(sc?.score ?? 0, 0)}/100 on the suitability index, which weighs four criteria with an anchored range: Earth visibility, sunlight, slope and FeO. Let us compare it with another site.`,
        `${site(c)} obtiene ${fmtNum(sc?.score ?? 0, 0)}/100 en el índice de aptitud, que pondera cuatro criterios con rango anclado: visibilidad de la Tierra, luz solar, pendiente y FeO. Comparémoslo con otro sitio.`,
      );
    },
  },
  {
    id: 'm6-compare', mission: 6, focus: '[data-testid="compare-toggle"]',
    enter: () => { requestSubsystem('overview'); window.setTimeout(() => s0().openPanel('windows'), 1100); },
    say: (_c, t) => t('In Overview > Landing windows, turn on "Compare with another site or date".', 'En Resumen > Ventanas de aterrizaje, activa «Comparar con otro sitio o fecha».'),
    until: (c) => c.app.compare,
    doIt: () => s0().setCompare(true),
  },
  {
    id: 'm6-pick-b', mission: 6, focus: '[data-testid="site-B"]',
    say: (_c, t) => t('Choose "Malapert Massif" (an Artemis candidate region) as site B.', 'Selecciona «Malapert Massif» (región candidata de Artemis) como sitio B.'),
    until: (c) => c.app.scenarios.B.siteId === 'malapert-massif',
    doIt: () => s0().updateScenario('B', { siteId: 'malapert-massif' }),
  },
  {
    id: 'm6-bars', mission: 6, auto: 7500, focus: '[data-testid="quick-B"]',
    until: (c) => c.B.result !== null && c.B.latDeg !== c.A.latDeg,
    say: (c, t) => {
      const a = c.A.result?.kpis, b = c.B.result?.kpis;
      return t(
        `Malapert Massif: sunlight ${fmtNum(b?.illuminationPct ?? 0, 0)} % and Earth in view ${fmtNum(b?.dtePct ?? 0, 0)} %, against ${fmtNum(a?.illuminationPct ?? 0, 0)} % and ${fmtNum(a?.dtePct ?? 0, 0)} % here. The index of each site is in Science.`,
        `Malapert Massif: luz solar ${fmtNum(b?.illuminationPct ?? 0, 0)} % y Tierra a la vista ${fmtNum(b?.dtePct ?? 0, 0)} %, frente a ${fmtNum(a?.illuminationPct ?? 0, 0)} % y ${fmtNum(a?.dtePct ?? 0, 0)} % aquí. El índice de cada sitio está en Ciencia.`,
      );
    },
  },
  {
    id: 'm6-adopt', mission: 6, focus: '[data-testid="adopt-b"]', click: '[data-testid="adopt-b"]',
    say: (_c, t) => t('Press "Adopt this site" to make it our official destination.', 'Presiona «Adoptar este sitio» para validarlo como nuestro destino oficial.'),
  },
  {
    id: 'm6-done', mission: 6, cont: true, seal: true,
    // The validated destination is kept when the training ends.
    enter: () => useBeginner.getState().set({ validated: { ...s0().scenarios.A } }),
    say: (c, t) => t(`Science site validated: ${site(c)}.`, `Sitio científico validado: ${site(c)}.`),
  },

  // ---------------------------------------------------------------- mission 7: emergency (final exam)
  {
    id: 'm7-alert', mission: 7, auto: 6500, alert: true, sfx: 'siren', reveal: ['mode'],
    enter: () => {
      const s = s0();
      scenario({ siteId: SC.m7.siteId, startMs: SC.m7.nowMs, days: SC.m7.days });
      s.setNowOverride(SC.m7.nowMs);
      s.setMode('triage');
    },
    say: (c, t) => t(`CRITICAL FLIGHT CONTROL ALERT! An uncrewed lander lost its inertial navigation and touched down blind near ${site(c)}. Emergency mode.`, `¡ALERTA CRÍTICA DE CONTROL DE VUELO! Una nave no tripulada tuvo un fallo de navegación inercial y tocó suelo a ciegas cerca de ${site(c)}. Modo Emergencia.`),
  },
  {
    id: 'm7-headline', mission: 7, auto: 8000, focus: '[data-testid="tri-step-1"]',
    until: () => (document.querySelector('[data-testid="exit-block"]')?.getAttribute('data-state') ?? 'pending') !== 'pending',
    say: (_c, t) => {
      const head = document.querySelector('[data-testid="surv-head"]')?.textContent?.trim() ?? '';
      return t(`In an emergency there is no time to set up subsystems: the system works out by itself whether there is a way out. Headline: "${head}"`, `En una emergencia no hay tiempo para configurar subsistemas: el sistema calcula solo si existe una salida. Titular: «${head}»`);
    },
  },
  {
    id: 'm7-exit', mission: 7, focus: '[data-testid="exit-block"]', click: '[data-testid="exit-move"]',
    // The way out the app computed (the button runs exactly this one).
    until: () => Boolean(document.querySelector('[data-testid="exit-move"]')),
    say: (_c, t) => {
      const btn = document.querySelector('[data-testid="exit-move"]');
      const d = Number(btn?.getAttribute('data-distance-m') ?? 0), az = Number(btn?.getAttribute('data-azimuth-deg') ?? 0);
      return t(`The way-out search found light and safe ground ${fmtNum(d, 0)} m to the ${cardinal(az)}. Click "Run this way out" to save the lander.`, `El algoritmo encontró luz y terreno seguro a ${fmtNum(d, 0)} m al ${cardinal(az)}. Haz clic en «Ejecutar esta salida» para salvar el módulo.`);
    },
  },
  {
    id: 'm7-saved', mission: 7, auto: 7000, sfx: 'success',
    until: () => document.querySelector('[data-testid="surv-head"]')?.getAttribute('data-state') === 'survives',
    say: (_c, t) => {
      const head = document.querySelector('[data-testid="surv-head"]')?.textContent?.trim() ?? '';
      return t(`Rescue completed. "${head}"`, `Rescate completado. «${head}»`);
    },
  },
  {
    id: 'm7-diploma', mission: 7, diploma: true, seal: true, sfx: 'success',
    say: (_c, t) => t('You have learnt to read the grazing light, protect the lander from the polar cold, search for landing windows, rescue the link after an impact and solve emergencies in real time. You are ready to operate without assistance.', 'Has aprendido a leer la luz rasante, proteger la nave del frío polar, buscar ventanas de aterrizaje, rescatar la comunicación tras un impacto y resolver emergencias en tiempo real. Estás listo para operar sin asistencia.'),
  },
];

/** Height the lander starts the descent from, scene km (about 600 m above the ground). */
export const DESCENT_KM = 0.6;

/** What each mission is about and what it unlocks, for the splash and the celebration cards. */
export const MISSION_INFO: { goal: [string, string]; unlocks: Subsystem | null }[] = [
  { goal: ['Land, recover energy and call the Earth.', 'Alunizar, recuperar energía y llamar a la Tierra.'], unlocks: 'overview' },
  { goal: ['Find a date when a lander can touch down and survive.', 'Encontrar una fecha en que una nave pueda alunizar y sobrevivir.'], unlocks: 'terrain' },
  { goal: ['Move the landing point off a slope that would tip the lander over.', 'Sacar el punto de alunizaje de una ladera que volcaría la nave.'], unlocks: 'power' },
  { goal: ['Keep the battery from freezing through the lunar night.', 'Evitar que la batería se congele durante la noche lunar.'], unlocks: 'comms' },
  { goal: ['Restore contact with the Earth when the terrain hides it.', 'Recuperar el contacto con la Tierra cuando el relieve la oculta.'], unlocks: null },
  { goal: ['Save the radio link after a rough landing.', 'Salvar el enlace de radio tras un alunizaje accidentado.'], unlocks: 'science' },
  { goal: ['Choose where the mission is worth sending.', 'Elegir adónde vale la pena enviar la misión.'], unlocks: null },
  { goal: ['Rescue a lander that came down blind, with no time to spare.', 'Rescatar una nave que cayó a ciegas, sin tiempo que perder.'], unlocks: null },
];

export const MISSION_TITLES: [string, string][] = [
  ['First landing', 'Primer alunizaje'], ['Site and date', 'Sitio y fecha'], ['Terrain and tip-over', 'Terreno y vuelco'], ['Energy and cold', 'Energía y frío'],
  ['Communications', 'Comunicaciones'], ['Contingency', 'Contingencia'], ['Science', 'Ciencia'], ['Emergency', 'Emergencia'],
];
