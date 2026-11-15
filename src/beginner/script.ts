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
  BAND_FREQUENCY_HZ, DEFAULT_POWER, DEFAULT_RELAY, DEFAULT_RF, RELOCATION_LIMIT_M, DEFAULT_UNCERTAINTY, GROUND_STATIONS, NOMINAL_ATTITUDE, STATE_RF_PHYSICAL, T_BATTERY_DEATH_K, T_FREEZE_K, Verdict, emergencyCountdown, missionVerdict, tipoverMap,
} from '../engine';
import { SLOPE_STOPS } from '../components/3d/Terrain';
import { im1Attitude } from './scenarioCheck';
import { hibernationHours } from '../components/dashboard/SiteCards';
import { camProbe, landerAnim } from '../components/3d/sceneMath';
import { requestSubsystem, cancelSubsystemSwitch } from '../components/dashboard/SubsystemSwitch';
import { ScenarioData } from '../state/mission';
import { AppState, Subsystem, scenarioLatLon, useApp } from '../state/store';
import { DISPERSION_RADIUS_M, DISPERSION_SIZE, useInsights } from '../state/insights';
import { EXIT_MOVE_RADIUS_M } from '../state/exitPlan';
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

  // ---------------------------------------------------------------- mission 1: landing windows, approach and vitals
  {
    id: 'm1-brief', mission: 1, auto: 0, reveal: ['subsys', 'trays'], sfx: 'message',
    enter: () => { scenario({ ...SC.m1, startMs: Date.UTC(2027, 8, 1) }); s0().setUnlocked(['overview']); requestSubsystem('overview'); },
    say: (c, t) => t(`Another lander must touch down in two weeks at ${site(c)}. Only the first console is open; the others are locked.`, `Otra nave debe alunizar en dos semanas en ${site(c)}. Solo la primera consola está abierta; las demás están bloqueadas.`),
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
    id: 'm1-bad', mission: 1, auto: 0, sfx: 'error', until: ready,
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
    id: 'm1-search', mission: 1, focus: '[data-testid="win-run"]', click: '[data-testid="win-run"]',
    enter: () => { s0().openPanel('windows'); useInsights.getState().setWindowConfig({ searchDays: 60 }); },
    say: (_c, t) => t('This date is not viable. Let us search when we can land in the next 60 days: click the search button.', 'Esta fecha es inviable. Busquemos cuándo podremos alunizar en los próximos 60 días: pulsa el botón de búsqueda.'),
    until: () => Boolean(useInsights.getState().windows.A),
  },
  {
    id: 'm1-reasons', mission: 1, auto: 0, focus: '[data-testid="win-reasons"]',
    enter: (c) => { const w = useInsights.getState().windows.A; c.memo.az0 = useInsights.getState().windowConfig.approachAzDeg; c.memo.glare0 = w?.search.counts.glare ?? 0; c.memo.wash0 = w?.search.counts.washout ?? 0; },
    say: (c, t) => t(
      `Look at why so many dates were rejected. Besides darkness and ground stations, descending straight into the grazing Sun blinds the navigation cameras (glare: ${fmtNum(c.memo.glare0 || 0, 0)} dates), and with the Sun right behind the rock shadows vanish (washout: ${fmtNum(c.memo.wash0 || 0, 0)} dates).`,
      `Observa por qué se descartaron tantas fechas. Además de la oscuridad y las estaciones terrenas, bajar de frente al Sol rasante encandila las cámaras de navegación (deslumbramiento: ${fmtNum(c.memo.glare0 || 0, 0)} fechas) y con el Sol justo detrás desaparecen las sombras de las rocas (lavado: ${fmtNum(c.memo.wash0 || 0, 0)} fechas).`,
    ),
  },
  {
    id: 'm1-heading', mission: 1, focus: '[data-testid="win-heading"]',
    say: (c, t) => t(`Turn the "Approach heading" (now ${fmtNum(c.memo.az0 || 0, 0)}°) to come in with the Sun at the side.`, `Gira el «Rumbo de aproximación» (ahora ${fmtNum(c.memo.az0 || 0, 0)}°) para entrar con el Sol de costado.`),
    until: (c) => Math.abs(useInsights.getState().windowConfig.approachAzDeg - (c.memo.az0 || 0)) >= 30,
    doIt: (c) => useInsights.getState().setWindowConfig({ approachAzDeg: ((c.memo.az0 || 0) + 90) % 360 }),
  },
  {
    id: 'm1-research', mission: 1, focus: '[data-testid="win-run"]', click: '[data-testid="win-run"]',
    say: (_c, t) => t('Search again with the new heading.', 'Vuelve a buscar con el nuevo rumbo.'),
    until: () => useInsights.getState().windows.A?.search.config.approachAzDeg === useInsights.getState().windowConfig.approachAzDeg,
  },
  {
    id: 'm1-cleared', mission: 1, auto: 0,
    say: (c, t) => {
      const w = useInsights.getState().windows.A?.search;
      const before = (c.memo.glare0 || 0) + (c.memo.wash0 || 0), after = (w?.counts.glare ?? 0) + (w?.counts.washout ?? 0);
      c.memo.better = after < before ? 1 : 0;
      const verdict = after < before
        ? t('Fewer dates lost to the light.', 'Menos fechas perdidas por la luz.')
        : after > before
          ? t('This heading loses more dates to the light: the Sun now sits ahead or behind on other days. Each heading favours different dates.', 'Este rumbo pierde más fechas por la luz: ahora el Sol queda de frente o detrás en otros días. Cada rumbo favorece fechas distintas.')
          : t('The light rejects the same number of dates.', 'La luz descarta el mismo número de fechas.');
      return t(
        `With a heading of ${fmtNum(w?.config.approachAzDeg ?? 0, 0)}°: glare ${fmtNum(c.memo.glare0 || 0, 0)} → ${fmtNum(w?.counts.glare ?? 0, 0)} dates, washout ${fmtNum(c.memo.wash0 || 0, 0)} → ${fmtNum(w?.counts.washout ?? 0, 0)}; ${fmtNum(w?.windows.length ?? 0, 0)} windows open. ${verdict}`,
        `Con rumbo ${fmtNum(w?.config.approachAzDeg ?? 0, 0)}°: deslumbramiento ${fmtNum(c.memo.glare0 || 0, 0)} → ${fmtNum(w?.counts.glare ?? 0, 0)} fechas, lavado ${fmtNum(c.memo.wash0 || 0, 0)} → ${fmtNum(w?.counts.washout ?? 0, 0)}; ${fmtNum(w?.windows.length ?? 0, 0)} ventanas abiertas. ${verdict}`,
      );
    },
  },
  {
    id: 'm1-pick', mission: 1, focus: '[data-testid="win-list"]',
    say: (c, t) => (c.memo.better === 1
      ? t('Clearer approach! Now choose a valid date with "Land there".', '¡Aproximación más despejada! Ahora elige una fecha válida con «Alunizar ahí».')
      : t('Choose one of the valid dates with "Land there".', 'Elige una de las fechas válidas con «Alunizar ahí».')),
    until: (c) => c.app.scenarios.A.startMs !== SC.m1.startMs,
    doIt: () => (document.querySelector('[data-testid="win-use"]') as HTMLElement | null)?.click(),
  },
  {
    id: 'm1-eye', mission: 1, focus: '[data-testid="seg-eye"]', click: '[data-testid="seg-eye"]',
    say: (_c, t) => t('Before authorising the descent, let us see what the lander will see: click "Lander eye".', 'Antes de autorizar el descenso, veamos qué verá la nave: haz clic en «Vista lander».'),
  },
  {
    id: 'm1-vitals', mission: 1, auto: 0, focus: '[data-testid="vitals"]',
    enter: () => s0().openPanel('vitals'),
    until: ready,
    say: (c, t) => {
      const r = c.A.result;
      const cd = r ? emergencyCountdown(r, c.app.cursorHours) : null;
      return t(
        `At eye level the mountains close the horizon. The vitals: ${cd?.sunNow ? `sunlight for ${cd.toDarkH === null ? 'the whole window' : fmtDuration(cd.toDarkH)}` : 'dark now'}, link with the Earth ${cd?.linkNow ? 'open' : 'closed'}, ${cd?.toLossH === null ? 'it survives the window' : `lost in ${fmtDuration(cd?.toLossH ?? 0)}`}.`,
        `A ras de suelo las montañas cierran el horizonte. Signos vitales: ${cd?.sunNow ? `sol durante ${cd.toDarkH === null ? 'toda la ventana' : fmtDuration(cd.toDarkH)}` : 'a oscuras ahora'}, enlace con la Tierra ${cd?.linkNow ? 'abierto' : 'cerrado'}, ${cd?.toLossH === null ? 'sobrevive la ventana' : `se pierde en ${fmtDuration(cd?.toLossH ?? 0)}`}.`,
      );
    },
  },
  {
    id: 'm1-done', mission: 1, cont: true, seal: true, unlock: 'terrain', sfx: 'unlock',
    enter: () => s0().setView('orbit'),
    say: (_c, t) => t('Window and approach secured.', 'Ventana y aproximación aseguradas.'),
  },

  // ---------------------------------------------------------------- mission 2: terrain, dispersion and tip-over
  {
    id: 'm2-brief', mission: 2, focus: '[data-testid="subsys-terrain"]', click: '[data-testid="subsys-terrain"]',
    enter: () => scenario({ siteId: SC.m2.siteId, startMs: SC.m0.startMs, days: 14 }, { dxM: SC.m2.dxM, dyM: SC.m2.dyM }),
    say: (c, t) => t(`The next lander goes to ${site(c)}. It has a good date, but the south-polar ground is a trap of slopes and hidden rocks. Click "Terrain / landing".`, `La próxima nave va a ${site(c)}. Tiene una fecha perfecta, pero el suelo del polo sur es una trampa de pendientes y rocas ocultas. Haz clic en «Terreno / alunizaje».`),
  },
  {
    id: 'm2-danger', mission: 2, auto: 0, alert: true, sfx: 'alarm', until: ready,
    say: (c, t) => {
      const sl = c.A.result?.kpis.slopeDeg ?? 0;
      return t(`TIP-OVER DANGER: slope ${fmtNum(sl, 1)}° (red on the slope map from ${SLOPE_STOPS[3][0]}°), tip-over probability ${fmtNum(100 * tipP(c), 1)} %.`, `PELIGRO DE VUELCO: pendiente ${fmtNum(sl, 1)}° (rojo en el mapa de pendientes desde ${SLOPE_STOPS[3][0]}°), probabilidad de vuelco ${fmtNum(100 * tipP(c), 1)} %.`);
    },
  },
  {
    id: 'm2-overlay', mission: 2, focus: '[data-testid="seg-slope"]', click: '[data-testid="seg-slope"]',
    say: (_c, t) => t('Click "Slope" to colour the relief by its steepness.', 'Haz clic en «Pendiente» para teñir el relieve según su inclinación.'),
  },
  {
    id: 'm2-move', mission: 2, focus: 'canvas', allow: ['dblclick', 'drag', 'wheel'],
    say: (_c, t) => t(
      `Red is steeper than ${SLOPE_STOPS[3][0]}°, green is under ${SLOPE_STOPS[1][0]}°. There is level ground about ${fmtNum(SC.m2.distanceM, 0)} m away: drag the lander or double-click a green patch (up to ±${RELOCATION_LIMIT_M} m).`,
      `El rojo supera los ${SLOPE_STOPS[3][0]}° y el verde está bajo ${SLOPE_STOPS[1][0]}°. Hay terreno nivelado a unos ${fmtNum(SC.m2.distanceM, 0)} m: arrastra el módulo o haz doble clic en una zona verde (hasta ±${RELOCATION_LIMIT_M} m).`,
    ),
    until: (c) => ready(c) && (c.A.result?.kpis.slopeDeg ?? 99) < SLOPE_STOPS[1][0] && tipP(c) < 0.01,
    doIt: () => s0().setRelocation('A', SC.m2.safeDxM, SC.m2.safeDyM),
    hint: ['Look for green near the lander, inside the dashed box.', 'Busca verde cerca del módulo, dentro del cuadro punteado.'],
  },
  {
    id: 'm2-ok', mission: 2, auto: 0, sfx: 'success',
    say: (c, t) => {
      const a = c.app.scenarios.A;
      return t(`Lander offset ${fmtNum(Math.hypot(a.dxM, a.dyM), 0)} m. Slope ${fmtNum(c.A.result?.kpis.slopeDeg ?? 0, 1)}°, tip-over probability ${fmtNum(100 * tipP(c), 1)} %.`, `Desplazamiento del módulo ${fmtNum(Math.hypot(a.dxM, a.dyM), 0)} m. Pendiente ${fmtNum(c.A.result?.kpis.slopeDeg ?? 0, 1)}°, probabilidad de vuelco ${fmtNum(100 * tipP(c), 1)} %.`);
    },
  },
  {
    id: 'm2-disp', mission: 2, auto: 0, focus: '[data-testid="dispersion-block"]',
    enter: () => { s0().setOverlay('none'); s0().openPanel('survival'); },
    until: () => Boolean(document.querySelector('[data-testid="dispersion-grid"]')),
    say: (_c, t) => t(`The thrusters do not land to the metre: the lander can come down anywhere in this ${DISPERSION_SIZE} × ${DISPERSION_SIZE} grid within ${DISPERSION_RADIUS_M} m, and each cell is a full mission. The laser map (LOLA) also has a height error.`, `Los propulsores no aterrizan al metro: la nave puede posarse en cualquier punto de esta malla ${DISPERSION_SIZE} × ${DISPERSION_SIZE} a ${DISPERSION_RADIUS_M} m, y cada celda es una misión completa. Además, el mapa láser (LOLA) tiene un error de altura.`),
  },
  {
    id: 'm2-rms', mission: 2, focus: '[data-testid="unc-sigma"]',
    say: (_c, t) => t(`Raise the "Height error (RMS)" above the typical ${fmtNum(DEFAULT_UNCERTAINTY.sigmaM, 1)} m to test a worse terrain model.`, `Sube el «Error de altura (RMS)» por encima de los ${fmtNum(DEFAULT_UNCERTAINTY.sigmaM, 1)} m típicos para probar un modelo de terreno peor.`),
    until: () => Number((document.querySelector('[data-testid="unc-sigma"]') as HTMLInputElement | null)?.value ?? 0) > DEFAULT_UNCERTAINTY.sigmaM,
    doIt: () => {
      const el = document.querySelector('[data-testid="unc-sigma"]') as HTMLInputElement | null;
      if (!el) return;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      set?.call(el, String(DEFAULT_UNCERTAINTY.sigmaM * 2.5));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
  },
  {
    id: 'm2-variants', mission: 2, focus: '[data-testid="unc-run"]', click: '[data-testid="unc-run"]',
    say: (_c, t) => t('Press the button to re-fly the mission on many statistical variants of the ground.', 'Pulsa el botón para volver a volar la misión sobre muchas variantes estadísticas del suelo.'),
    until: () => Boolean(document.querySelector('[data-testid="unc-stats"]')),
  },
  {
    id: 'm2-pstats', mission: 2, auto: 0, focus: '[data-testid="unc-stats"]',
    say: (c, t) => {
      const p = document.querySelector('[data-testid="unc-stats"] .band-head output')?.textContent?.trim() ?? '';
      const lost = !(c.A.result?.kpis.survives ?? true);
      const extra = lost ? t(' On this date the lander does not get through the window whatever the terrain: that is a power problem, which the next console solves.', ' En esta fecha la nave no resiste la ventana sea cual sea el terreno: es un problema de energía, que resuelve la siguiente consola.') : '';
      return t(`Probability of surviving the window over the terrain variants: ${p}. The P10 · P50 · P90 bands show how much each figure could change.${extra}`, `Probabilidad de sobrevivir la ventana sobre las variantes de terreno: ${p}. Las bandas P10 · P50 · P90 muestran cuánto podría variar cada cifra.${extra}`);
    },
  },
  {
    id: 'm2-best', mission: 2, focus: '[data-testid="disp-best"]', click: '[data-testid="disp-best"]',
    enter: () => window.setTimeout(() => document.querySelector('[data-testid="dispersion-block"]')?.scrollIntoView({ block: 'center' }), 100),
    say: (_c, t) => t('Click the best cell of the grid (outlined) to centre the lander on the safest spot.', 'Haz clic en la mejor celda de la malla (resaltada) para centrar la nave en el punto más seguro.'),
  },
  {
    id: 'm2-done', mission: 2, cont: true, seal: true, unlock: 'power', sfx: 'unlock',
    say: (_c, t) => t('Terrain and dispersion mastered.', 'Terreno y dispersión dominados.'),
  },

  // ---------------------------------------------------------------- mission 3: coupled power and thermal
  {
    id: 'm3-brief', mission: 3, focus: '[data-testid="subsys-power"]', click: '[data-testid="subsys-power"]',
    enter: () => { scenario(SC.m3); s0().setPower({ mount: 'horizontal' }); },
    say: (_c, t) => t('Level ground is not enough: at the south pole the shadow of a distant mountain freezes lithium batteries. This lander starts with its array flat on the deck. Click "Power / thermal".', 'Estar en suelo plano no basta: en el polo sur la sombra de una montaña lejana congela las baterías de litio. Esta nave parte con el panel plano sobre la cubierta. Haz clic en «Energía / térmico».'),
  },
  {
    id: 'm3-timeline', mission: 3, focus: '[data-testid="timeline"]',
    enter: (c) => { s0().openPanel('timeline'); const r = c.A.result; c.memo.dark = r && r.windows.dark[0] ? r.windows.dark[0].start * r.stepHours : 0; },
    until: (c) => ready(c) && c.app.cursorHours >= (c.memo.dark || 0) && (c.memo.dark || 0) > 0,
    say: (c, t) => t(`Drag the cursor of the timeline to the first dark stretch (T+${fmtDuration(c.memo.dark || 0)}) to see what happens to the lander in the shadow.`, `Arrastra el cursor de la línea de tiempo hasta el primer tramo oscuro (T+${fmtDuration(c.memo.dark || 0)}) para ver qué le pasa a la nave en la sombra.`),
    doIt: (c) => { s0().setPlaying(false); s0().setCursor((c.memo.dark || 0) + 1); },
  },
  {
    id: 'm3-heaters', mission: 3, auto: 0, alert: true, sfx: 'alarm', focus: '[data-testid="drawer-bottom"]',
    enter: () => s0().openPanel('thermal'),
    until: ready,
    say: (c, t) => {
      const a = c.A.result?.adv.kpis;
      if (!a) return t('Reading the thermal model…', 'Leyendo el modelo térmico…');
      const heat = a.heaterHours > 0 ? t(` (the survival heaters, which switch on below ${fmtNum(T_FREEZE_K - 273.15, 0)} °C, run ${fmtDuration(a.heaterHours)})`, ` (los calefactores de supervivencia, que se encienden bajo ${fmtNum(T_FREEZE_K - 273.15, 0)} °C, funcionan ${fmtDuration(a.heaterHours)})`) : '';
      return t(
        a.thermalDeathH !== null
          ? `In the dark the battery drains${heat} and the bus freezes at ${fmtNum(T_BATTERY_DEATH_K - 273.15, 0)} °C at T+${fmtDuration(a.thermalDeathH)}. Let us change the vehicle in Hardware.`
          : `The heaters run ${fmtDuration(a.heaterHours)} and the bus does not drop below ${fmtNum(Math.round(a.minBusC ?? 0) || 0, 0)} °C. Let us still improve the vehicle in Hardware.`,
        a.thermalDeathH !== null
          ? `En la sombra la batería se agota${heat} y el bus se congela a ${fmtNum(T_BATTERY_DEATH_K - 273.15, 0)} °C en T+${fmtDuration(a.thermalDeathH)}. Modifiquemos el vehículo en Equipo.`
          : `Los calefactores funcionan ${fmtDuration(a.heaterHours)} y el bus no baja de ${fmtNum(Math.round(a.minBusC ?? 0) || 0, 0)} °C. Aun así, mejoremos el vehículo en Equipo.`,
      );
    },
  },
  {
    id: 'm3-mast', mission: 3, focus: '[data-testid="mast"]', sfx: 'servo',
    enter: () => { if (s0().panels.leftTab !== 'hardware') s0().openPanel('hardware'); },
    say: (_c, t) => t('Step 1: raise the "Array and antenna height" from 2 m to the 10 m mast to lift the array above the ridge that shades it.', 'Paso 1: sube la «Altura de paneles y antena» de 2 m al mástil de 10 m para asomar el panel por encima de la cresta que le da sombra.'),
    until: (c) => c.app.mastM === 10,
    doIt: () => s0().setMast(10),
  },
  {
    id: 'm3-mount', mission: 3, focus: '[data-testid="mount"]',
    say: (_c, t) => t('Step 2: at the pole the Sun circles the whole horizon like a lighthouse, so a flat array catches little. Change the "Solar array mount" to the 1-axis Sun tracker.', 'Paso 2: en el polo el Sol da la vuelta entera al horizonte como un faro, así que un panel plano capta poco. Cambia la «Montura de paneles» al seguidor solar de 1 eje.'),
    until: (c) => c.app.power.mount === 'tracker1axis',
    doIt: () => s0().setPower({ mount: 'tracker1axis' }),
  },
  {
    id: 'm3-battery', mission: 3, focus: '[data-testid="battery"]',
    say: (c, t) => t(`Step 3: a bigger battery bridges longer nights. Raise the "Battery" capacity: with ${fmtNum(c.app.power.batteryCapacityWh, 0)} Wh the lander can hibernate about ${fmtDuration(hibernationHours(c.app.power.batteryCapacityWh, c.app.power.survivalLoadW))} on its survival load (the hibernation note in Energy).`, `Paso 3: una batería mayor resiste noches más largas. Sube la capacidad de «Batería»: con ${fmtNum(c.app.power.batteryCapacityWh, 0)} Wh la nave puede hibernar unas ${fmtDuration(hibernationHours(c.app.power.batteryCapacityWh, c.app.power.survivalLoadW))} con su carga de supervivencia (nota de hibernación en Energía).`),
    until: (c) => c.app.power.batteryCapacityWh > DEFAULT_POWER.batteryCapacityWh,
    doIt: () => s0().setPower({ batteryCapacityWh: DEFAULT_POWER.batteryCapacityWh * 1.25 }),
  },
  {
    id: 'm3-ok', mission: 3, auto: 0, sfx: 'success',
    until: (c) => ready(c) && c.A.input?.mastM === 10 && c.A.input?.power.mount === 'tracker1axis',
    enter: () => s0().openPanel('thermal'),
    say: (c, t) => {
      const r = c.A.result;
      const ok = r?.kpis.survives;
      return t(
        `${ok ? 'Saved from freezing!' : 'Not enough yet.'} On the mast with the tracker the array collects ${fmtEnergy(r?.kpis.energyWh ?? 0)} over the window and the bus stays above ${fmtNum(Math.round(r?.adv.kpis.minBusC ?? 0) || 0, 0)} °C: ${ok ? 'the lander gets through the night' : 'it would still need a better site or date'}.`,
        `${ok ? '¡Salvados del congelamiento!' : 'Todavía no alcanza.'} En el mástil y con el seguidor el panel capta ${fmtEnergy(r?.kpis.energyWh ?? 0)} en la ventana y el bus no baja de ${fmtNum(Math.round(r?.adv.kpis.minBusC ?? 0) || 0, 0)} °C: ${ok ? 'la nave resiste la noche' : 'aún necesitaría un mejor sitio o fecha'}.`,
      );
    },
  },
  {
    id: 'm3-done', mission: 3, cont: true, seal: true, unlock: 'comms', sfx: 'static',
    say: (_c, t) => t('Electro-thermal survival confirmed.', 'Supervivencia electrotérmica confirmada.'),
  },

  // ---------------------------------------------------------------- mission 4: RF, diffraction, stations, relay
  {
    id: 'm4-brief', mission: 4, focus: '[data-testid="subsys-comms"]', click: '[data-testid="subsys-comms"]',
    enter: () => { scenario(SC.m4); s0().setRf({ band: 'S' }); },
    say: (_c, t) => t('We have energy and heat, but we are mute: a ridge stands between our antenna and the Earth. Click "Comms / RF".', 'Tenemos energía y calor, pero estamos mudos: una cresta se interpone entre nuestra antena y la Tierra. Haz clic en «Comunicaciones / RF».'),
  },
  {
    id: 'm4-los', mission: 4, auto: 0, alert: true, sfx: 'static', until: ready,
    say: (c, t) => {
      const vv = v(c.A);
      return t(`Link with the Earth only ${fmtNum(vv?.linkPct ?? 0, 0)} % of the time; the longest silence lasts ${fmtDuration(vv?.longestLinkGapH ?? 0)}.`, `Enlace con la Tierra solo el ${fmtNum(vv?.linkPct ?? 0, 0)} % del tiempo; el silencio más largo dura ${fmtDuration(vv?.longestLinkGapH ?? 0)}.`);
    },
  },
  {
    id: 'm4-horizon', mission: 4, focus: '[data-testid="bottom-horizon"]', click: '[data-testid="bottom-horizon"]',
    say: (_c, t) => t('Open "Horizon 360°".', 'Abre «Horizonte 360°».'),
  },
  {
    id: 'm4-hover', mission: 4, focus: '.pano',
    enter: (c) => { c.memo.hover = 0; window.setTimeout(() => document.querySelector('.pano')?.addEventListener('pointermove', () => { c.memo.hover = 1; }, { once: true }), 50); },
    say: (_c, t) => t('Move the pointer over the panorama, along the path of the Earth: libration makes it rock up and down over the ridges.', 'Pasa el cursor sobre el panorama, por la trayectoria de la Tierra: la libración la hace subir y bajar sobre las crestas.'),
    until: (c) => c.memo.hover === 1,
    doIt: (c) => { c.memo.hover = 1; },
  },
  {
    id: 'm4-diffraction', mission: 4, auto: 0,
    say: (c, t) => {
      const a = c.A.result?.adv.kpis;
      return t(`The Moon has no air, but radio waves that graze the ridges are diffracted (Deygout, up to three ridges: secondary ridges add up to ${fmtNum(a?.maxSecondaryDiffractionDb ?? 0, 1)} dB) and bounce off the regolith (mean excess loss ${fmtNum(a?.meanExcessLossDb ?? 0, 1)} dB while the link is up).`, `En la Luna no hay aire, pero las ondas que rozan las crestas se difractan (Deygout, hasta tres crestas: las secundarias suman hasta ${fmtNum(a?.maxSecondaryDiffractionDb ?? 0, 1)} dB) y rebotan en el regolito (pérdida extra media ${fmtNum(a?.meanExcessLossDb ?? 0, 1)} dB con el enlace activo).`);
    },
  },
  {
    id: 'm4-band', mission: 4, focus: '[data-testid="band"]',
    enter: () => { if (s0().panels.leftTab !== 'hardware') s0().openPanel('hardware'); },
    say: (_c, t) => t(`Switch the radio to X band (${fmtNum(BAND_FREQUENCY_HZ.X / 1e9, 1)} GHz) to narrow the beam.`, `Cambia la radio a banda X (${fmtNum(BAND_FREQUENCY_HZ.X / 1e9, 1)} GHz) para concentrar el haz.`),
    until: (c) => c.app.rf.band === 'X',
    doIt: () => s0().setRf({ band: 'X' }),
  },
  {
    id: 'm4-station', mission: 4, focus: '[data-testid="station"]',
    say: (_c, t) => t('Look at the "Ground station" list: Goldstone, Madrid and Canberra take turns as the Earth turns, and the GISAT UdeC station is there too. Pick another one.', 'Mira la lista de «Estación terrena»: Goldstone, Madrid y Canberra se turnan mientras la Tierra gira, y también está la estación GISAT UdeC. Elige otra.'),
    until: (c) => c.app.rf.groundStationId !== DEFAULT_RF.groundStationId,
    doIt: () => s0().setRf({ groundStationId: GROUND_STATIONS.find((g) => g.id !== DEFAULT_RF.groundStationId)?.id ?? DEFAULT_RF.groundStationId }),
  },
  {
    id: 'm4-telemetry', mission: 4, focus: '[data-testid="dock-telemetry"]', click: '[data-testid="dock-telemetry"]',
    say: (_c, t) => t('Open the "Telemetry" to read the station, the link margin and the data rate at the time on the clock.', 'Abre la «Telemetría» para leer la estación, el margen de enlace y la tasa de datos a la hora del reloj.'),
  },
  {
    id: 'm4-why-relay', mission: 4, auto: 0,
    say: (_c, t) => t('Even in X band, for part of the month the mountain hides the Earth completely. We need to bounce the signal off a relay satellite in lunar orbit.', 'Aun en banda X, parte del mes la montaña tapa por completo la Tierra. Necesitamos rebotar la señal en un satélite repetidor en órbita lunar.'),
  },
  {
    id: 'm4-relay', mission: 4, focus: '[data-testid="relay-enable"]',
    enter: () => { if (s0().panels.leftTab !== 'hardware') s0().openPanel('hardware'); },
    say: (_c, t) => t('Turn on the orbital relay.', 'Activa el relevo orbital.'),
    until: (c) => c.app.relay.enabled,
    doIt: () => s0().setRelay({ enabled: true }),
  },
  {
    id: 'm4-ok', mission: 4, auto: 0, sfx: 'radio',
    until: (c) => ready(c) && Boolean(c.A.input?.relay?.enabled),
    say: (c, t) => {
      const vv = v(c.A);
      return t(`Live telemetry restored: with the relay there is a path to the Earth ${fmtNum(vv?.linkPct ?? 0, 0)} % of the time, at ${fmtNum(c.app.relay.rateMbps, 1)} Mbps from the lander to the relay.`, `¡Telemetría en vivo restablecida! Con el relevo hay camino a la Tierra el ${fmtNum(vv?.linkPct ?? 0, 0)} % del tiempo, a ${fmtNum(c.app.relay.rateMbps, 1)} Mbps del módulo al relevo.`);
    },
  },
  {
    id: 'm4-done', mission: 4, cont: true, seal: true,
    enter: () => s0().setPanels({ telemetry: false }),
    say: (_c, t) => t('Space network linked.', 'Red espacial enlazada.'),
  },

  // ---------------------------------------------------------------- mission 5: anomalous attitude and coexistence
  {
    id: 'm5-brief', mission: 5, focus: '[data-testid="subsys-terrain"]', click: '[data-testid="subsys-terrain"]',
    enter: () => { scenario(SC.m5); s0().setAttitude({ gimbalRangeDeg: 0 }); },
    say: (c, t) => t(`On paper everything holds, but real legs can hit a crater at touchdown, and a landing can endanger nearby bases. This lander has its antenna fixed (gimbal range ${fmtNum(c.app.attitude.gimbalRangeDeg, 0)}°). Click "Terrain / landing".`, `Los planos lo soportan todo, pero en la realidad las patas pueden tropezar con un cráter al tocar suelo, y un alunizaje puede poner en peligro bases cercanas. Esta nave tiene la antena fija (rango del cardán ${fmtNum(c.app.attitude.gimbalRangeDeg, 0)}°). Haz clic en «Terreno / alunizaje».`),
  },
  {
    id: 'm5-preset', mission: 5, focus: '[data-testid="preset-im1"]',
    enter: (c) => { c.memo.rf0 = c.A.result?.adv.kpis.rfAvailabilityPct ?? 0; if (s0().panels.leftTab !== 'contingency') s0().openPanel('contingency'); },
    say: (_c, t) => t(`In February 2024 IM-1 Odysseus touched down with sideways speed and came to rest tilted about ${fmtNum(im1Attitude().rollDeg, 0)}°. Click the "IM-1 Odysseus" preset.`, `En febrero de 2024, IM-1 Odysseus tocó suelo con velocidad lateral y quedó inclinado unos ${fmtNum(im1Attitude().rollDeg, 0)}°. Haz clic en el preset «IM-1 Odysseus».`),
    until: (c) => c.app.attitude.rollDeg === im1Attitude().rollDeg,
  },
  {
    id: 'm5-lost', mission: 5, auto: 0, alert: true, sfx: 'error',
    until: (c) => ready(c) && (c.A.input?.attitude?.rollDeg ?? 0) === im1Attitude().rollDeg,
    say: (c, t) => {
      const a = c.A.result?.adv.kpis;
      return t(`The tilted antenna points at the ground: the downlink closes ${fmtNum(a?.rfAvailabilityPct ?? 0, 0)} % of the time (it was ${fmtNum(c.memo.rf0 || 0, 0)} % level), mean pointing loss ${fmtNum(a?.meanPointingLossDb ?? 0, 1)} dB.`, `La antena inclinada mira al suelo: la descarga cierra el ${fmtNum(a?.rfAvailabilityPct ?? 0, 0)} % del tiempo (nivelada era el ${fmtNum(c.memo.rf0 || 0, 0)} %), pérdida media de apuntamiento ${fmtNum(a?.meanPointingLossDb ?? 0, 1)} dB.`);
    },
  },
  {
    id: 'm5-gimbal', mission: 5, focus: '[data-testid="gimbal-range"]',
    say: (_c, t) => t(`Widen the "Antenna gimbal range" so the dish can steer back to the Earth (about ${SC.m5.gimbalDeg}° is enough here). The yaw slider above turns the whole lander.`, `Amplía el «Rango del cardán de antena» para que el plato vuelva a apuntar a la Tierra (aquí bastan unos ${SC.m5.gimbalDeg}°). El deslizador de guiñada, arriba, gira toda la nave.`),
    until: (c) => ready(c) && (c.A.input?.attitude?.gimbalRangeDeg ?? 0) > 0 && (c.A.result?.adv.kpis.rfAvailabilityPct ?? 0) >= 0.9 * (c.memo.rf0 || 1),
    doIt: () => s0().setAttitude({ gimbalRangeDeg: SC.m5.gimbalDeg }),
  },
  {
    id: 'm5-ok', mission: 5, auto: 0, sfx: 'success',
    say: (c, t) => t(`Link recovered despite the impact: ${fmtNum(c.A.result?.adv.kpis.rfAvailabilityPct ?? 0, 0)} % of the time with a ${fmtNum(c.app.attitude.gimbalRangeDeg, 0)}° gimbal.`, `¡Enlace recuperado a pesar del impacto! El ${fmtNum(c.A.result?.adv.kpis.rfAvailabilityPct ?? 0, 0)} % del tiempo con un cardán de ${fmtNum(c.app.attitude.gimbalRangeDeg, 0)}°.`),
  },
  {
    id: 'm5-asset', mission: 5, focus: '[data-testid="asset-enable"]',
    say: (_c, t) => t('We are not alone: another mission has an asset nearby. Turn on the "Neighbouring surface asset".', 'No estamos solos: otra misión tiene un activo cerca. Activa el «Activo vecino en superficie».'),
    until: (c) => c.app.asset.enabled,
    doIt: () => s0().setAsset({ enabled: true }),
  },
  {
    id: 'm5-psi', mission: 5, auto: 0, alert: true, focus: '[data-testid="asset-kpis"]',
    until: () => Boolean(document.querySelector('[data-testid="asset-kpis"]')),
    say: (c, t) => {
      const radius = document.querySelector('[data-testid="asset-kpis"] .stat output')?.textContent?.trim() ?? '';
      return t(`Our braking engine blasts regolith like bullets (plume-surface interaction). The asset is ${fmtNum(c.app.asset.distanceM, 0)} m away, inside the exclusion radius of ${radius}.`, `El chorro de nuestro motor de frenado lanza regolito como balas (interacción pluma-superficie). El activo está a ${fmtNum(c.app.asset.distanceM, 0)} m, dentro del radio de exclusión de ${radius}.`);
    },
  },
  {
    id: 'm5-distance', mission: 5, focus: '[data-testid="asset-distance"]',
    say: (_c, t) => t('Drag the "Distance from the lander" until the asset is outside the exclusion radius (the red alert goes away).', 'Arrastra la «Distancia al lander» hasta dejar el activo fuera del radio de exclusión (desaparece la alerta roja).'),
    until: (c) => c.app.asset.enabled && Boolean(document.querySelector('[data-testid="asset-kpis"]')) && !document.querySelector('[data-testid="psi-alert"]'),
    doIt: () => {
      const r = Number((document.querySelector('[data-testid="asset-kpis"] .stat output')?.textContent ?? '').replace(/[^\d]/g, ''));
      s0().setAsset({ distanceM: Math.min(3000, Math.ceil((r + 100) / 10) * 10) });
    },
  },
  {
    id: 'm5-done', mission: 5, cont: true, seal: true, unlock: 'science', sfx: 'unlock',
    enter: () => s0().setAsset({ enabled: false }),
    say: (_c, t) => t('Contingency and coexistence overcome.', 'Contingencia y coexistencia superadas.'),
  },

  // ---------------------------------------------------------------- mission 6: science, comparison, optimiser, transparency
  {
    id: 'm6-brief', mission: 6, focus: '[data-testid="subsys-science"]', click: '[data-testid="subsys-science"]',
    enter: () => scenario({ siteId: 'shackleton-ridge', startMs: SC.m0.startMs, days: 14 }),
    say: (_c, t) => t('You know how to keep the lander alive ("where we can go"). Now justify to the science committee why it is worth going there ("where we want to go"). Click "Science".', 'Ya sabes mantener intacta la nave («dónde podemos ir»). Ahora hay que justificar ante el comité científico por qué vale la pena ir allí («dónde queremos ir»). Haz clic en «Ciencia».'),
  },
  {
    id: 'm6-score', mission: 6, auto: 0, focus: '[data-testid="score-panel"]',
    until: () => Boolean(useInsights.getState().score.A),
    say: (c, t) => {
      const sc = useInsights.getState().score.A;
      return t(
        `${site(c)} scores ${fmtNum(sc?.score ?? 0, 0)}/100 on the suitability index, which weighs the criteria whose range is anchored to a physical limit: Earth visibility, sunlight, slope and FeO. Hover a criterion to see its range.`,
        `${site(c)} obtiene ${fmtNum(sc?.score ?? 0, 0)}/100 en el índice de aptitud, que pondera los criterios cuyo rango se ancla a un límite físico: visibilidad de la Tierra, luz solar, pendiente y FeO. Pasa el cursor por un criterio para ver su rango.`,
      );
    },
  },
  {
    id: 'm6-compare', mission: 6, focus: '[data-testid="compare-toggle"]',
    enter: () => { requestSubsystem('overview'); window.setTimeout(() => s0().openPanel('windows'), 1100); },
    say: (_c, t) => t('In Overview > Landing windows, turn on "Compare with another site or date" (scroll the panel if you need to).', 'En Resumen > Ventanas de aterrizaje, activa «Comparar con otro sitio o fecha» (desliza el panel si lo necesitas).'),
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
    id: 'm6-bars', mission: 6, auto: 0, focus: '[data-testid="quick-B"]',
    until: (c) => c.B.result !== null && c.B.latDeg !== c.A.latDeg,
    say: (c, t) => {
      const a = c.A.result?.kpis, b = c.B.result?.kpis;
      return t(
        `Malapert Massif: sunlight ${fmtNum(b?.illuminationPct ?? 0, 0)} % and Earth in view ${fmtNum(b?.dtePct ?? 0, 0)} %, against ${fmtNum(a?.illuminationPct ?? 0, 0)} % and ${fmtNum(a?.dtePct ?? 0, 0)} % here. More Earth in view means more science data sent home.`,
        `Malapert Massif: luz solar ${fmtNum(b?.illuminationPct ?? 0, 0)} % y Tierra a la vista ${fmtNum(b?.dtePct ?? 0, 0)} %, frente a ${fmtNum(a?.illuminationPct ?? 0, 0)} % y ${fmtNum(a?.dtePct ?? 0, 0)} % aquí. Más Tierra a la vista es más ciencia enviada a casa.`,
      );
    },
  },
  {
    id: 'm6-adopt', mission: 6, focus: '[data-testid="adopt-b"]', click: '[data-testid="adopt-b"]',
    say: (_c, t) => t('Press "Adopt this site" to make it the official destination.', 'Presiona «Adoptar este sitio» para validarlo como destino oficial.'),
  },
  {
    id: 'm6-optimise', mission: 6, focus: '[data-testid="verdict"]',
    enter: (c) => { c.memo.level = v(c.A)?.level === 'go' ? 1 : 0; },
    say: (c, t) => (c.memo.level === 1
      ? t('The verdict is already green here: nothing to optimise. Continue.', 'Aquí el veredicto ya está en verde: no hay nada que optimizar. Continúa.')
      : t(`Press "Optimise site and date": the algorithm tries the ${DISPERSION_SIZE * DISPERSION_SIZE} points within ${DISPERSION_RADIUS_M} m, then later dates, and shows the before and after.`, `Presiona «Optimizar sitio y fecha»: el algoritmo prueba los ${DISPERSION_SIZE * DISPERSION_SIZE} puntos a ${DISPERSION_RADIUS_M} m y luego fechas posteriores, y muestra el antes y el después.`)),
    until: (c) => c.memo.level === 1 || Boolean(document.querySelector('[data-testid="verdict-after"]')),
    doIt: () => (document.querySelector('[data-testid="verdict-fix"]') as HTMLElement | null)?.click(),
  },
  {
    id: 'm6-assumptions', mission: 6, auto: 0, focus: '[data-testid="assumptions"]', reveal: ['export'],
    enter: () => { requestSubsystem('science'); window.setTimeout(() => s0().openPanel('engineering'), 1100); },
    until: () => Boolean(document.querySelector('[data-testid="assumptions"]')),
    say: (_c, t) => t('In space engineering no number comes out of a black box: the "Model assumptions" table gives the origin of every value, and "Export CSV" in the top bar downloads the hour-by-hour telemetry. Continue to your final exam.', 'En ingeniería espacial ningún número sale de una caja negra: la tabla «Supuestos del modelo» da el origen de cada valor, y «Exportar CSV» en la barra superior descarga la telemetría hora por hora. Continúa a tu examen final.'),
  },
  {
    id: 'm6-done', mission: 6, cont: true, seal: true,
    enter: () => useBeginner.getState().set({ validated: { ...s0().scenarios.A } }),
    say: (c, t) => t(`Science mission approved: ${site(c)}.`, `Misión científica aprobada: ${site(c)}.`),
  },

  // ---------------------------------------------------------------- mission 7: emergency triage (final exam)
  {
    id: 'm7-alert', mission: 7, auto: 0, alert: true, sfx: 'siren', reveal: ['mode'],
    enter: () => {
      const s = s0();
      scenario({ siteId: SC.m7.siteId, startMs: SC.m7.nowMs, days: SC.m7.days });
      s.setNowOverride(SC.m7.nowMs);
      s.setMode('triage');
    },
    say: (c, t) => t(`LIVE EMERGENCY! An uncrewed CLPS lander lost its laser sensor during the descent and came down off course near ${site(c)}. Triage it in three steps.`, `¡EMERGENCIA EN VIVO! Una nave CLPS no tripulada perdió su sensor láser en el descenso y cayó fuera de curso cerca de ${site(c)}. Haz el triaje en tres pasos.`),
  },
  {
    id: 'm7-slope', mission: 7, focus: '[data-testid="tri-slope"]', click: '[data-testid="tri-slope"]',
    enter: () => window.setTimeout(() => { const d = document.querySelector('.emg-tilt') as HTMLDetailsElement | null; if (d) d.open = true; }, 300),
    say: (_c, t) => t('Step 1, where and how: it came to rest leaning on the slope. Click "We came to rest on the slope" to take the real attitude.', 'Paso 1, dónde y cómo quedó: quedó apoyado en la ladera. Haz clic en «Quedamos apoyados en la pendiente» para tomar la actitud real.'),
  },
  {
    id: 'm7-micro', mission: 7, auto: 0, focus: '[data-testid="micro-hazard"]',
    until: () => Boolean(document.querySelector('[data-testid="micro-hazard"]')),
    say: (_c, t) => {
      const v0 = document.querySelector('[data-testid="micro-hazard"] .stat output')?.textContent?.trim() ?? '';
      return t(`Under the 20 m pixel the statistics give a micro-shadow and rock hazard of ${v0}: statistical, not a map.`, `Bajo el píxel de 20 m, la estadística da un peligro de micro-sombra y roca de ${v0}: estadístico, no un mapa.`);
    },
  },
  {
    id: 'm7-headline', mission: 7, auto: 0, focus: '[data-testid="tri-step-1"]',
    until: () => (document.querySelector('[data-testid="exit-block"]')?.getAttribute('data-state') ?? 'pending') !== 'pending',
    say: (_c, t) => {
      const head = document.querySelector('[data-testid="surv-head"]')?.textContent?.trim() ?? '';
      return t(`Step 2, diagnosis: "${head}". Under it, the way-out block has already weighed the options: cut the load, move within ${EXIT_MOVE_RADIUS_M} m, or wait for the Sun.`, `Paso 2, diagnóstico: «${head}». Debajo, el bloque Salida ya evaluó las opciones: reducir carga, moverse a ${EXIT_MOVE_RADIUS_M} m o esperar al Sol.`);
    },
  },
  {
    id: 'm7-exit', mission: 7, focus: '[data-testid="exit-block"]', click: '[data-testid="exit-move"]',
    until: () => Boolean(document.querySelector('[data-testid="exit-move"]')),
    say: (_c, t) => {
      const btn = document.querySelector('[data-testid="exit-move"]');
      const d = Number(btn?.getAttribute('data-distance-m') ?? 0), az = Number(btn?.getAttribute('data-azimuth-deg') ?? 0);
      return t(`Step 3, rescue: there is light and safe ground ${fmtNum(d, 0)} m to the ${cardinal(az)}. Click "Run this way out".`, `Paso 3, rescate: hay luz y terreno seguro a ${fmtNum(d, 0)} m al ${cardinal(az)}. Haz clic en «Ejecutar esta salida».`);
    },
  },
  {
    id: 'm7-saved', mission: 7, auto: 0, sfx: 'success',
    until: () => (document.querySelector('[data-testid="exit-block"]')?.getAttribute('data-state') ?? 'pending') !== 'pending',
    say: (_c, t) => {
      const head = document.querySelector('[data-testid="surv-head"]')?.textContent?.trim() ?? '';
      return t(`Rescue completed. "${head}"`, `Rescate completado. «${head}»`);
    },
  },
  {
    id: 'm7-diploma', mission: 7, diploma: true, seal: true, sfx: 'success',
    say: (_c, t) => t('You have mastered the grazing solar geometry, glare control, dispersion grids with LOLA uncertainty, coupled electro-thermal survival, three-ridge RF diffraction with an orbital relay, recovery after a tilted landing, protection of neighbouring assets from the plume, science site selection and live emergency triage. You are ready to lead a mission to the lunar south pole.', 'Has dominado la geometría solar rasante, el control del deslumbramiento, las mallas de dispersión con incertidumbre LOLA, la supervivencia electrotérmica acoplada, la difracción RF de tres crestas con relevo orbital, la recuperación tras un vuelco, la protección de activos vecinos frente a la pluma, la selección científica de sitios y el triaje de emergencia en vivo. Estás listo para liderar una misión al polo sur lunar.'),
  },
];

