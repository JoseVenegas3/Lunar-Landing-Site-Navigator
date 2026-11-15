/**
 * Landing-date finder: which touchdown dates give a mission that lands lit,
 * talks to the Earth, survives and meets the approach-lighting constraint, and
 * why the other dates are rejected.
 */
import { LandingCandidate, RejectReason, REJECT_PRIORITY, candidateTimes, primaryReason } from '../../engine';
import { useLandingWindows } from '../../state/insights';
import { ScenarioData } from '../../state/mission';
import { useApp } from '../../state/store';
import { CompareBlock } from './CompareBlock';
import { cardinal, fmtData, fmtDate, fmtDateTime, fmtDuration, fmtMonthDay, fmtNum, useT } from '../../lib/format';
import { useUnits } from '../../lib/units';
import { ScenarioBadge } from '../ScenarioBadge';

/** Month-day and hour, UTC: the year is on the axis above. */
const short = (ms: number): string => `${fmtMonthDay(ms)} ${String(new Date(ms).getUTCHours()).padStart(2, '0')}h`;

type Group = 'ok' | 'survival' | 'dark' | 'link' | 'light';
const GROUP: Record<RejectReason, Group> = {
  thermal: 'survival', battery: 'survival', dark: 'dark', 'earth-blocked': 'link', 'no-station': 'link', 'link-margin': 'link',
  'ellipse-shadow': 'light', glare: 'light', washout: 'light',
};

const REASON_TEXT: Record<RejectReason, [string, string]> = {
  thermal: ['Battery freezes during the mission', 'La batería se congela durante la misión'],
  battery: ['Battery runs flat during the mission', 'La batería se agota durante la misión'],
  dark: ['Touchdown in the dark', 'Contacto con la superficie a oscuras'],
  'earth-blocked': ['Earth behind the terrain at touchdown', 'Tierra tras el terreno al contacto'],
  'no-station': ['No ground station tracking at touchdown', 'Sin estación terrena en seguimiento al contacto'],
  'link-margin': ['Link margin negative at touchdown', 'Margen de enlace negativo al contacto'],
  'ellipse-shadow': ['Landing ellipse mostly in shadow', 'Elipse de alunizaje mayormente en sombra'],
  glare: ['Sun ahead of the descent cameras (glare)', 'Sol de frente a las cámaras de descenso (deslumbramiento)'],
  washout: ['Sun directly behind: no visible shadows', 'Sol justo detrás: sin sombras visibles'],
};

function candidateTitle(c: LandingCandidate, t: (en: string, es: string) => string): string {
  const head = `${fmtDateTime(c.timeMs)} UTC`;
  return c.ok ? `${head} · ${t('accepted', 'aceptada')}` : `${head} · ${c.reasons.map((r) => t(...REASON_TEXT[r])).join('; ')}`;
}

