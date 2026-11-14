/** Top bar: identity, global mode switch, time transport and language. */
import { HOUR_MS } from '../engine';
import { useActiveScenario, useThrottledCursor } from '../state/mission';
import { AppMode, maxCursorHours, useApp } from '../state/store';
import { fmtDateTime, fmtDuration, useT } from '../lib/format';

const SPEEDS = [1, 6, 12, 24, 72];

export function TopBar() {
  const t = useT();
  const mode = useApp((s) => s.mode);
  const lang = useApp((s) => s.lang);
  const playing = useApp((s) => s.playing);
  const speed = useApp((s) => s.speed);
  const setMode = useApp((s) => s.setMode);
  const setLang = useApp((s) => s.setLang);
  const setPlaying = useApp((s) => s.setPlaying);
  const setSpeed = useApp((s) => s.setSpeed);
  const setCursor = useApp((s) => s.setCursor);
  const setActive = useApp((s) => s.setActive);
  const setVerificationOpen = useApp((s) => s.setVerificationOpen);
  const maxHours = useApp((s) => maxCursorHours(s));
  const cursor = useThrottledCursor();
  const data = useActiveScenario();
  const startMs = data.result?.eph.startMs ?? null;

  const switchMode = (m: AppMode): void => {
    if (m !== 'planner') setActive('A');
    setMode(m);
  };
  const nudge = (hours: number): void => {
    setPlaying(false);
    setCursor(useApp.getState().cursorHours + hours);
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
        <button type="button" className={mode === 'explorer' ? 'is-on' : ''} aria-pressed={mode === 'explorer'} onClick={() => switchMode('explorer')} data-testid="mode-explorer">
          {t('Explorer', 'Explorador')}
        </button>
        <button type="button" className={`mode-triage${mode === 'triage' ? ' is-on' : ''}`} aria-pressed={mode === 'triage'} onClick={() => switchMode('triage')} data-testid="mode-triage">
          {t('Emergency', 'Emergencia')}
        </button>
      </div>

      <div className="transport">
        <button type="button" className="btn btn-icon" onClick={() => nudge(-24)} aria-label={t('Back one day', 'Retroceder un día')} title={t('Back one day', 'Retroceder un día')}>−1d</button>
        <button type="button" className="btn btn-icon" onClick={() => nudge(-1)} aria-label={t('Back one hour', 'Retroceder una hora')} title={t('Back one hour', 'Retroceder una hora')}>−1h</button>
        <button type="button" className={`btn btn-play${playing ? ' is-on' : ''}`} onClick={() => setPlaying(!playing)} data-testid="play" aria-pressed={playing}>
          {playing ? t('Pause', 'Pausa') : t('Play', 'Reproducir')}
        </button>
        <button type="button" className="btn btn-icon" onClick={() => nudge(1)} aria-label={t('Forward one hour', 'Avanzar una hora')} title={t('Forward one hour', 'Avanzar una hora')}>+1h</button>
        <button type="button" className="btn btn-icon" onClick={() => nudge(24)} aria-label={t('Forward one day', 'Avanzar un día')} title={t('Forward one day', 'Avanzar un día')}>+1d</button>
        <label className="speed">
          <span className="sr-only">{t('Playback rate', 'Velocidad de reproducción')}</span>
          <select className="mono" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} data-testid="speed">
            {SPEEDS.map((s) => <option key={s} value={s}>{s} h/s</option>)}
          </select>
        </label>
        <div className="clock mono" data-testid="clock">
          <output>{startMs !== null ? fmtDateTime(startMs + Math.min(cursor, maxHours) * HOUR_MS) : '----'} UTC</output>
          <small>T+{fmtDuration(cursor)} · {data.key}</small>
        </div>
      </div>

      <button
        type="button" className="btn btn-verif btn-guide" data-testid="briefing-open"
        onClick={() => { switchMode('planner'); useApp.getState().setBriefing(0); }}
        title={t('Relaunch the mission briefing tour', 'Relanzar el recorrido de inducción')}
      >
        {t('Mission guide', 'Guía de misión')}
      </button>
      <button type="button" className="btn btn-verif" onClick={() => setVerificationOpen(true)} data-testid="open-verification">
        {t('Verification', 'Verificación')}
      </button>

      <div className="lang" role="group" aria-label="Language / Idioma">
        <button type="button" className={lang === 'en' ? 'is-on' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
        <button type="button" className={lang === 'es' ? 'is-on' : ''} aria-pressed={lang === 'es'} onClick={() => setLang('es')} data-testid="lang-es">ES</button>
      </div>
    </header>
  );
}
