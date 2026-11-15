/**
 * "Learn more: why does this happen on the Moon?" (v3.1, SR-502 / SR-708).
 * An optional, large comparison window, Earth on one side and the lunar south
 * pole on the other, with one simple diagram per topic. Opened from every
 * mission celebration and the diploma of the Beginner training, and from a
 * discreet button in each Mission Leader subsystem. Every number is computed
 * here from the engine (constants, formulas, the active mission and the
 * dispersion grid); the few literature facts are cited as such.
 */
import { ReactNode, useEffect, useRef } from 'react';
import { create } from 'zustand';
import {
  CONCEPCION_LAT_DEG, EARTH_OBLIQUITY_DEG, EARTH_SURFACE_PRESSURE_TORR, EJECTA_SHEET_RAD, G_EARTH_M_S2, G_MOON_M_S2, LIBRATION_LAT_DEG, LIBRATION_LON_DEG,
  MOON_SPIN_TILT_DEG, MOON_SURFACE_PRESSURE_TORR, REGOLITH_EPS_R, R_EARTH_MEAN_KM, R_MOON_KM, STEFAN_BOLTZMANN, SYNODIC_MONTH_D, T_SKY_K,
  ballisticRangeKm, criticalVelocityMs, curvatureDropM, curvatureRatio, horizonDistanceKm, maxSunElevationDeg, radiatedWm2,
} from '../engine';
import { useMission } from '../state/mission';
import { useInsights } from '../state/insights';
import { Subsystem, useApp } from '../state/store';
import { fmtDuration, fmtNum, useT } from '../lib/format';
import { useUnits } from '../lib/units';
import { play } from '../beginner/audio';

export type LearnTopic = 'sky' | 'move200' | 'thermal' | 'radio' | 'dust' | 'coldtraps' | 'master';
export const LEARN_TOPICS: LearnTopic[] = ['sky', 'move200', 'thermal', 'radio', 'dust', 'coldtraps', 'master'];
/** Topic of each Beginner mission (0–7). */
export const MISSION_TOPIC: LearnTopic[] = ['sky', 'sky', 'move200', 'thermal', 'radio', 'dust', 'coldtraps', 'coldtraps'];
/** Topic of each Mission Leader subsystem. */
export const SUBSYSTEM_TOPIC: Record<Subsystem, LearnTopic> = { overview: 'sky', terrain: 'move200', power: 'thermal', comms: 'radio', science: 'coldtraps' } as Record<Subsystem, LearnTopic>;

export const useLearn = create<{ topic: LearnTopic | null; open: (t: LearnTopic) => void; close: () => void }>((set) => ({
  topic: null,
  open: (topic) => set({ topic }),
  close: () => set({ topic: null }),
}));

type T = (en: string, es: string) => string;

const TITLE: Record<LearnTopic, [string, string]> = {
  sky: ['Why is the sky black by day and the Sun never climbs at the south pole?', '¿Por qué el cielo es negro de día y el Sol nunca sube en el Polo Sur?'],
  move200: ['Why does moving 200 m change everything here on the Moon?', '¿Por qué moverse 200 m lo cambia todo acá en la Luna?'],
  thermal: ['Why does the lunar night freeze a spacecraft in hours?', '¿Por qué la noche lunar congela una nave en horas?'],
  radio: ['Why does the Earth dance in the sky but never move away?', '¿Por qué la Tierra baila en el cielo pero nunca cambia de lugar?'],
  dust: ['Why does lunar dust behave like ballistic projectiles?', '¿Por qué el polvo lunar actúa como proyectiles balísticos?'],
  coldtraps: ['Eternal cold traps: craters that have not seen the Sun for ages', 'Trampas frías eternas: cráteres que no ven el Sol desde hace eones'],
  master: ['Master summary: Earth vs Moon', 'Resumen maestro: Tierra vs. Luna'],
};
const TAB: Record<LearnTopic, [string, string]> = {
  sky: ['Sky and light', 'Cielo y luz'], move200: ['200 m', '200 m'], thermal: ['Cold', 'Frío'], radio: ['Radio', 'Radio'],
  dust: ['Dust', 'Polvo'], coldtraps: ['Ice', 'Hielo'], master: ['Summary', 'Resumen'],
};

