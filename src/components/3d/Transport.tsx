/** Time transport over the 3-D view: one hour back, play / pause, one hour forward and the playback rate. */
import { PLAYBACK_SPEEDS, useApp } from '../../state/store';
import { useT } from '../../lib/format';

export function Transport() {
  const t = useT();
  const playing = useApp((s) => s.playing);
  const speed = useApp((s) => s.speed);
  const setPlaying = useApp((s) => s.setPlaying);
  const setSpeed = useApp((s) => s.setSpeed);
  const nudge = (hours: number): void => {
    const s = useApp.getState();
    s.setPlaying(false);
    s.setCursor(s.cursorHours + hours);
  };
  return (
    <div className="hud-block hud-bc transport" role="group" aria-label={t('Time transport', 'Control de tiempo')} data-testid="transport">
      <button type="button" className="btn btn-icon" onClick={() => nudge(-1)} aria-label={t('Back one hour', 'Retroceder una hora')} title={t('Back one hour', 'Retroceder una hora')} data-testid="hour-back">−1 h</button>
      <button type="button" className={`btn btn-play${playing ? ' is-on' : ''}`} onClick={() => setPlaying(!playing)} data-testid="play" aria-pressed={playing}>
        <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
          {playing ? <path d="M3 2h2v8H3zM7 2h2v8H7z" fill="currentColor" /> : <path d="M3 1.8v8.4L10 6Z" fill="currentColor" />}
        </svg>
        {playing ? t('Pause', 'Pausa') : t('Play', 'Reproducir')}
      </button>
      <button type="button" className="btn btn-icon" onClick={() => nudge(1)} aria-label={t('Forward one hour', 'Avanzar una hora')} title={t('Forward one hour', 'Avanzar una hora')} data-testid="hour-fwd">+1 h</button>
      <div className="speed-seg" role="radiogroup" aria-label={t('Playback rate', 'Velocidad de reproducción')} data-testid="speed">
        {PLAYBACK_SPEEDS.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={speed === s} className={speed === s ? 'is-on' : ''} onClick={() => setSpeed(s)} data-speed={s}>
            {s} h/s
          </button>
        ))}
      </div>
    </div>
  );
}
