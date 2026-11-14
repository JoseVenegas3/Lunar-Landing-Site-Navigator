/**
 * Explorer mode for educators and the general public: the same engine as the
 * planner, presented as a guided tour with plain-language status and a
 * report card for each candidate site.
 */
import { useEffect, useState } from 'react';
import { CANDIDATE_SITES, Kpis, evaluateScenario } from '../../engine';
import { SceneView } from '../3d/SceneView';
import { Timeline } from '../dashboard/Timeline';
import { useInstant } from '../dashboard/Readout';
import { ensureLocal, getRegional } from '../../state/dem';
import { useMission, useThrottledCursor } from '../../state/mission';
import { AppState, useApp } from '../../state/store';
import { fmtDuration, fmtNum, useT } from '../../lib/format';

interface TourStep {
  title: [string, string];
  body: [string, string];
  action: [string, string];
  apply: (s: AppState) => void;
}

const ridge = CANDIDATE_SITES[0].id;
const nobile = CANDIDATE_SITES[3].id;

const TOUR: TourStep[] = [
  {
    title: ['A Sun that never climbs', 'Un Sol que nunca sube'],
    body: [
      'At the lunar south pole the Sun does not rise and set. It circles the horizon once a month, never more than a couple of degrees high. Press the button and watch it skim the mountain tops.',
      'En el polo sur lunar el Sol no sale ni se pone. Da una vuelta al horizonte cada mes, sin subir más de un par de grados. Pulsa el botón y míralo rozar las cumbres.',
    ],
    action: ['Play one lunar month', 'Reproducir un mes lunar'],
    apply: (s) => {
      s.updateScenario('A', { siteId: ridge });
      s.setOverlay('none'); s.setView('orbit'); s.setSpeed(24); s.setCursor(0); s.setPlaying(true);
    },
  },
  {
    title: ['Shadows that last for weeks', 'Sombras que duran semanas'],
    body: [
      'With the Sun so low, any hill casts a shadow many kilometres long, and crater floors may never see light at all. The colour map shows how much of the time each spot is sunlit: pale means almost always, dark purple means almost never.',
      'Con el Sol tan bajo, cualquier colina proyecta una sombra de muchos kilómetros, y el fondo de los cráteres puede no ver la luz jamás. El mapa de color muestra cuánto tiempo recibe sol cada punto: claro es casi siempre, púrpura oscuro casi nunca.',
    ],
    action: ['Show the sunlight map', 'Mostrar el mapa de luz solar'],
    apply: (s) => { s.setPlaying(false); s.setView('top'); s.setOverlay('insolation'); },
  },
  {
    title: ['The Earth wobbles in the sky', 'La Tierra se bambolea en el cielo'],
    body: [
      'The Moon always shows us the same face, but it rocks slightly as it orbits. Seen from the pole, the Earth drifts up and down near the horizon in a slow loop. When a mountain gets in the way, the radio beam to Earth turns red: no contact with mission control.',
      'La Luna siempre nos muestra la misma cara, pero se balancea un poco al orbitar. Desde el polo, la Tierra sube y baja cerca del horizonte en un bucle lento. Cuando una montaña se interpone, el haz de radio hacia la Tierra se vuelve rojo: sin contacto con el control de misión.',
    ],
    action: ['Watch the radio link', 'Observar el enlace de radio'],
    apply: (s) => {
      s.updateScenario('A', { siteId: nobile });
      s.setOverlay('none'); s.setView('orbit'); s.setSpeed(12); s.setCursor(0); s.setPlaying(true);
    },
  },
  {
    title: ['Half a kilometre decides the mission', 'Medio kilómetro decide la misión'],
    body: [
      'On the Shackleton ridge the crest is sunlit most of the time, but a few hundred metres downhill the ridge itself hides the Sun. Drag the lander inside the dashed box and watch the sunlight score change.',
      'En la cresta de Shackleton la cima recibe sol casi todo el tiempo, pero unos cientos de metros ladera abajo la propia cresta tapa el Sol. Arrastra el lander dentro del cuadro punteado y observa cómo cambia la puntuación de luz.',
    ],
    action: ['Go to the ridge', 'Ir a la cresta'],
    apply: (s) => {
      s.setPlaying(false);
      s.updateScenario('A', { siteId: ridge });
      s.setRelocation('A', 0, 0); s.setView('orbit'); s.setOverlay('insolation');
    },
  },
  {
    title: ['Now choose a landing site', 'Ahora elige un sitio de alunizaje'],
    body: [
      'Each candidate trades sunlight against contact with Earth and against the length of the dark spells the batteries must survive. Compare the report cards below, then open the planner to size the solar panels, the battery and the antenna.',
      'Cada candidato equilibra luz solar, contacto con la Tierra y la duración de los períodos oscuros que las baterías deben resistir. Compara las fichas de abajo y luego abre el planificador para dimensionar paneles, batería y antena.',
    ],
    action: ['Open the mission planner', 'Abrir el planificador de misión'],
    apply: (s) => { s.setPlaying(false); s.setOverlay('none'); s.setMode('planner'); },
  },
];