function Cols({ earth, moon }: { earth: ReactNode; moon: ReactNode }) {
  const t = useT();
  return (
    <div className="learn-cols">
      <section className="learn-col is-earth" data-testid="learn-earth">
        <h3><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="#1d6fd6" /><path d="M6 6.5c2 0 2 2 4 2s1 3 3 3M5 12.5c1.5-.5 3 1 3 3" fill="none" stroke="#5fd08a" strokeWidth="1.6" strokeLinecap="round" /></svg>{t('On Earth', 'En la Tierra')}</h3>
        {earth}
      </section>
      <section className="learn-col is-moon" data-testid="learn-moon">
        <h3><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="#b9c0cc" /><circle cx="7.5" cy="8" r="1.6" fill="#8d95a3" /><circle cx="12.5" cy="12" r="2" fill="#8d95a3" /></svg>{t('At the lunar south pole', 'En el Polo Sur lunar')}</h3>
        {moon}
      </section>
    </div>
  );
}

/** Two horizons side by side: the Sun's highest path at Concepción and at the lander's latitude. */
function SkyDiagram({ earthEl, moonEl }: { earthEl: number; moonEl: number }) {
  const arc = (el: number, cx: number): string => {
    const h = Math.max(2, (el / 90) * 70);
    return `M${cx - 70} 90 Q${cx} ${90 - 2 * h} ${cx + 70} 90`;
  };
  return (
    <svg className="learn-svg" viewBox="0 0 360 110" role="img" aria-label="Sun paths">
      <rect x="0" y="0" width="175" height="90" fill="#7fb7ff" opacity="0.25" />
      <rect x="185" y="0" width="175" height="90" fill="#000" />
      <line x1="0" y1="90" x2="175" y2="90" stroke="#5fd08a" strokeWidth="2" />
      <line x1="185" y1="90" x2="360" y2="90" stroke="#9aa3b2" strokeWidth="2" />
      <path d={arc(earthEl, 88)} fill="none" stroke="#f59e0b" strokeDasharray="4 3" />
      <path d={arc(moonEl, 272)} fill="none" stroke="#f59e0b" strokeDasharray="4 3" />
      <circle className="learn-sun" cx="88" cy={90 - Math.max(2, (earthEl / 90) * 70)} r="7" fill="#fbbf24" />
      <circle className="learn-sun" cx="272" cy={88 - Math.max(1, (moonEl / 90) * 70)} r="6" fill="#fbbf24" />
      <path d="M215 90 l22 -9 l14 9 Z" fill="#596273" />
      <path d="M237 90 L330 90 L330 88 Z" fill="#000" opacity="0.9" />
      <text x="88" y="106" textAnchor="middle" className="learn-svg-t">{fmtNum(earthEl, 0)}°</text>
      <text x="272" y="106" textAnchor="middle" className="learn-svg-t">{fmtNum(moonEl, 1)}°</text>
    </svg>
  );
}

function CurveDiagram({ ratio }: { ratio: number }) {
  return (
    <svg className="learn-svg" viewBox="0 0 360 110" role="img" aria-label="Curvature">
      <path d="M10 40 Q180 52 350 40" fill="none" stroke="#5fd08a" strokeWidth="2.5" />
      <path d={`M10 60 Q180 ${60 + 12 * ratio} 350 60`} fill="none" stroke="#b9c0cc" strokeWidth="2.5" />
      <line x1="10" y1="40" x2="350" y2="40" stroke="#5fd08a" strokeDasharray="3 4" opacity="0.5" />
      <line x1="10" y1="60" x2="350" y2="60" stroke="#b9c0cc" strokeDasharray="3 4" opacity="0.5" />
      <text x="355" y="36" textAnchor="end" className="learn-svg-t">Earth / Tierra</text>
      <text x="355" y="104" textAnchor="end" className="learn-svg-t">×{fmtNum(ratio, 1)}</text>
    </svg>
  );
}

