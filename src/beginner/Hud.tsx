/**
 * Training controls in the top bar (v3.0 Beginner): mission seals, sound
 * (mute, volume, subtitles), repeat the step and leave to the Pro console
 * (with confirmation). In the top bar they never cover a target of the script.
 */
import { useState } from 'react';
import { useApp } from '../state/store';
import { useT } from '../lib/format';
import { finishTraining } from './lifecycle';
import { MISSION_TITLES, SCRIPT } from './script';
import { useBeginner } from './state';

export function BeginnerHud() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const b = useBeginner();
  const [confirmExit, setConfirmExit] = useState(false);
  const step = b.step >= 0 ? SCRIPT[b.step] : null;
  if (!step) return null;
  const repeat = (): void => {
    const st = useBeginner.getState();
    const cur = st.step;
    st.set({ step: -1 });
    window.setTimeout(() => useBeginner.getState().set({ step: cur }), 0);
  };
  return (
    <>
      <header className="beg-hud" data-testid="beg-hud" role="toolbar" aria-label={t('Training', 'Entrenamiento')}>
        <ol className="beg-seals" aria-label={t('Missions', 'Misiones')}>
          {MISSION_TITLES.map((m, i) => (
            <li key={i} className={i < b.done ? 'is-done' : i === step.mission ? 'is-now' : ''} title={m[lang === 'es' ? 1 : 0]} data-testid={`seal-${i}`}>
              <span aria-hidden="true">{i < b.done ? '★' : i + 1}</span>
              <span className="sr-only">{m[lang === 'es' ? 1 : 0]}{i < b.done ? t(' (done)', ' (completada)') : ''}</span>
            </li>
          ))}
        </ol>
        <span className="beg-title">{t('Mission', 'Misión')} {step.mission} · {MISSION_TITLES[step.mission][lang === 'es' ? 1 : 0]}</span>
        <button type="button" className="btn btn-small" aria-pressed={b.muted} onClick={() => b.setSound({ muted: !b.muted })} data-testid="beg-mute">{b.muted ? t('Sound off', 'Sonido apagado') : t('Sound on', 'Sonido activo')}</button>
        <label className="beg-vol">
          <span className="sr-only">{t('Volume', 'Volumen')}</span>
          <input type="range" min={0} max={1} step={0.05} value={b.volume} onChange={(e) => b.setSound({ volume: Number(e.target.value) })} aria-label={t('Volume', 'Volumen')} data-testid="beg-volume" />
        </label>
        <button type="button" className="btn btn-small" aria-pressed={b.subtitles} onClick={() => b.setSound({ subtitles: !b.subtitles })} data-testid="beg-subtitles">{t('Subtitles', 'Subtítulos')}</button>
        <button type="button" className="btn btn-small" onClick={repeat} data-testid="beg-repeat">{t('Repeat step', 'Repetir paso')}</button>
        <button type="button" className="btn btn-small" onClick={() => setConfirmExit(true)} data-testid="beg-exit">{t('Exit to Pro', 'Salir al Pro')}</button>
      </header>

      {confirmExit && (
        <div className="beg-confirm" role="alertdialog" aria-label={t('Leave the training', 'Salir del entrenamiento')} data-testid="beg-exit-confirm">
          <p>{t('Leave the training? Your progress is lost and every control opens at once.', '¿Salir del entrenamiento? Se pierde el progreso y se abren todos los controles a la vez.')}</p>
          <div className="brief-actions">
            <button type="button" className="btn btn-small btn-brief" onClick={() => setConfirmExit(false)} autoFocus>{t('Stay in the training', 'Seguir entrenando')}</button>
            <button type="button" className="btn btn-small" onClick={finishTraining} data-testid="beg-exit-yes">{t('Yes, open Pro', 'Sí, abrir Pro')}</button>
          </div>
        </div>
      )}

    </>
  );
}