/** Height the lander starts the descent from, scene km (about 600 m above the ground). */
export const DESCENT_KM = 0.6;

/** What each mission is about and what it unlocks, for the splash and the celebration cards. */
export const MISSION_INFO: { goal: [string, string]; unlocks: Subsystem | null }[] = [
  { goal: ['Land, recover energy and call the Earth.', 'Alunizar, recuperar energía y llamar a la Tierra.'], unlocks: 'overview' },
  { goal: ['Find a landing window, clear the approach of glare and check the vitals from the ground.', 'Hallar una ventana de alunizaje, despejar la aproximación del deslumbramiento y revisar los signos vitales desde el suelo.'], unlocks: 'terrain' },
  { goal: ['Get off a slope that would tip the lander over and master the landing dispersion.', 'Salir de una ladera que volcaría la nave y dominar la dispersión del alunizaje.'], unlocks: 'power' },
  { goal: ['Keep the battery from freezing: mast, Sun tracker and battery.', 'Evitar que la batería se congele: mástil, seguidor solar y batería.'], unlocks: 'comms' },
  { goal: ['Understand diffraction over the ridges and restore contact with a relay.', 'Entender la difracción en las crestas y recuperar el contacto con un relevo.'], unlocks: null },
  { goal: ['Save the radio link after a tilted landing and protect a neighbouring asset.', 'Salvar el enlace tras un alunizaje inclinado y proteger un activo vecino.'], unlocks: 'science' },
  { goal: ['Compare sites, adopt the destination and audit the model.', 'Comparar sitios, adoptar el destino y auditar el modelo.'], unlocks: null },
  { goal: ['Rescue a lander that came down blind, with no time to spare.', 'Rescatar una nave que cayó a ciegas, sin tiempo que perder.'], unlocks: null },
];

export const MISSION_TITLES: [string, string][] = [
  ['First landing', 'Primer alunizaje'], ['Site and date', 'Sitio y fecha'], ['Terrain and tip-over', 'Terreno y vuelco'], ['Energy and cold', 'Energía y frío'],
  ['Communications', 'Comunicaciones'], ['Contingency', 'Contingencia'], ['Science', 'Ciencia'], ['Emergency', 'Emergencia'],
];