/** KPIs of every candidate site for the current window, computed one site at a time in the background. */
function useScorecards(startMs: number, days: number): Record<string, Kpis | undefined> {
  const power = useApp((s) => s.power);
  const rf = useApp((s) => s.rf);
  const mastM = useApp((s) => s.mastM);
  const [cards, setCards] = useState<Record<string, Kpis | undefined>>({});
  useEffect(() => {
    let alive = true;
    setCards({});
    void (async () => {
      for (const site of CANDIDATE_SITES) {
        const local = await ensureLocal(site.latDeg, site.lonDeg);
        const regional = getRegional();
        if (!alive || !regional) return;
        const r = evaluateScenario({ regional, local }, {
          latDeg: site.latDeg, lonDeg: site.lonDeg, dxM: 0, dyM: 0, startMs, days, stepHours: 1, mastM, power, rf,
        });
        setCards((c) => ({ ...c, [site.id]: r.kpis }));
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    })();
    return () => { alive = false; };
  }, [startMs, days, power, rf, mastM]);
  return cards;
}

function Meter({ label, pct, tone, text }: { label: string; pct: number; tone: 'sun' | 'rf' | 'night'; text: string }) {
  return (
    <div className="meter">
      <span>{label}</span>
      <div className="meter-track"><i className={`meter-fill meter-${tone}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} /></div>
      <output className="mono">{text}</output>
    </div>
  );
}

export function ExplorerLayout() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const step = useApp((s) => s.tourStep);
  const setStep = useApp((s) => s.setTourStep);
  const cfg = useApp((s) => s.scenarios.A);
  const update = useApp((s) => s.updateScenario);
  const data = useMission().A;
  const cursor = useThrottledCursor();
  const now = useInstant(data, cursor);
  const cards = useScorecards(cfg.startMs, cfg.days);
  const li = lang === 'es' ? 1 : 0;
  const tour = TOUR[step];
  const k = data.result?.kpis ?? null;
  const battHours = useApp((s) => s.power.batteryCapacityWh / Math.max(1, s.power.survivalLoadW));

  return (
    <main className="explorer" data-testid="explorer">
      <div className="ex-stage">
        <SceneView />
        <div className="ex-status" data-testid="ex-status">
          <div className={`status-tile ${now && now.sunFrac > 0 ? 'is-sun' : 'is-crit'}`}>
            <span>{t('Sunlight', 'Luz solar')}</span>
            <strong>{now ? (now.sunFrac > 0.98 ? t('Full sun', 'Sol pleno') : now.sunFrac > 0 ? t('Partly hidden', 'Parcialmente oculto') : t('In shadow', 'En sombra')) : '…'}</strong>
            <small className="mono">{now ? `${fmtNum(now.powerW, 0)} W` : ''}</small>
          </div>
          <div className={`status-tile ${now && now.clear > 0 ? 'is-rf' : 'is-crit'}`}>
            <span>{t('Contact with Earth', 'Contacto con la Tierra')}</span>
            <strong>{now ? (now.clear > 0 ? t('Link open', 'Enlace abierto') : t('Blocked by terrain', 'Bloqueado por relieve')) : '…'}</strong>
            <small className="mono">{now ? `${now.earthEl >= 0 ? '+' : ''}${fmtNum(now.earthEl, 1)}° ${t('above horizontal', 'sobre la horizontal')}` : ''}</small>
          </div>
          <div className={`status-tile ${now?.depleted ? 'is-crit' : now?.belowDod ? 'is-warn' : ''}`}>
            <span>{t('Battery', 'Batería')}</span>
            <strong>{now ? (now.depleted ? t('Empty: lander frozen', 'Vacía: lander congelado') : `${fmtNum(now.socPct, 0)} %`) : '…'}</strong>
            <small className="mono">{k ? `${t('sunlit', 'con sol')} ${fmtNum(k.illuminationPct, 0)} % ${t('of this window', 'de esta ventana')}` : ''}</small>
          </div>
        </div>
      </div>

      <aside className="ex-side">
        <section className="panel tour" data-testid="tour">
          <header className="tour-head">
            <span className="mono">{t('Tour', 'Recorrido')} {step + 1} / {TOUR.length}</span>
            <div className="tour-dots" role="tablist" aria-label={t('Tour steps', 'Pasos del recorrido')}>
              {TOUR.map((s, i) => (
                <button key={s.title[0]} type="button" role="tab" aria-selected={i === step} aria-label={s.title[li]} className={i === step ? 'is-on' : ''} onClick={() => setStep(i)} />
              ))}
            </div>
          </header>
          <h1>{tour.title[li]}</h1>
          <p>{tour.body[li]}</p>
          <div className="tour-actions">
            <button type="button" className="btn btn-primary" onClick={() => tour.apply(useApp.getState())} data-testid="tour-action">{tour.action[li]}</button>
            <button type="button" className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>{t('Back', 'Atrás')}</button>
            <button type="button" className="btn" disabled={step === TOUR.length - 1} onClick={() => setStep(step + 1)} data-testid="tour-next">{t('Next', 'Siguiente')}</button>
          </div>
        </section>

        <section className="panel cards" aria-label={t('Candidate sites', 'Sitios candidatos')}>
          <header className="panel-head">
            <h2>{t('Candidate sites', 'Sitios candidatos')}</h2>
            <span className="mono cards-cap">{cfg.days} d</span>
          </header>
          <ul className="site-cards">
            {CANDIDATE_SITES.map((site) => {
              const c = cards[site.id];
              const on = cfg.siteId === site.id;
              return (
                <li key={site.id}>
                  <button type="button" className={`site-card${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => update('A', { siteId: site.id })} data-testid={`card-${site.id}`}>
                    <strong>{site.name}</strong>
                    <em>{site.summary[lang]}</em>
                    {c ? (
                      <>
                        <Meter label={t('Sunlight', 'Luz solar')} tone="sun" pct={c.illuminationPct} text={`${fmtNum(c.illuminationPct, 0)} %`} />
                        <Meter label={t('Earth contact', 'Contacto Tierra')} tone="rf" pct={c.dtePct} text={`${fmtNum(c.dtePct, 0)} %`} />
                        <Meter
                          label={t('Longest night', 'Noche más larga')} tone="night"
                          pct={(100 * c.longestDarkH) / Math.max(c.longestDarkH, battHours * 2, 1)}
                          text={fmtDuration(c.longestDarkH)}
                        />
                      </>
                    ) : <span className="mono card-wait">{t('analysing terrain…', 'analizando el relieve…')}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="kpi-note">
            {t(`With the current battery the lander can hibernate about ${fmtDuration(battHours)} without sunlight.`, `Con la batería actual el lander puede hibernar unas ${fmtDuration(battHours)} sin luz solar.`)}
          </p>
        </section>
      </aside>

      <div className="ex-time">
        <Timeline scenarios={[data]} />
      </div>
    </main>
  );
}
