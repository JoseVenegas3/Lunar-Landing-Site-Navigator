/**
 * Video pitch player (v3.1, `?pitch=true`): 180 s in six acts over the REAL
 * app. The timeline (timeline.ts) drives the director (director.ts), which
 * sets up the store, the 3-D camera and the panels; the overlays here add
 * kinetic typography, odometers and HUD callouts whose numbers are read live
 * from the engine. A presenter HUD (H to hide) carries the six marks, the
 * transport, ES / EN, sound, the teleprompter and the recorder.
 */
import { CSSProperties, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import {
  CONCEPCION_LAT_DEG, EARTH_OBLIQUITY_DEG, GROUND_STATIONS, HISTORICAL_LANDINGS, LIBRATION_LAT_DEG, LIBRATION_LON_DEG, MOON_SPIN_TILT_DEG,
  curvatureRatio, maxSunElevationDeg, solarElevationKpi,
} from '../engine';
import { useMission } from '../state/mission';
import { useApp } from '../state/store';
import { useT } from '../lib/format';
import { useUnits } from '../lib/units';
import { Badge, BADGES } from '../beginner/Badges';
import { Gate } from '../beginner/Gate';
import { ACTS, MARKS, PITCH_DURATION_S, SceneId, actAt, clampT, clock, fill, nextSceneStart, prevSceneStart, sceneAt } from './timeline';
import { DIRECTION, preloadPitch, setPitchStartUnits, stopAnims } from './director';
import { setPitchIntensity, setPitchMuted, startPitchAudio } from './pitchAudio';
import { PITCH_FILE, PitchRecording, downloadBlob, startTabRecording } from './recorder';
import { FACTS } from './facts';

// URL options, read before the store is created.
const params = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
const AUTOPLAY = params.get('autoplay') === '1';
const AUTORECORD = params.get('record') === 'auto';
const HUD0 = params.get('hud') !== '0';
const LANG0 = params.get('lang');

interface PitchState {
  t: number;
  playing: boolean;
  started: boolean;
  hud: boolean;
  captions: boolean;
  muted: boolean;
  recording: boolean;
  done: boolean;
  fps: number;
  set: (p: Partial<PitchState>) => void;
}
export const usePitch = create<PitchState>((set) => ({
  t: 0, playing: false, started: false, hud: HUD0, captions: true, muted: false, recording: false, done: false, fps: 0,
  set: (p) => set(p),
}));

declare global {
  interface Window {
    __pitch?: { t: () => number; scene: () => string; act: () => string; seek: (t: number) => void; play: () => void; pause: () => void; fps: () => number; done: () => boolean };
  }
}

const INTENSITY: Record<string, number> = { hook: 0.35, proposal: 0.3, training: 0.45, leader: 0.6, emergency: 0.95, close: 0.8 };
const ease = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3));

// ------------------------------------------------------------------ building blocks

/** Words that spring in one after another; negative delays keep it right after a seek. */
function Kinetic({ text, local, delay = 0, className = '' }: { text: string; local: number; delay?: number; className?: string }) {
  const born = useRef(local);
  const words = text.split(' ');
  return (
    <span className={`pk-kinetic ${className}`} aria-label={text}>
      {words.map((w, i) => (
        <span key={`${i}-${w}`} className="pk-word" aria-hidden="true" style={{ animationDelay: `${delay + i * 0.07 - born.current}s` }}>{w}&nbsp;</span>
      ))}
    </span>
  );
}

/** A number that counts up to its value. */
function Odo({ value, local, from = 0, dur = 1.6, digits = 0, unit = '' }: { value: number | null; local: number; from?: number; dur?: number; digits?: number; unit?: string }) {
  if (value === null || !Number.isFinite(value)) return <span className="pk-odo mono">…</span>;
  const v = value * ease((local - from) / dur);
  return <span className="pk-odo mono">{v.toFixed(digits)}{unit}</span>;
}

function Chip({ label, value, tone = 'rf' }: { label: string; value: ReactNode; tone?: 'rf' | 'sun' | 'crit' | 'ok' }) {
  return <div className={`pk-chip is-${tone}`}><span>{label}</span><b className="mono">{value}</b></div>;
}

