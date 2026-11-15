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
import { BADGES, Badge } from './Badges';

function IconBtn({ label, d, onClick, testId, pressed }: { label: string; d: string; onClick: () => void; testId: string; pressed?: boolean }) {
  return (
    <button type="button" className="btn btn-small beg-ic" aria-label={label} title={label} aria-pressed={pressed} onClick={onClick} data-testid={testId}>
      <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
}

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
        <ol className="beg-rack" aria-label={t('Mission badges', 'Insignias de misión')} data-testid="beg-rack">
          {BADGES.map((bd, i) => (
            <li key={i} className={i < b.done ? 'is-earned' : i === step.mission ? 'is-now' : ''} title={`${MISSION_TITLES[i][lang === 'es' ? 1 : 0]} · ${bd.name[lang === 'es' ? 1 : 0]}`} data-testid={`seal-${i}`} data-earned={i < b.done ? '1' : undefined}>
              <Badge i={i} earned={i < b.done} fresh={i === b.done - 1} size={26} />
              <span className="sr-only">{bd.name[lang === 'es' ? 1 : 0]}{i < b.done ? t(' (earned)', ' (obtenida)') : ''}</span>
            </li>
          ))}
        </ol>
        <IconBtn label={b.muted ? t('Sound off: turn on', 'Sonido apagado: activar') : t('Sound on: mute', 'Sonido activo: silenciar')} pressed={b.muted} onClick={() => b.setSound({ muted: !b.muted })} testId="beg-mute"
          d={b.muted ? 'M3 8h3l4-3v10l-4-3H3zM13 8l4 4M17 8l-4 4' : 'M3 8h3l4-3v10l-4-3H3zM13 7.5a3.5 3.5 0 0 1 0 5M15 5.5a6.5 6.5 0 0 1 0 9'} />
        <label className="beg-vol">
          <span className="sr-only">{t('Volume', 'Volumen')}</span>
          <input type="range" min={0} max={1} step={0.05} value={b.volume} onChange={(e) => b.setSound({ volume: Number(e.target.value) })} aria-label={t('Volume', 'Volumen')} data-testid="beg-volume" />
        </label>
        <IconBtn label={b.music ? t('Music on: turn off', 'Música activa: apagar') : t('Music off: turn on', 'Música apagada: activar')} pressed={!b.music} onClick={() => b.setSound({ music: !b.music })} testId="beg-music"
          d={b.music ? 'M8 15V5l8-2v10M8 15a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM16 13a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z' : 'M8 15V5l8-2v10M8 15a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM3 3l14 14'} />
        <IconBtn label={t('Subtitles', 'Subtítulos')} pressed={b.subtitles} onClick={() => b.setSound({ subtitles: !b.subtitles })} testId="beg-subtitles" d="M3 5h14v10H3zM6 11h3M11 11h3M6 8.5h8" />
        <IconBtn label={t('Repeat step', 'Repetir paso')} onClick={repeat} testId="beg-repeat" d="M4 10a6 6 0 1 0 2-4.5M4 3v3h3" />
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
