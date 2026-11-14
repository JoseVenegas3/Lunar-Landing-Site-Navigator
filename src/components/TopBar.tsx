/** Top bar: identity, global mode switch, mission clock, guide, export and language. The time transport lives in the 3-D view. */
import { HOUR_MS } from '../engine';
import { useActiveScenario, useThrottledCursor } from '../state/mission';
import { AppMode, maxCursorHours, useApp } from '../state/store';
import { fmtDateTime, fmtDuration, useT } from '../lib/format';
import { buildTelemetryCsv, downloadText, exportStem } from '../lib/export';

export function TopBar() {
  const t = useT();
  const mode = useApp((s) => s.mode);
  const lang = useApp((s) => s.lang);
  const setMode = useApp((s) => s.setMode);
  const setLang = useApp((s) => s.setLang);
  const setActive = useApp((s) => s.setActive);
  const maxHours = useApp((s) => maxCursorHours(s));
  const cursor = useThrottledCursor();
  const data = useActiveScenario();
  const startMs = data.result?.eph.startMs ?? null;

  const switchMode = (m: AppMode): void => {
    if (m !== 'planner') setActive('A');
    setMode(m);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <svg viewBox="0 0 28 28" width="26" height="26" aria-hidden="true">
          <circle cx="14" cy="14" r="9.5" fill="none" stroke="#C9D4E3" strokeWidth="1.4" />
          <path d="M14 4.5a9.5 9.5 0 0 0 0 19c-3-2.6-4.4-5.8-4.4-9.5S11 7.100 14 4.5Z" fill="#C9D4E3" />
          <path d="M2 21.5 26 12" stroke="#06B6D4" strokeWidth="1.3" />
          <circle cx="26" cy="12" r="1.6" fill="#06B6D4" />
        </svg>
        <div>
          <strong>CLPS Lunar Mission Browser</strong>
          <span>GISAT UdeC · {t('South Pole landing site navigator', 'Navegador de sitios de alunizaje del Polo Sur')}</span>
        </div>
      </div>

      <div className="mode-switch" role="group" aria-label={t('User mode', 'Modo de usuario')}>
        <button type="button" className={mode === 'planner' ? 'is-on' : ''} aria-pressed={mode === 'planner'} onClick={() => switchMode('planner')} data-testid="mode-planner">
          {t('Planner', 'Planificador')}
        </button>
        <button type="button" className={`mode-triage${mode === 'triage' ? ' is-on' : ''}`} aria-pressed={mode === 'triage'} onClick={() => switchMode('triage')} data-testid="mode-triage">
          {t('Emergency', 'Emergencia')}
        </button>
      </div>

      <div className="clock mono" data-testid="clock">
        <output>{startMs !== null ? fmtDateTime(startMs + Math.min(cursor, maxHours) * HOUR_MS) : '----'} UTC</output>
        <small>T+{fmtDuration(cursor)}</small>
      </div>

      <button
        type="button" className="btn btn-verif btn-guide" data-testid="briefing-open"
        onClick={() => useApp.getState().setBriefing('confirm')}
        title={t('Tutorial mode: a guided sequence that drives the app by itself', 'Modo tutorial: una secuencia guiada que conduce la app por sí sola')}
      >
        {t('Mission guide', 'Guía de misión')}
      </button>
      <button
        type="button" className="btn btn-verif btn-export" data-testid="export-csv" disabled={!data.result}
        onClick={() => { if (data.result) downloadText(`${exportStem(data.name, data.result)}_telemetry.csv`, buildTelemetryCsv(data.result, { site: data.name, scenario: data.key }), 'text/csv;charset=utf-8'); }}
        title={t('Download the simulated telemetry of the mission on screen: CSV, 26 columns in SI units, one row per hour', 'Descarga la telemetría simulada de la misión en pantalla: CSV, 26 columnas en unidades SI, una fila por hora')}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 2v8M4.5 6.8 8 10.3l3.5-3.5M2.5 13.5h11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {t('Export CSV', 'Exportar CSV')}
      </button>

      <div className="lang" role="group" aria-label="Language / Idioma">
        <button type="button" className={lang === 'en' ? 'is-on' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
        <button type="button" className={lang === 'es' ? 'is-on' : ''} aria-pressed={lang === 'es'} onClick={() => setLang('es')} data-testid="lang-es">ES</button>
      </div>

      <a
        className="btn btn-verif btn-guide-pdf" href={`${import.meta.env.BASE_URL}guide/guia-interfaz-${lang}.pdf`} target="_blank" rel="noopener" data-testid="guide-pdf"
        title={t('Full guide of every button and panel (PDF, opens in a new tab)', 'Guía completa de cada botón y panel (PDF, se abre en una pestaña nueva)')}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M4 1.5h5.5L13 5v9.5H4zM9.5 1.5V5H13M6 8.5h5M6 11h5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
        {t('Guide (PDF)', 'Guía (PDF)')}
      </a>
    </header>
  );
}