/** Callout anchored to the lander on screen. */
function LanderTag({ children, tone = 'crit', dx = 40, dy = -70 }: { children: ReactNode; tone?: string; dx?: number; dy?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      const p = window.__clps?.landerScreen();
      if (ref.current) {
        ref.current.style.visibility = p ? 'visible' : 'hidden';
        if (p) ref.current.style.transform = `translate(${Math.round(p.x + dx)}px, ${Math.round(p.y + dy)}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dx, dy]);
  return <div className={`pk-tag is-${tone}`} ref={ref} style={{ visibility: 'hidden' }}><i />{children}</div>;
}

function Act({ n, title }: { n: number; title: string }) {
  return <div className="pk-act"><span className="mono">{`ACT ${['I', 'II', 'III', 'IV', 'V', 'VI'][n - 1]}`}</span>{title}</div>;
}

function Ocean({ n, title, local }: { n: number; title: string; local: number }) {
  return (
    <div className="pk-ocean" data-testid={`pitch-ocean-${n}`}>
      <span className="pk-ocean-n mono">#{n}</span>
      <Kinetic text={title} local={local} className="pk-ocean-t" />
    </div>
  );
}

const domText = (sel: string): string => (document.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------------ scenes

function SceneOverlay({ id, local }: { id: SceneId; local: number }) {
  const t = useT();
  const u = useUnits();
  const A = useMission().A;
  const r = A.result;
  const attitude = useApp((s) => s.attitude);
  const mastM = useApp((s) => s.mastM);
  const rf = useApp((s) => s.rf);
  const asset = useApp((s) => s.asset);
  const cursor = useApp((s) => s.cursorHours);
  const k = r?.adv.kpis;

  switch (id) {
    case 'im1':
      return (
        <div className="pk-scene pk-hook">
          <div className="pk-title-block">
            <Kinetic text={t('FEBRUARY 2024 · IM-1 ODYSSEUS', 'FEBRERO 2024 · IM-1 ODYSSEUS')} local={local} className="pk-kicker" />
            <Kinetic text={t('CAME TO REST TILTED ON TOUCHDOWN', 'QUEDÓ INCLINADO AL TOCAR SUELO')} local={local} delay={0.4} className="pk-huge" />
          </div>
          {local > 3.2 && k && (
            <LanderTag>
              <b className="mono">ROLL {attitude.rollDeg.toFixed(1)}° · {t('CRITICAL TILT', 'INCLINACIÓN CRÍTICA')}</b>
              <span>{t(`${k.attitudeRfPenaltyPct.toFixed(0)} % of the science data lost to the tilt (engine)`, `${k.attitudeRfPenaltyPct.toFixed(0)} % de los datos perdidos por la inclinación (motor)`)}</span>
            </LanderTag>
          )}
          <p className="pk-source">{t(`App preset IM-1 (30° roll) applied at ${A.name}; the real lander came down near Malapert A.`, `Preset IM-1 de la app (30° de alabeo) aplicado en ${A.name}; el lander real alunizó cerca de Malapert A.`)}</p>
        </div>
      );
    case 'im2': {
      const im2 = HISTORICAL_LANDINGS.find((h) => h.id === 'im2-athena');
      const th = r?.adv.thermal;
      const i = r ? Math.max(0, Math.min(r.count - 1, Math.round(cursor / r.stepHours))) : 0;
      const busC = th ? th.tBusK[i] - 273.15 : null;
      return (
        <div className="pk-scene pk-hook">
          <div className="pk-title-block">
            <Kinetic text={t('MARCH 2025 · IM-2 ATHENA', 'MARZO 2025 · IM-2 ATHENA')} local={local} className="pk-kicker" />
            <Kinetic text={t('ON ITS SIDE IN A SHADOWED MICRO-CRATER', 'DE COSTADO EN UN MICRO-CRÁTER EN SOMBRA')} local={local} delay={0.4} className="pk-huge" />
          </div>
          <div className={`pk-frost${busC !== null && busC < -10 ? ' is-frozen' : ''}`} data-testid="pitch-thermo">
            <span>{t('Lander bus, at this site and date (engine)', 'Bus del módulo, en este sitio y fecha (motor)')}</span>
            <b className="mono">{busC === null ? '…' : u.cSigned(busC, 1)}</b>
            {k?.thermalDeathH != null && <em>{t(`battery frozen at T+${Math.round(k.thermalDeathH)} h`, `batería congelada en T+${Math.round(k.thermalDeathH)} h`)}</em>}
            {im2 && <small>{t(`Real mission: ended within about ${im2.actualSurfaceHours} hours (app catalogue)`, `Misión real: terminó en unas ${im2.actualSurfaceHours} horas (catálogo de la app)`)}</small>}
          </div>
        </div>
      );
    }
    case 'stat': {
      const s895 = maxSunElevationDeg(-89.5, MOON_SPIN_TILT_DEG), s85 = maxSunElevationDeg(-85, MOON_SPIN_TILT_DEG);
      return (
        <div className="pk-scene pk-stat">
          <Kinetic text={t('THREE FORCES DECIDE EVERY LANDING', 'TRES FUERZAS DECIDEN CADA ALUNIZAJE')} local={local} className="pk-huge pk-center" />
          <div className="pk-vectors">
            <div className="pk-vector is-sun"><Odo value={s895} local={local} from={1} digits={1} unit="°" /><span>{t(`highest Sun at 89.5° S (${s85.toFixed(1)}° at 85° S): it skims the horizon`, `Sol más alto a 89,5° S (${s85.toFixed(1)}° a 85° S): roza el horizonte`)}</span></div>
            <div className="pk-vector is-rf"><span className="pk-odo mono">±{LIBRATION_LON_DEG}° × ±{LIBRATION_LAT_DEG}°</span><span>{t('the Earth rocks by libration, low on the horizon', 'la Tierra se mece por libración, baja en el horizonte')}</span></div>
            <div className="pk-vector is-crit"><Odo value={curvatureRatio()} local={local} from={2} digits={1} unit="×" /><span>{t('faster than on Earth the horizon falls away: ridges hide Sun and Earth', 'más rápido que en la Tierra cae el horizonte: las crestas ocultan Sol y Tierra')}</span></div>
          </div>
          <p className="pk-source">{t(`Computed by the engine: Moon axis tilt ${MOON_SPIN_TILT_DEG}°, Earth ${EARTH_OBLIQUITY_DEG}° (Concepción's Sun reaches ${maxSunElevationDeg(CONCEPCION_LAT_DEG, EARTH_OBLIQUITY_DEG).toFixed(0)}°).`, `Calculado por el motor: eje lunar ${MOON_SPIN_TILT_DEG}°, terrestre ${EARTH_OBLIQUITY_DEG}° (el Sol de Concepción llega a ${maxSunElevationDeg(CONCEPCION_LAT_DEG, EARTH_OBLIQUITY_DEG).toFixed(0)}°).`)}</p>
        </div>
      );
    }
    case 'brand':
      return (
        <div className="pk-scene pk-brand">
          <img className="pk-logo" src={`${import.meta.env.BASE_URL}brand/logo-gisat.png`} alt="GISAT UDEC" width="168" height="168" />
          <Kinetic text="LUNAR LANDING SITE NAVIGATOR v3.1" local={local} delay={0.3} className="pk-huge pk-center" />
          <div className="pk-seals">
            {[`LOLA DEM ${FACTS.siteDemResM} m/px`, `JPL Horizons ≤ ${FACTS.horizonsMaxErrDeg}°`, t('Traced to SR-101…SR-711', 'Trazado a SR-101…SR-711')].map((s, i) => (
              <span key={s} className="pk-seal" style={{ animationDelay: `${1 + i * 0.35}s` }}>{s}</span>
            ))}
          </div>
        </div>
      );
    case 'gate':
      return (
        <div className="pk-scene pk-gate">
          <div className="pk-portal is-left"><Kinetic text={t('GUIDED MODE · TRAINING', 'MODO GUIADO · ENTRENAMIENTO')} local={local} delay={1} /></div>
          <div className="pk-portal is-right"><Kinetic text={t('FULL MODE · MISSION LEADER', 'MODO COMPLETO · MISSION LEADER')} local={local} delay={1.4} /></div>
        </div>
      );
    case 'm0': {
      const kk = r ? solarElevationKpi(r, cursor) : null;
      return (
        <div className="pk-scene">
          <Act n={3} title={t('Mission 0 · first contact', 'Misión 0 · primer contacto')} />
          <div className="pk-chips">
            <Chip tone="sun" label={t('Solar elevation (engine)', 'Elevación solar (motor)')} value={kk ? `${kk.elNowDeg.toFixed(2)}°` : '…'} />
            <Chip tone="sun" label={t('Array power', 'Potencia del panel')} value={kk ? `${kk.powerNowW.toFixed(0)} W` : '…'} />
            {local > 8.5 && <Chip tone="rf" label={t('Earth in view this window', 'Tierra a la vista en la ventana')} value={r ? `${r.kpis.dtePct.toFixed(0)} %` : '…'} />}
          </div>
          <p className="pk-step mono">{local < 2.8 ? t('powered descent', 'descenso propulsado') : local < 5.5 ? t('arrays deploying', 'paneles desplegándose') : local < 8.5 ? t('finding the grazing Sun', 'buscando el Sol rasante') : t('calling home', 'llamando a casa')}</p>
        </div>
      );
    }
    case 'badges': {
      const earned = Math.min(8, Math.floor((local / 12) * 9));
      return (
        <div className="pk-scene">
          <div className="pk-rack" data-testid="pitch-rack">
            {BADGES.map((b, i) => (
              <div key={i} className={`pk-badge${i < earned ? ' is-on' : ''}`}>
                <Badge i={i} earned={i < earned} fresh={i === earned - 1} size={74} />
                <span>{b.name[t('en', 'es') === 'es' ? 1 : 0]}</span>
              </div>
            ))}
          </div>
          <div className="pk-chips pk-chips-low">
            <Chip tone="sun" label={t('Mast (store → 3-D)', 'Mástil (store → 3D)')} value={u.m(mastM)} />
          </div>
        </div>
      );
    }
    case 'learn':
      return local < 6 ? null : (
        <div className="pk-scene pk-center-wrap">
          <div className="beg-diploma pk-diploma">
            <img src={`${import.meta.env.BASE_URL}brand/logo-gisat.png`} alt="GISAT UDEC" width="110" height="110" />
            <h2>{t('Training complete: graduated as Flight Director', 'Entrenamiento completado: graduado como Flight Director')}</h2>
            <div className="beg-dip-patches" aria-hidden="true">{BADGES.map((_, i) => <Badge key={i} i={i} earned size={54} />)}</div>
            <span className="btn beg-pro">{t('Open the Pro console (Mission Leader)', 'Acceder a la consola Pro (Mission Leader)')}</span>
          </div>
        </div>
      );
    case 'ocean1': {
      const d = Number((document.querySelector('[data-testid="dbl-cursor"]') as HTMLElement | null)?.dataset.distM ?? NaN);
      return (
        <div className="pk-scene">
          <Ocean n={1} title={t('Terrain, free ruler and LOLA uncertainty', 'Terreno, telémetro libre e incertidumbre LOLA')} local={local} />
          <div className="pk-chips">
            <Chip tone={k && r && r.kpis.slopeDeg > 15 ? 'crit' : 'ok'} label={t('Slope at the lander', 'Pendiente en el módulo')} value={r ? `${r.kpis.slopeDeg.toFixed(1)}°` : '…'} />
            {Number.isFinite(d) && local > 3 && <Chip tone={d > 500 ? 'sun' : 'rf'} label={t('Cursor from the lander', 'Cursor desde el módulo')} value={`${Math.round(d).toLocaleString('en-US')} m | ${Math.round(d * 3.28084).toLocaleString('en-US')} ft`} />}
          </div>
        </div>
      );
    }
    case 'ocean2': {
      const kk = r ? solarElevationKpi(r, 0) : null;
      return (
        <div className="pk-scene">
          <Ocean n={2} title={t('Coupled power and thermal model', 'Motor electro-térmico acoplado')} local={local} />
          <div className="pk-chips">
            <Chip tone="sun" label={t('Solar elevation, max (KPI)', 'Elevación solar máx. (KPI)')} value={kk ? `${kk.elMaxDeg.toFixed(2)}°` : '…'} />
            <Chip tone={k?.thermalDeathH != null ? 'crit' : 'ok'} label={t('Coldest bus (engine)', 'Bus más frío (motor)')} value={k?.minBusC != null ? u.c(k.minBusC, 1) : '…'} />
            <Chip tone="sun" label={t('Mast / mount', 'Mástil / montura')} value={`${u.m(mastM)} · ${r?.input.power.mount === 'tracker1axis' ? t('1-axis tracker', 'seguidor 1 eje') : t('horizontal', 'horizontal')}`} />
          </div>
        </div>
      );
    }
    case 'ocean3': {
      const gs = GROUND_STATIONS.find((g) => g.id === rf.groundStationId);
      return (
        <div className="pk-scene">
          <Ocean n={3} title={t('Real RF physics: Deygout, regolith, DSN, relay', 'Física RF real: Deygout, regolito, DSN, relevo')} local={local} />
          <div className="pk-chips">
            <Chip tone="rf" label={t('Ground station', 'Estación terrena')} value={gs?.name ?? '…'} />
            <Chip tone="rf" label={t('Downlink closes (engine)', 'La descarga cierra (motor)')} value={k ? `${k.rfAvailabilityPct.toFixed(0)} %` : '…'} />
            <Chip tone="rf" label={t('Worst secondary-ridge loss', 'Peor pérdida por crestas secundarias')} value={k ? `${k.maxSecondaryDiffractionDb.toFixed(1)} dB` : '…'} />
            {r && useApp.getState().relay.enabled && <Chip tone="ok" label={t('Any path to Earth with relay', 'Algún camino a la Tierra con relevo')} value={`${r.kpis.anyLinkPct.toFixed(0)} %`} />}
          </div>
        </div>
      );
    }
    case 'ocean4': {
      const co = r?.adv.coexistence ?? null;
      return (
        <div className="pk-scene">
          <Ocean n={4} title={t('6-DOF attitude and plume coexistence', 'Actitud 6-DOF y coexistencia por pluma')} local={local} />
          <div className="pk-chips">
            <Chip tone={attitude.rollDeg > 15 ? 'crit' : 'ok'} label={t('Roll / gimbal', 'Alabeo / cardán')} value={`${attitude.rollDeg.toFixed(0)}° / ${attitude.gimbalRangeDeg.toFixed(0)}°`} />
            <Chip tone="rf" label={t('Downlink closes (engine)', 'La descarga cierra (motor)')} value={k ? `${k.rfAvailabilityPct.toFixed(0)} %` : '…'} />
            {asset.enabled && co && <Chip tone={co.psi.violated ? 'crit' : 'ok'} label={t('Neighbour / exclusion radius', 'Vecino / radio de exclusión')} value={`${u.m(asset.distanceM)} / ${u.m(co.psi.hazardRadiusM)}`} />}
          </div>
        </div>
      );
    }
    case 'ocean5':
      return (
        <div className="pk-scene">
          <Ocean n={5} title={t('Science vs safety, and the optimiser', 'Ciencia frente a seguridad, y el optimizador')} local={local} />
          <div className="pk-chips">
            <Chip tone="rf" label={t('Verdict', 'Veredicto')} value={({ go: 'GO', caution: 'CAUTION', nogo: 'NO-GO' } as Record<string, string>)[document.querySelector('[data-testid="verdict"]')?.getAttribute('data-level') ?? ''] ?? '…'} />
            {local > 3 && <Chip tone="ok" label={t('Optimise (Web Worker)', 'Optimizar (Web Worker)')} value={domText('[data-testid="verdict-after"]').slice(0, 90) || t('flying missions…', 'volando misiones…')} />}
          </div>
        </div>
      );
    case 'alert':
    case 'rescue': {
      const head = domText('[data-testid="surv-head"]');
      const ok = /^(SURVIVES|SOBREVIVE)(?! IF| SI)/.test(head);
      return (
        <div className={`pk-scene pk-emg${ok ? ' is-ok' : ''}`}>
          {!ok && <div className="pk-redframe" aria-hidden="true" />}
          <Act n={5} title={t('Live emergency triage', 'Triaje de emergencia en vivo')} />
          <div className={`pk-headline${ok ? ' is-ok' : ''}`} data-testid="pitch-headline">{head || t('Reading the terrain…', 'Leyendo el terreno…')}</div>
        </div>
      );
    }
    case 'trust':
      return (
        <div className="pk-scene pk-trust">
          <Kinetic text={t('NO BLACK BOXES', 'SIN CAJAS NEGRAS')} local={local} className="pk-huge pk-center" />
          <div className="pk-counters">
            <div><Odo value={FACTS.unitTests} local={local} from={0.6} /><span>{t('unit tests passing', 'pruebas unitarias en verde')}</span></div>
            <div><Odo value={FACTS.e2eChecks} local={local} from={0.9} /><span>{t('browser e2e checks passing', 'comprobaciones e2e en navegador')}</span></div>
            <div><Odo value={FACTS.glossaryTerms} local={local} from={1.2} /><span>{t('glossary terms, PDF guide ES / EN', 'términos de glosario, guía PDF ES / EN')}</span></div>
            <div><span className="pk-odo mono">0</span><span>{t('requests to the internet: works offline', 'peticiones a internet: funciona sin conexión')}</span></div>
          </div>
          <p className="pk-source">{t('Model assumptions with their sources and the limits of the LOLA data are on screen in the app.', 'Los supuestos del modelo con sus fuentes y los límites de los datos LOLA están en pantalla en la app.')}</p>
        </div>
      );
    case 'finale':
      return (
        <div className="pk-scene pk-brand pk-finale">
          <img className="pk-logo" src={`${import.meta.env.BASE_URL}brand/logo-gisat.png`} alt="GISAT UDEC" width="150" height="150" />
          <Kinetic text="LUNAR LANDING SITE NAVIGATOR" local={local} delay={0.2} className="pk-huge pk-center" />
          <Kinetic text={t('AT THE LUNAR SOUTH POLE, 200 METRES OR A FEW HOURS WRITE THE STORY.', 'EN EL POLO SUR LUNAR, 200 METROS O UNAS POCAS HORAS ESCRIBEN LA HISTORIA.')} local={local} delay={1.6} className="pk-line pk-center" />
          <Kinetic text={t('TODAY WE KNOW WHERE TO TOUCH DOWN.', 'HOY SABEMOS DÓNDE TOCAR SUELO.')} local={local} delay={3.6} className="pk-line pk-center is-gold" />
          <p className="pk-source">GISAT UdeC · NASA Space Apps Challenge 2026 · Concepción</p>
        </div>
      );
  }
}

