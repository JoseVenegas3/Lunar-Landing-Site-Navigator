/** Top bar: identity, global mode switch, mission clock, guide, export and language. The time transport lives in the 3-D view. */
import { HOUR_MS } from '../engine';
import { useActiveScenario, useThrottledCursor } from '../state/mission';
import { AppMode, maxCursorHours, useApp } from '../state/store';
import { fmtDateTime, fmtDuration, useT } from '../lib/format';
import { buildTelemetryCsv, downloadText, exportStem } from '../lib/export';
import { useState } from 'react';
import { reopenGate } from '../beginner/lifecycle';
import { BeginnerHud } from '../beginner/Hud';
import { useBeginner } from '../beginner/state';
import { UnitToggle } from './UnitToggle';

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
  const experience = useApp((s) => s.experience);
  const pitch = useApp((s) => s.pitch);
  const [sure, setSure] = useState(false);
  const reveal = useBeginner((s) => s.reveal);

  const switchMode = (m: AppMode): void => {
    if (m !== 'planner') setActive('A');
    setMode(m);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <img className="brand-logo" src={`${import.meta.env.BASE_URL}brand/logo-gisat.png`} alt="GISAT UDEC" width="38" height="38" data-testid="brand-logo" />
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

      {experience === 'beginner' && <BeginnerHud />}
      <button
        type="button" className="btn btn-link-ver" data-testid="switch-version"
        onClick={() => { if (experience === 'beginner' && !sure) { setSure(true); window.setTimeout(() => setSure(false), 4000); return; } reopenGate(); }}
        title={t('Back to the entry question (Beginner or Mission Leader)', 'Volver a la pregunta de entrada (Principiante o Mission Leader)')}
      >
        {sure ? t('The training progress is lost. Click again', 'Se pierde el progreso del entrenamiento. Pulsa de nuevo') : t('Switch version', 'Cambiar de versión')}
      </button>
      {experience === 'leader' && <button
        type="button" className="btn btn-verif btn-guide" data-testid="briefing-open"
        onClick={() => useApp.getState().setBriefing('confirm')}
        title={t('Tutorial mode: a guided sequence that drives the app by itself', 'Modo tutorial: una secuencia guiada que conduce la app por sí sola')}
      >
        {t('Mission guide', 'Guía de misión')}
      </button>}
      {(experience !== 'beginner' || reveal.includes('export')) && <button
        type="button" className="btn btn-verif btn-export" data-testid="export-csv" disabled={!data.result}
        onClick={() => { if (data.result) downloadText(`${exportStem(data.name, data.result)}_telemetry.csv`, buildTelemetryCsv(data.result, { site: data.name, scenario: data.key, displayUnits: useApp.getState().unitSystem }), 'text/csv;charset=utf-8'); }}
        title={t('Download the simulated telemetry of the mission on screen: CSV, 26 columns, always in SI units (the unit is in each column name), one row per hour', 'Descarga la telemetría simulada de la misión en pantalla: CSV, 26 columnas, siempre en unidades SI (la unidad va en el nombre de cada columna), una fila por hora')}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 2v8M4.5 6.8 8 10.3l3.5-3.5M2.5 13.5h11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {t('Export CSV', 'Exportar CSV')}
      </button>}

      <div className="lang" role="group" aria-label="Language / Idioma">
        <button type="button" className={lang === 'en' ? 'is-on' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
        <button type="button" className={lang === 'es' ? 'is-on' : ''} aria-pressed={lang === 'es'} onClick={() => setLang('es')} data-testid="lang-es">ES</button>
      </div>
      <UnitToggle />
      {experience === 'leader' && !pitch && <a className="btn btn-verif btn-pitch" href={`${import.meta.env.BASE_URL}?pitch=true`} data-testid="pitch-open" aria-label="Video pitch (3:00)" title={t('Three-minute animated pitch over the real app, with teleprompter and recorder', 'Pitch animado de tres minutos sobre la app real, con teleprompter y grabador')}><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M5 3.5v9l7-4.5z" fill="currentColor" /></svg><span>{t('Video pitch (3:00)', 'Video pitch (3:00)')}</span></a>}

      {experience !== 'beginner' && <a
        className="btn btn-verif btn-guide-pdf" href={`${import.meta.env.BASE_URL}guide/guia-interfaz-${lang}.pdf`} target="_blank" rel="noopener" data-testid="guide-pdf"
        title={t('Full guide of every button and panel (PDF, opens in a new tab)', 'Guía completa de cada botón y panel (PDF, se abre en una pestaña nueva)')}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M4 1.5h5.5L13 5v9.5H4zM9.5 1.5V5H13M6 8.5h5M6 11h5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
        {t('Guide (PDF)', 'Guía (PDF)')}
      </a>}
    </header>
  );
}