export function WindowsPanel({ data }: { data: ScenarioData }) {
  const t = useT();
  const u = useUnits();
  const w = useLandingWindows(data);
  const updateScenario = useApp((s) => s.updateScenario);
  const setCursor = useApp((s) => s.setCursor);
  const setPlaying = useApp((s) => s.setPlaying);
  const startMs = useApp((s) => s.scenarios[data.key].startMs);
  const { config: cfg, search } = w;
  const total = candidateTimes(0, cfg).length;

  const landAt = (ms: number): void => {
    setPlaying(false);
    updateScenario(data.key, { startMs: ms });
    setCursor(0);
  };

  const legend: [Group, string][] = [
    ['ok', t('accepted', 'aceptada')], ['light', t('approach lighting', 'iluminación de aproximación')], ['link', t('no downlink', 'sin descarga')],
    ['dark', t('dark', 'a oscuras')], ['survival', t('does not survive', 'no sobrevive')],
  ];

  return (
    <>
      <section className="panel block" data-testid="windows-panel">
        <h3><ScenarioBadge k={data.key} />{t('When can we land?', '¿Cuándo podemos alunizar?')}</h3>
        <p className="kpi-note pad0">
          {t('Every candidate date is flown as a full mission from touchdown. A date is accepted when the lander touches down in sunlight, the downlink closes at touchdown, it survives the mission, and the Sun is neither in front of the descent cameras nor directly behind them.', 'Cada fecha candidata se vuela como una misión completa desde el contacto. Una fecha se acepta si el módulo toca la superficie con sol, la descarga cierra al contacto, sobrevive la misión, y el Sol no queda de frente a las cámaras de descenso ni justo detrás.')}
        </p>
        <div className="field-row">
          <label className="field">
            <span className="field-label">{t('Search from', 'Buscar desde')}<output className="mono">{fmtDate(startMs)}</output></span>
            <select value={cfg.searchDays} onChange={(e) => w.setConfig({ searchDays: Number(e.target.value) })} data-testid="win-span">
              {[30, 60, 90, 180].map((d) => <option key={d} value={d}>{d} {t('days', 'días')}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">{t('Surface mission', 'Misión en superficie')}<output className="mono">{cfg.missionDays} d</output></span>
            <input type="range" min={2} max={30} step={1} value={cfg.missionDays} onChange={(e) => w.setConfig({ missionDays: Number(e.target.value) })} data-testid="win-mission" />
          </label>
        </div>
        <label className="field">
          <span className="field-label">{t('Approach heading (direction of flight)', 'Rumbo de aproximación (dirección de vuelo)')}<output className="mono">{cfg.approachAzDeg}° {cardinal(cfg.approachAzDeg)}</output></span>
          <input type="range" min={0} max={355} step={5} value={cfg.approachAzDeg} onChange={(e) => w.setConfig({ approachAzDeg: Number(e.target.value) })} data-testid="win-heading" />
        </label>
        <p className="kpi-note pad0" data-testid="win-assumptions">
          {t(`Engineering assumption thresholds: Sun not within ±${cfg.glareHalfDeg}° of the direction of flight (glare) nor ±${cfg.washoutHalfDeg}° behind it (no shadows), and at least ${cfg.minEllipseLitPct} % of the ${u.m(cfg.ellipseRadiusM)} landing ellipse in sunlight.`, `Umbrales supuestos de ingeniería: Sol fuera de ±${cfg.glareHalfDeg}° de la dirección de vuelo (deslumbramiento) y de ±${cfg.washoutHalfDeg}° detrás (sin sombras), y al menos el ${cfg.minEllipseLitPct} % de la elipse de ${u.m(cfg.ellipseRadiusM)} con sol.`)}
        </p>
        <div className="tour-actions">
          <button type="button" className="btn btn-small" onClick={w.run} disabled={!data.result || w.progress !== null} data-testid="win-run">
            {t(`Search ${total} touchdown dates`, `Buscar en ${total} fechas de contacto`)}
          </button>
        </div>
        {w.progress !== null && (
          <div className="disp-wait">
            <div className="mono">{t('Flying missions', 'Simulando misiones')} {Math.round(w.progress * 100)}%</div>
            <div className="bar"><i style={{ width: `${Math.round(w.progress * 100)}%` }} /></div>
          </div>
        )}
      </section>

      {search && (
        <section className={`panel block${w.stale ? ' is-stale' : ''}`} data-testid="win-result">
          <h3>{t('Landing windows', 'Ventanas de alunizaje')}</h3>
          <div className="bands">
            <div className={`band band-head${search.windows.length > 0 ? ' is-ok' : ' is-crit'}`}>
              <span>{t('Dates accepted', 'Fechas aceptadas')}</span>
              <output className="mono" data-testid="win-accepted">{fmtNum(search.acceptedPct, 0)} % · {search.windows.length} {search.windows.length === 1 ? t('window', 'ventana') : t('windows', 'ventanas')}</output>
            </div>
          </div>
          <div className="win-strip" role="img" aria-label={t('Candidate dates, earliest on the left', 'Fechas candidatas, la más temprana a la izquierda')} data-testid="win-strip">
            {search.candidates.map((c) => {
              const reason = primaryReason(c);
              return <i key={c.timeMs} className={`win-${reason ? GROUP[reason] : 'ok'}`} title={candidateTitle(c, t)} />;
            })}
          </div>
          <div className="win-axis mono">
            <span>{fmtDate(search.candidates[0].timeMs)}</span>
            <span>{fmtDate(search.candidates[search.candidates.length - 1].timeMs)}</span>
          </div>
          <p className="win-legend">
            {legend.map(([g, label]) => <span key={g}><i className={`win-${g}`} />{label}</span>)}
          </p>

          {search.windows.length > 0 ? (
            <ul className="win-list" data-testid="win-list">
              {search.windows.map((win) => (
                <li key={win.startMs}>
                  <div>
                    <strong className="mono">{short(win.startMs)} → {short(win.endMs)}</strong>
                    <span>
                      {t('open', 'abierta')} {fmtDuration(win.openHours)} · {t('best', 'mejor')} {short(win.best.timeMs)} · {fmtData(win.best.dataGb)} · {t('link', 'enlace')} {fmtNum(win.best.linkPct, 0)} %
                    </span>
                  </div>
                  <button type="button" className="btn btn-small" onClick={() => landAt(win.best.timeMs)} data-testid="win-use">
                    {t('Land then', 'Alunizar ahí')}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="alert" role="alert" data-testid="win-none">
              {t(`No date in these ${search.config.searchDays} days meets every criterion. The table below says what rules them out.`, `Ninguna fecha de estos ${search.config.searchDays} días cumple todos los criterios. La tabla de abajo dice qué las descarta.`)}
            </p>
          )}

          <h3>{t('Why the other dates are rejected', 'Por qué se rechazan las demás fechas')}</h3>
          <div className="bands" data-testid="win-reasons">
            {REJECT_PRIORITY.filter((r) => search.counts[r] > 0).map((r) => (
              <div key={r} className="band">
                <span><i className={`win-dot win-${GROUP[r]}`} />{t(...REASON_TEXT[r])}</span>
                <output className="mono">{search.counts[r]} · {fmtNum((100 * search.counts[r]) / search.candidates.length, 0)} %</output>
              </div>
            ))}
            {REJECT_PRIORITY.every((r) => search.counts[r] === 0) && (
              <div className="band"><span>{t('No date is rejected.', 'No se rechaza ninguna fecha.')}</span><output className="mono">0</output></div>
            )}
          </div>
          <p className="kpi-note pad0">
            {t('A date can fail for several reasons at once; each is counted. In the strip a date takes the colour of its most serious one.', 'Una fecha puede fallar por varias razones a la vez; se cuenta cada una. En la franja la fecha toma el color de la más grave.')}
          </p>
          {w.stale && <p className="kpi-note pad0">{t('The site or the hardware changed since this search.', 'El sitio o el equipo cambió desde esta búsqueda.')}</p>}
        </section>
      )}

      <section className="panel block">
        <h3>{t('What this does and does not check', 'Qué comprueba y qué no')}</h3>
        <p className="kpi-note pad0">
          {t(`Candidates every ${cfg.candidateStepHours} h. Ellipse: ${u.m(cfg.ellipseRadiusM)} radius on the terrain model, lit by the centre of the solar disc. The glare cone, the ±${cfg.washoutHalfDeg}° washout cone and the sunlit share are engineering assumptions of this tool, not the published requirement of a mission. The descent trajectory, the fuel and the navigation errors are not modelled: this is a surface-conditions filter, not a trajectory design.`, `Candidatas cada ${cfg.candidateStepHours} h. Elipse: radio de ${u.m(cfg.ellipseRadiusM)} sobre el modelo de terreno, iluminada según el centro del disco solar. El cono de deslumbramiento, el cono de ±${cfg.washoutHalfDeg}° sin sombras y la fracción con sol son supuestos de ingeniería de esta herramienta, no el requisito publicado de una misión. No se modela la trayectoria de descenso, el combustible ni los errores de navegación: es un filtro de condiciones en superficie, no un diseño de trayectoria.`)}
        </p>
      </section>

      <CompareBlock />
    </>
  );
}