function BallisticDiagram({ km }: { km: number }) {
  return (
    <svg className="learn-svg" viewBox="0 0 360 110" role="img" aria-label="Ejecta">
      <line x1="0" y1="95" x2="360" y2="95" stroke="#9aa3b2" />
      <path d="M20 95 Q28 80 40 95" fill="none" stroke="#5fd08a" strokeWidth="2" />
      <text x="30" y="72" textAnchor="middle" className="learn-svg-t">air</text>
      <path className="learn-dust" d="M20 95 Q190 70 350 95" fill="none" stroke="#f59e0b" strokeWidth="2" strokeDasharray="5 4" />
      <text x="350" y="62" textAnchor="end" className="learn-svg-t">{fmtNum(km, 0)} km</text>
    </svg>
  );
}

function ThermalDiagram({ hot, cold }: { hot: number; cold: number }) {
  const w = (v: number): number => Math.max(3, Math.min(340, (v / hot) * 340));
  return (
    <svg className="learn-svg" viewBox="0 0 360 80" role="img" aria-label="Radiated power">
      <rect x="10" y="14" width={w(hot)} height="18" fill="#f59e0b" rx="3" />
      <rect x="10" y="48" width={w(cold)} height="18" fill="#06b6d4" rx="3" />
      <text x="14" y="11" className="learn-svg-t">σT⁴ 300 K</text>
      <text x="14" y="78" className="learn-svg-t">σT⁴ 100 K</text>
    </svg>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div><dt>{k}</dt><dd className="mono">{v}</dd></div>;
}

function Body({ topic, t }: { topic: LearnTopic; t: T }) {
  const u = useUnits();
  const A = useMission().A;
  const tip = useApp((s) => s.tipover);
  const disp = useInsights((s) => s.dispersion.A);
  const r = A.result;
  const lat = r ? r.observer.latDeg : -89.5;
  const earthSun = maxSunElevationDeg(CONCEPCION_LAT_DEG, EARTH_OBLIQUITY_DEG);
  const moonSun = maxSunElevationDeg(lat, MOON_SPIN_TILT_DEG);
  const ratio = curvatureRatio();
  const vMoon = criticalVelocityMs(tip, 0);
  const vEarth = vMoon * Math.sqrt(G_EARTH_M_S2 / G_MOON_M_S2);
  const hot = radiatedWm2(300, STEFAN_BOLTZMANN), cold = radiatedWm2(100, STEFAN_BOLTZMANN);
  const ranges = [10, 100, 1000].map((v) => ({ v, km: ballisticRangeKm(v, EJECTA_SHEET_RAD, G_MOON_M_S2) }));

  switch (topic) {
    case 'sky':
      return (
        <>
          <SkyDiagram earthEl={earthSun} moonEl={moonSun} />
          <Cols
            earth={<>
              <p>{t(`Air scatters blue light (Rayleigh scattering): the sky glows, there is twilight and the air bends the Sun's light a little near the horizon (refraction). At Concepción (${fmtNum(Math.abs(CONCEPCION_LAT_DEG), 1)}° S) the summer noon Sun climbs to ${fmtNum(earthSun, 0)}°, because the Earth's axis is tilted ${fmtNum(EARTH_OBLIQUITY_DEG, 2)}°.`, `El aire dispersa la luz azul (dispersión de Rayleigh): el cielo brilla, hay crepúsculo y el aire dobla un poco la luz del Sol cerca del horizonte (refracción). En Concepción (${fmtNum(Math.abs(CONCEPCION_LAT_DEG), 1)}° S) el Sol de mediodía en verano sube a ${fmtNum(earthSun, 0)}°, porque el eje terrestre está inclinado ${fmtNum(EARTH_OBLIQUITY_DEG, 2)}°.`)}</p>
              <dl className="learn-dl"><Row k={t('Surface pressure', 'Presión en superficie')} v={`${EARTH_SURFACE_PRESSURE_TORR} Torr`} /><Row k={t('Highest Sun', 'Sol más alto')} v={`${fmtNum(earthSun, 0)}°`} /></dl>
            </>}
            moon={<>
              <p>{t(`No atmosphere (about ${MOON_SURFACE_PRESSURE_TORR.toExponential(0)} Torr): no scattering, so the sky is black even with the Sun up, and no refraction, so the app draws the Sun exactly where geometry puts it. The Moon's axis is tilted only ${fmtNum(MOON_SPIN_TILT_DEG, 2)}°: at this lander (${fmtNum(Math.abs(lat), 2)}° S) the Sun can never climb above ${fmtNum(moonSun, 2)}°, so it circles the horizon like a lighthouse and a hill casts shadows kilometres long.`, `Sin atmósfera (unos ${MOON_SURFACE_PRESSURE_TORR.toExponential(0)} Torr): no hay dispersión, así que el cielo es negro aunque el Sol esté arriba, y no hay refracción, así que la app dibuja el Sol justo donde lo pone la geometría. El eje lunar se inclina solo ${fmtNum(MOON_SPIN_TILT_DEG, 2)}°: en este lander (${fmtNum(Math.abs(lat), 2)}° S) el Sol nunca puede subir más de ${fmtNum(moonSun, 2)}°, así que gira rozando el horizonte como un faro y una colina proyecta sombras de kilómetros.`)}</p>
              <dl className="learn-dl">
                <Row k={t('Highest possible Sun here', 'Sol más alto posible aquí')} v={`${fmtNum(moonSun, 2)}°`} />
                {r && <Row k={t('Highest Sun in this window (engine)', 'Sol más alto en esta ventana (motor)')} v={`${fmtNum(r.kpis.sunElMaxDeg, 2)}°`} />}
                {r && <Row k={t('Sunlight in this window (engine)', 'Luz en esta ventana (motor)')} v={`${fmtNum(r.kpis.sunlitPct, 0)} %`} />}
              </dl>
            </>}
          />
        </>
      );
    case 'move200': {
      const lost = disp ? disp.cells.filter((c) => c.lost).length : 0;
      const worst = disp ? disp.cells.reduce((a, c) => (c.merit < a.merit ? c : a), disp.cells[0]) : null;
      return (
        <>
          <Cols
            earth={<>
              <p>{t('Walk 200 m in a city and nothing changes: same weather, same hours of daylight, same sky. The air spreads heat around and the Sun climbs high, so neighbouring places get the same light.', 'Camina 200 m en una ciudad y nada cambia: mismo clima, mismas horas de luz, mismo cielo. El aire reparte el calor y el Sol sube alto, así que lugares vecinos reciben la misma luz.')}</p>
              <dl className="learn-dl"><Row k={t('Gravity', 'Gravedad')} v={`${fmtNum(G_EARTH_M_S2, 2)} m/s²`} /><Row k={t('Sideways speed that tips this lander', 'Velocidad lateral que vuelca este lander')} v={u.ms(vEarth, 2)} /></dl>
            </>}
            moon={<>
              <p>{t('With the Sun a degree or two above the horizon, 200 m can take you from the floor of a crater in permanent shadow (no Sun at all, below −170 °C) to a ridge lit most of the year with the Earth in view. In weak gravity a lander also tips over at a much lower sideways speed.', 'Con el Sol a uno o dos grados del horizonte, 200 m pueden llevarte del fondo de un cráter en sombra permanente (sin Sol, bajo −170 °C) a una cresta iluminada casi todo el año y con la Tierra a la vista. Con gravedad débil, además, un lander vuelca a una velocidad lateral mucho menor.').replace('−170 °C', u.c(-170))}</p>
              <dl className="learn-dl">
                <Row k={t('Gravity', 'Gravedad')} v={`${fmtNum(G_MOON_M_S2, 2)} m/s²`} />
                <Row k={t('Sideways speed that tips this lander', 'Velocidad lateral que vuelca este lander')} v={u.ms(vMoon, 2)} />
                {disp && worst && <Row k={t(`Inside this ${u.m(disp.radiusM)} ellipse (engine)`, `Dentro de esta elipse de ${u.m(disp.radiusM)} (motor)`)} v={t(`best: ${disp.best.lost ? fmtDuration(disp.best.survivalHours) : `${fmtNum(disp.best.linkPct, 0)} % link`} · worst: ${worst.lost ? `lost at ${fmtDuration(worst.survivalHours)}` : `${fmtNum(worst.linkPct, 0)} % link`}`, `mejor: ${disp.best.lost ? fmtDuration(disp.best.survivalHours) : `${fmtNum(disp.best.linkPct, 0)} % enlace`} · peor: ${worst.lost ? `perdido a las ${fmtDuration(worst.survivalHours)}` : `${fmtNum(worst.linkPct, 0)} % enlace`}`)} />}
                {disp && <Row k={t('Cells where the lander is lost', 'Celdas donde se pierde el lander')} v={`${lost} / ${disp.cells.length}`} />}
              </dl>
              {!disp && <p className="learn-note">{t('Open the landing dispersion grid (Terrain) and this window shows how much the 25 points 200 m apart differ.', 'Abre la grilla de dispersión (Terreno) y esta ventana mostrará cuánto difieren los 25 puntos separados 200 m.')}</p>}
            </>}
          />
        </>
      );
    }
    case 'thermal':
      return (
        <>
          <ThermalDiagram hot={hot} cold={cold} />
          <Cols
            earth={<>
              <p>{t('A day lasts 24 h and the air and the oceans store and carry heat, so a night cools things gently: a few degrees to a couple of tens of degrees.', 'Un día dura 24 h y el aire y los océanos guardan y transportan calor, así que la noche enfría con suavidad: de unos pocos grados a un par de decenas.')}</p>
              <dl className="learn-dl"><Row k={t('Day-night cycle', 'Ciclo día-noche')} v="24 h" /></dl>
            </>}
            moon={<>
              <p>{t(`One lunar day lasts ${fmtNum(SYNODIC_MONTH_D, 1)} Earth days (about ${fmtNum(SYNODIC_MONTH_D / 2, 1)} of light and as many of dark at the equator; at the pole the terrain decides). With no air, a surface loses heat only by radiating it to deep space at ${T_SKY_K} K, as σT⁴ (Stefan-Boltzmann): at 300 K it sheds ${fmtNum(hot, 0)} W/m², at 100 K only ${fmtNum(cold, 1)} W/m². That is why ground can swing from about +50 °C in the Sun to −200 °C in a shadow.`, `Un día lunar dura ${fmtNum(SYNODIC_MONTH_D, 1)} días terrestres (unos ${fmtNum(SYNODIC_MONTH_D / 2, 1)} de luz y otros tantos de oscuridad en el ecuador; en el polo decide el relieve). Sin aire, una superficie pierde calor solo radiándolo al espacio profundo a ${T_SKY_K} K, según σT⁴ (Stefan-Boltzmann): a 300 K emite ${fmtNum(hot, 0)} W/m², a 100 K solo ${fmtNum(cold, 1)} W/m². Por eso el suelo puede pasar de unos +50 °C al Sol a −200 °C en una sombra.`).replace('+50 °C', u.cSigned(50, 0)).replace('−200 °C', u.c(-200))}</p>
              <dl className="learn-dl">
                <Row k={t('Heaters on below (engine)', 'Calefactores bajo (motor)')} v={u.c(0)} />
                <Row k={t('Battery frozen at (engine)', 'Batería congelada a (motor)')} v={u.c(-20)} />
                {r?.adv.kpis.minBusC != null && <Row k={t('Coldest bus in this window (engine)', 'Bus más frío en esta ventana (motor)')} v={u.c(r.adv.kpis.minBusC, 1)} />}
              </dl>
            </>}
          />
        </>
      );
    case 'radio':
      return (
        <>
          <CurveDiagram ratio={ratio} />
          <Cols
            earth={<>
              <p>{t(`The Earth's radius is ${fmtNum(R_EARTH_MEAN_KM, 0)} km. An eye at 2 m sees the horizon ${u.kmStr(horizonDistanceKm(R_EARTH_MEAN_KM, 2), 1)} away. Radio crosses the ionosphere and the troposphere, which bend and absorb it.`, `El radio terrestre es ${fmtNum(R_EARTH_MEAN_KM, 0)} km. Un ojo a 2 m ve el horizonte a ${u.kmStr(horizonDistanceKm(R_EARTH_MEAN_KM, 2), 1)}. La radio cruza la ionosfera y la troposfera, que la doblan y absorben.`).replace(/at 2 m|a 2 m/, (m) => m.replace('2 m', u.m(2)))}</p>
              <dl className="learn-dl"><Row k={t('Ground drop after 5 km', 'Caída del suelo a 5 km')} v={u.m(curvatureDropM(R_EARTH_MEAN_KM, 5), 1)} /></dl>
            </>}
            moon={<>
              <p>{t(`The Moon keeps the same face to the Earth (tidal locking), so from here the Earth never rises or sets; libration only rocks it inside a box of about ±${LIBRATION_LON_DEG}° by ±${LIBRATION_LAT_DEG}°. Near the pole that box sits on the horizon, so ridges hide it. The Moon's radius is ${fmtNum(R_MOON_KM, 1)} km: the horizon falls away ${fmtNum(ratio, 1)} times faster with distance. No ionosphere: the signal only diffracts over dry rock (εr = ${REGOLITH_EPS_R}) and bounces on the regolith.`, `La Luna muestra siempre la misma cara a la Tierra (acoplamiento de marea), así que desde aquí la Tierra nunca sale ni se pone; la libración solo la mece dentro de una caja de unos ±${LIBRATION_LON_DEG}° por ±${LIBRATION_LAT_DEG}°. Cerca del polo esa caja está sobre el horizonte, y las crestas la ocultan. El radio lunar es ${fmtNum(R_MOON_KM, 1)} km: el horizonte cae ${fmtNum(ratio, 1)} veces más rápido con la distancia. Sin ionosfera: la señal solo se difracta sobre roca seca (εr = ${REGOLITH_EPS_R}) y rebota en el regolito.`)}</p>
              <dl className="learn-dl">
                <Row k={t('Horizon for an eye at 2 m', 'Horizonte para un ojo a 2 m')} v={u.kmStr(horizonDistanceKm(R_MOON_KM, 2), 2)} />
                <Row k={t('Ground drop after 5 km', 'Caída del suelo a 5 km')} v={u.m(curvatureDropM(R_MOON_KM, 5), 1)} />
                {r && <Row k={t('Earth in view in this window (engine)', 'Tierra a la vista en esta ventana (motor)')} v={`${fmtNum(r.kpis.dtePct, 0)} %`} />}
              </dl>
            </>}
          />
        </>
      );
    case 'dust':
      return (
        <>
          <BallisticDiagram km={ranges[2].km} />
          <Cols
            earth={<>
              <p>{t('A helicopter raises a dust cloud, but the air drags on every grain and stops it within metres; the cloud then drifts and settles.', 'Un helicóptero levanta una nube de polvo, pero el aire frena cada grano y lo detiene en pocos metros; luego la nube flota y se asienta.')}</p>
            </>}
            moon={<>
              <p>{t(`In vacuum nothing slows the grains blasted by the engine: they fly in low ballistic arcs (here a ${fmtNum((EJECTA_SHEET_RAD * 180) / Math.PI, 0)}° sheet, as in the app's plume model) until they hit the ground or something standing on it.`, `En el vacío nada frena los granos que arrastra el motor: vuelan en arcos balísticos rasantes (aquí una lámina de ${fmtNum((EJECTA_SHEET_RAD * 180) / Math.PI, 0)}°, como en el modelo de pluma de la app) hasta chocar con el suelo o con lo que haya sobre él.`)}</p>
              <dl className="learn-dl">
                {ranges.map((x) => <Row key={x.v} k={t(`Range of a grain at ${u.ms(x.v, 0)}`, `Alcance de un grano a ${u.ms(x.v, 0)}`)} v={x.km < 1 ? u.m(x.km * 1000) : u.kmStr(x.km, 1)} />)}
              </dl>
              <p className="learn-note">{t('Ejecta are reported to travel more than 20 km even for small landers (literature cited in the Contingency panel).', 'Se reporta eyección a más de 20 km incluso con landers pequeños (literatura citada en el panel de Contingencia).').replace('20 km', u.kmStr(20, 0))}</p>
            </>}
          />
        </>
      );
    case 'coldtraps':
      return (
        <>
          <Cols
            earth={<>
              <p>{t('Ice exposed to sunlight and air melts or sublimates within days. Even polar ice on Earth is renewed by snow and moves as glaciers.', 'El hielo expuesto al Sol y al aire se derrite o sublima en días. Incluso el hielo polar terrestre se renueva con nieve y se mueve como glaciar.')}</p>
            </>}
            moon={<>
              <p>{t(`Because the Moon's axis is tilted only ${fmtNum(MOON_SPIN_TILT_DEG, 2)}°, the floors of polar craters never see the Sun. In the dark and in vacuum they are among the coldest places measured in the Solar System, cold traps where water molecules that hop across the Moon get stuck as ice.`, `Como el eje lunar se inclina solo ${fmtNum(MOON_SPIN_TILT_DEG, 2)}°, el fondo de los cráteres polares nunca ve el Sol. A oscuras y en el vacío están entre los lugares más fríos medidos en el Sistema Solar: trampas frías donde las moléculas de agua que saltan por la Luna quedan atrapadas como hielo.`)}</p>
              <p className="learn-note">{t('Literature, not computed by the app: LRO Diviner measured about 25 K (−248 °C) in the coldest craters (Paige et al. 2010), and some cold traps may have held ice for more than 2 billion years (Siegler et al. 2016).', 'Literatura, no calculado por la app: LRO Diviner midió unos 25 K (−248 °C) en los cráteres más fríos (Paige et al. 2010), y algunas trampas frías podrían guardar hielo desde hace más de 2000 millones de años (Siegler et al. 2016).').replace('−248 °C', u.c(-248))}</p>
            </>}
          />
        </>
      );
    case 'master':
      return (
        <table className="learn-table" data-testid="learn-master">
          <thead><tr><th /><th>{t('Earth', 'Tierra')}</th><th>{t('Lunar south pole', 'Polo Sur lunar')}</th></tr></thead>
          <tbody>
            <tr><th>{t('Atmosphere', 'Atmósfera')}</th><td>{EARTH_SURFACE_PRESSURE_TORR} Torr</td><td>~{MOON_SURFACE_PRESSURE_TORR.toExponential(0)} Torr</td></tr>
            <tr><th>{t('Highest Sun', 'Sol más alto')}</th><td>{fmtNum(earthSun, 0)}° ({t('Concepción', 'Concepción')})</td><td>{fmtNum(moonSun, 2)}°</td></tr>
            <tr><th>{t('Gravity', 'Gravedad')}</th><td>{fmtNum(G_EARTH_M_S2, 2)} m/s²</td><td>{fmtNum(G_MOON_M_S2, 2)} m/s²</td></tr>
            <tr><th>{t('Radius', 'Radio')}</th><td>{u.kmStr(R_EARTH_MEAN_KM, 0)}</td><td>{u.kmStr(R_MOON_KM, 1)}</td></tr>
            <tr><th>{t('Horizon at 2 m', 'Horizonte a 2 m')}</th><td>{u.kmStr(horizonDistanceKm(R_EARTH_MEAN_KM, 2), 1)}</td><td>{u.kmStr(horizonDistanceKm(R_MOON_KM, 2), 2)}</td></tr>
            <tr><th>{t('Day-night cycle', 'Ciclo día-noche')}</th><td>24 h</td><td>{fmtNum(SYNODIC_MONTH_D, 1)} d</td></tr>
            <tr><th>{t('Cooling', 'Enfriamiento')}</th><td>{t('air, water, radiation', 'aire, agua, radiación')}</td><td>{t(`radiation only, to ${T_SKY_K} K`, `solo radiación, a ${T_SKY_K} K`)}</td></tr>
            <tr><th>{t('Dust', 'Polvo')}</th><td>{t('stopped by air in metres', 'el aire lo frena en metros')}</td><td>{t('ballistic, kilometres', 'balístico, kilómetros')}</td></tr>
            <tr><th>{t('Earth in the sky', 'La Tierra en el cielo')}</th><td>—</td><td>{t(`fixed, ±${LIBRATION_LON_DEG}° × ±${LIBRATION_LAT_DEG}° libration`, `fija, libración ±${LIBRATION_LON_DEG}° × ±${LIBRATION_LAT_DEG}°`)}</td></tr>
          </tbody>
        </table>
      );
  }
}

/** The big secondary button of a celebration (or any place that offers the comparison). */
export function LearnButton({ topic, big = false, testid = 'learn-open' }: { topic: LearnTopic; big?: boolean; testid?: string }) {
  const t = useT();
  const li = useApp((s) => (s.lang === 'es' ? 1 : 0));
  return (
    <button type="button" className={`btn learn-btn${big ? ' is-big' : ''}`} onClick={() => { play('click', useApp.getState().lang); useLearn.getState().open(topic); }} data-testid={testid} data-topic={topic}>
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M12.6 12.6 17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      {big ? `${t('Learn more', 'Aprender más')}: ${TITLE[topic][li]}` : t('Lunar vs Earth physics', 'Física Lunar vs. Tierra')}
    </button>
  );
}

export function LearnModal() {
  const t = useT();
  const topic = useLearn((s) => s.topic);
  const close = useLearn((s) => s.close);
  const li = useApp((s) => (s.lang === 'es' ? 1 : 0));
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!topic) return;
    box.current?.focus();
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [topic, close]);
  if (!topic) return null;
  return (
    <div className="learn" role="dialog" aria-modal="true" aria-labelledby="learn-h" data-testid="learn-modal" data-topic={topic} onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="learn-card" ref={box} tabIndex={-1}>
        <header className="learn-head">
          <div className="learn-tabs" role="tablist">
            {LEARN_TOPICS.map((k) => (
              <button key={k} type="button" role="tab" aria-selected={k === topic} className={k === topic ? 'is-on' : ''} onClick={() => useLearn.getState().open(k)} data-testid={`learn-tab-${k}`}>{TAB[k][li]}</button>
            ))}
          </div>
          <button type="button" className="btn btn-small learn-close" onClick={close} data-testid="learn-close" aria-label={t('Close', 'Cerrar')}>×</button>
        </header>
        <h2 id="learn-h">{TITLE[topic][li]}</h2>
        <div className="learn-body" key={topic}><Body topic={topic} t={t} /></div>
        <footer className="learn-foot">
          <button type="button" className="btn beg-go" onClick={close} data-testid="learn-back">{t('Back', 'Volver')}</button>
        </footer>
      </div>
    </div>
  );
}