/** Synthetic cursor of scene 1 of Mission Leader: moves away from the lander so the real ruler keeps counting. */
function useRulerSweep(active: boolean, local: number): void {
  const lastRef = useRef(-1);
  useEffect(() => {
    if (!active || local < 3 || local > 8.4) return;
    if (Math.abs(local - lastRef.current) < 0.05) return;
    lastRef.current = local;
    const cv = document.querySelector('[data-testid="scene"] canvas') as HTMLCanvasElement | null;
    const p = window.__clps?.landerScreen();
    if (!cv || !p) return;
    const box = cv.getBoundingClientRect();
    const f = (local - 3) / 5.4;
    // towards the free middle of the view, then down-left
    const x = p.x - f * box.width * 0.22, y = p.y + f * box.height * 0.2;
    cv.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
  }, [active, local]);
}

// ------------------------------------------------------------------ the player

export function PitchShow() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const setLang = useApp((s) => s.setLang);
  const st = usePitch();
  const sceneRef = useRef<SceneId | null>(null);
  const cueRef = useRef(0);
  const seekingRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const rec = useRef<PitchRecording | null>(null);
  const fpsRef = useRef<number[]>([]);

  useEffect(() => {
    setPitchStartUnits(useApp.getState().unitSystem);
    if (LANG0 === 'es' || LANG0 === 'en') useApp.getState().setLang(LANG0);
    void preloadPitch().then(() => setLoaded(true));
  }, []);

  const seek = useCallback((x: number) => {
    seekingRef.current = true;
    usePitch.getState().set({ t: clampT(x), done: false, started: true });
  }, []);
  const play = useCallback(() => { startPitchAudio(); usePitch.getState().set({ playing: true, started: true }); }, []);
  const pause = useCallback(() => usePitch.getState().set({ playing: false }), []);

  const finishRecording = useCallback(async () => {
    const r = rec.current;
    rec.current = null;
    if (!r) return;
    const blob = await r.stop();
    usePitch.getState().set({ recording: false });
    downloadBlob(blob, `${PITCH_FILE}.webm`);
  }, []);

  const record = useCallback(async () => {
    if (rec.current) { await finishRecording(); return; }
    try {
      startPitchAudio();
      rec.current = await startTabRecording(60);
      usePitch.getState().set({ recording: true });
      seek(0);
      play();
    } catch (e) {
      rec.current = null;
      usePitch.getState().set({ recording: false });
      console.warn('pitch recording not started', e);
    }
  }, [finishRecording, play, seek]);

  // the clock
  useEffect(() => {
    let raf = 0, last = performance.now();
    const frame = (now: number): void => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const fl = fpsRef.current; fl.push(dt); if (fl.length > 120) fl.shift();
      const p = usePitch.getState();
      let tt = p.t;
      if (p.playing) tt = Math.min(PITCH_DURATION_S, tt + dt);
      const scene = sceneAt(tt);
      const local = tt - scene.start;
      const seeking = seekingRef.current;
      if (scene.id !== sceneRef.current || seeking) {
        stopAnims();
        sceneRef.current = scene.id;
        cueRef.current = 0;
        DIRECTION[scene.id].enter(seeking);
        setPitchIntensity(INTENSITY[scene.act] ?? 0.4);
      }
      const cues = DIRECTION[scene.id].cues ?? [];
      while (cueRef.current < cues.length && cues[cueRef.current].at <= local) {
        cues[cueRef.current].run(seeking);
        cueRef.current++;
      }
      seekingRef.current = false;
      const fps = fl.length ? Math.round(fl.length / fl.reduce((a, b) => a + b, 0)) : 0;
      if (tt >= PITCH_DURATION_S && p.playing) {
        p.set({ t: tt, playing: false, done: true, fps });
        if (rec.current) void finishRecording();
      } else p.set({ t: tt, fps });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); stopAnims(); };
  }, [finishRecording]);

  // autoplay / autorecord (the recording script)
  useEffect(() => {
    if (!loaded) return;
    if (AUTORECORD) void record();
    else if (AUTOPLAY) play();
  }, [loaded, play, record]);

  // keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const p = usePitch.getState();
      if (e.key === ' ') { e.preventDefault(); if (p.playing) pause(); else play(); }
      else if (e.key === 'r' || e.key === 'R') { seek(0); play(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seek(nextSceneStart(p.t)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(prevSceneStart(p.t)); }
      else if (e.key === 'h' || e.key === 'H') p.set({ hud: !p.hud });
      else if (e.key === 'c' || e.key === 'C') p.set({ captions: !p.captions });
      else if (e.key === 'm' || e.key === 'M') { setPitchMuted(!p.muted); p.set({ muted: !p.muted }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [play, pause, seek]);

  // test hooks
  useEffect(() => {
    window.__pitch = {
      t: () => usePitch.getState().t, scene: () => sceneAt(usePitch.getState().t).id, act: () => actAt(usePitch.getState().t).id,
      seek, play, pause, fps: () => usePitch.getState().fps, done: () => usePitch.getState().done,
    };
    return () => { delete window.__pitch; };
  }, [seek, play, pause]);

  const scene = sceneAt(st.t);
  const act = actAt(st.t);
  const local = st.t - scene.start;
  useRulerSweep(scene.id === 'ocean1', local);
  const li = lang === 'es' ? 1 : 0;
  const slots = useMemo(() => ({
    head: domText('[data-testid="surv-head"]') || '…',
    move: domText('[data-testid="exit-move"]') || '…',
    tests: t(`${FACTS.unitTests} unit tests and ${FACTS.e2eChecks} browser checks pass`, `${FACTS.unitTests} pruebas unitarias y ${FACTS.e2eChecks} comprobaciones en navegador pasan`),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [t, scene.id, Math.floor(st.t * 2)]);
  const line = fill(scene.say[li], slots);

  return (
    <div className={`pitch${st.hud ? '' : ' is-clean'}`} data-testid="pitch" data-scene={scene.id} data-act={act.id} style={{ '--pk-t': st.t } as CSSProperties}>
      {scene.id === 'gate' && <Gate ready={false} progress={1} onEnter={() => undefined} />}
      {st.started && <div className="pk-layer" key={scene.id}><SceneOverlay id={scene.id} local={local} /></div>}

      {!st.started && (
        <div className="pk-start" data-testid="pitch-start">
          <img src={`${import.meta.env.BASE_URL}brand/logo-gisat.png`} alt="GISAT UDEC" width="120" height="120" />
          <h1>Lunar Landing Site Navigator</h1>
          <p>{t('Video pitch · 3:00 · six acts over the real app', 'Video pitch · 3:00 · seis actos sobre la app real')}</p>
          <button type="button" className="btn beg-go" onClick={play} disabled={!loaded} data-testid="pitch-play-big">{loaded ? t('Play the pitch', 'Reproducir el pitch') : t('Loading the terrain…', 'Cargando el terreno…')}</button>
          <small>{t('Space play / pause · ← → scene · R restart · H hide controls · C subtitles · M sound', 'Espacio reproducir / pausa · ← → escena · R reiniciar · H ocultar controles · C subtítulos · M sonido')}</small>
        </div>
      )}

      {st.captions && st.started && <div className="pk-prompter" data-testid="pitch-prompter" aria-live="off">{line}</div>}

      {st.hud && (
        <div className="pk-hud" data-testid="pitch-hud">
          <div className="pk-bar" onPointerDown={(e) => { const b = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - b.left) / b.width) * PITCH_DURATION_S); }}>
            <i className="pk-fill" style={{ width: `${(st.t / PITCH_DURATION_S) * 100}%` }} />
            {MARKS.map((m) => <span key={m} className="pk-mark" style={{ left: `${(m / PITCH_DURATION_S) * 100}%` }}><em className="mono">{clock(m)}</em></span>)}
            {ACTS.map((a) => <span key={a.id} className={`pk-actlabel${a.id === act.id ? ' is-on' : ''}`} style={{ left: `${((a.start + a.end) / 2 / PITCH_DURATION_S) * 100}%` }}>{a.title[li]}</span>)}
          </div>
          <div className="pk-controls">
            <button type="button" className="btn btn-small" onClick={() => seek(prevSceneStart(st.t))} aria-label={t('Previous scene', 'Escena anterior')} data-testid="pitch-prev">◀</button>
            <button type="button" className="btn btn-small pk-play" onClick={st.playing ? pause : play} data-testid="pitch-play">{st.playing ? t('Pause', 'Pausa') : t('Play', 'Reproducir')}</button>
            <button type="button" className="btn btn-small" onClick={() => seek(nextSceneStart(st.t))} aria-label={t('Next scene', 'Escena siguiente')} data-testid="pitch-next">▶</button>
            <button type="button" className="btn btn-small" onClick={() => { seek(0); play(); }} data-testid="pitch-restart">{t('Restart', 'Reiniciar')}</button>
            <span className="pk-clock mono" data-testid="pitch-clock">{clock(st.t)} / 3:00</span>
            <span className="pk-scene-name">{`${act.n}. ${act.title[li]}`}</span>
            <div className="lang" role="group" aria-label="Language / Idioma">
              <button type="button" className={lang === 'en' ? 'is-on' : ''} onClick={() => setLang('en')} data-testid="pitch-lang-en">EN</button>
              <button type="button" className={lang === 'es' ? 'is-on' : ''} onClick={() => setLang('es')} data-testid="pitch-lang-es">ES</button>
            </div>
            <button type="button" className={`btn btn-small${st.captions ? ' is-on' : ''}`} onClick={() => st.set({ captions: !st.captions })} data-testid="pitch-captions">{t('Subtitles', 'Subtítulos')}</button>
            <button type="button" className="btn btn-small" onClick={() => { setPitchMuted(!st.muted); st.set({ muted: !st.muted }); }} data-testid="pitch-mute">{st.muted ? t('Sound off', 'Sin sonido') : t('Sound on', 'Con sonido')}</button>
            <button type="button" className={`btn btn-small pk-rec${st.recording ? ' is-rec' : ''}`} onClick={() => void record()} data-testid="pitch-record"
              title={t('Records this tab (video, overlays and sound) from 0:00 to 3:00 and downloads a WebM. The browser asks which tab to share.', 'Graba esta pestaña (video, capas y sonido) de 0:00 a 3:00 y descarga un WebM. El navegador pregunta qué pestaña compartir.')}>
              {st.recording ? t('Stop and download', 'Detener y descargar') : t('Record video (1080p)', 'Grabar video (1080p)')}
            </button>
            <a className="btn btn-small" href={`${import.meta.env.BASE_URL}?mode=leader`} data-testid="pitch-exit">{t('Exit to the app', 'Salir a la app')}</a>
            <span className="pk-fps mono" data-testid="pitch-fps">{st.fps} fps</span>
          </div>
        </div>
      )}
    </div>
  );
}
