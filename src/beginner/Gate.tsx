/**
 * Entry gate (v3.0): the first thing on screen at every load, over the
 * terrain loading (which goes on behind it). "Have you used this app before?"
 *   No  → Start training (Beginner), or the small "Go straight to Pro" with a
 *         two-step warning inside the same overlay.
 *   Yes → Open Mission Leader, or the small "Forgot how it works?" → Beginner.
 * The answer is not stored: the question comes back on every load. It is a
 * full-screen overlay of its own (a bounded exception to "no modals",
 * ARCHITECTURE §6.8): role="dialog", aria-modal, focus on the first answer,
 * Escape does not close it.
 */
import { useEffect, useRef, useState } from 'react';
import { Experience, useApp } from '../state/store';
import { useT } from '../lib/format';
import { unlockAudio } from './audio';
import { UnitToggle } from '../components/UnitToggle';

type Step = 'ask' | 'no' | 'yes' | 'confirm-pro';

export function Gate({ ready, progress, onEnter }: { ready: boolean; progress: number; onEnter: (e: Exclude<Experience, 'gate'>) => void }) {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const setLang = useApp((s) => s.setLang);
  const [step, setStep] = useState<Step>('ask');
  const [pending, setPending] = useState<Exclude<Experience, 'gate'> | null>(null);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => { first.current?.focus(); }, [step]);
  useEffect(() => { if (pending && ready) onEnter(pending); }, [pending, ready, onEnter]);
  // Escape never closes the gate; Tab stays inside it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') e.preventDefault(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = (e: Exclude<Experience, 'gate'>): void => {
    if (e === 'beginner') unlockAudio();
    setPending(e);
  };

  return (
    <div className="gate" role="dialog" aria-modal="true" aria-labelledby="gate-q" data-testid="gate" data-step={step}>
      <div className="gate-card">
        <div className="gate-head">
          <img src={`${import.meta.env.BASE_URL}brand/logo-gisat.png`} alt="GISAT UDEC" width="72" height="72" />
          <div>
            <strong>CLPS Lunar Mission Browser</strong>
            <span>NASA Space Apps 2026 · GISAT UdeC</span>
          </div>
        </div>
        <div className="gate-prefs">
          <div className="lang gate-lang" role="group" aria-label="Language / Idioma">
            <span className="units-cap">{t('Language', 'Idioma')}</span>
            <button type="button" className={lang === 'en' ? 'is-on' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')} data-testid="gate-lang-en">EN</button>
            <button type="button" className={lang === 'es' ? 'is-on' : ''} aria-pressed={lang === 'es'} onClick={() => setLang('es')} data-testid="gate-lang-es">ES</button>
          </div>
          <UnitToggle long testid="gate-units" />
        </div>

        {pending ? (
          <div className="gate-body" role="status">
            <p>{t('Loading the south-polar terrain…', 'Cargando el terreno del polo sur…')}</p>
            <div className="bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <p className="mono gate-pct" data-testid="gate-loading">{Math.round(progress * 100)} %</p>
          </div>
        ) : step === 'confirm-pro' ? (
          <div className="gate-body">
            <h2 id="gate-q">{t('Without the training you will see every engineering control at once. Are you sure?', 'Sin el entrenamiento verás todos los controles de ingeniería a la vez. ¿Seguro?')}</h2>
            <div className="gate-actions">
              <button ref={first} type="button" className="btn gate-main" onClick={() => go('beginner')} data-testid="gate-back-training">{t('Back to the training', 'Volver al entrenamiento')}</button>
              <button type="button" className="btn btn-small gate-minor" onClick={() => go('leader')} data-testid="gate-pro-confirm">{t('Yes, open Pro', 'Sí, abrir Pro')}</button>
            </div>
          </div>
        ) : (
          <div className="gate-body">
            <h2 id="gate-q">{t('Have you used this app before?', '¿Has usado esta app alguna vez?')}</h2>
            <div className="gate-answers" role="radiogroup" aria-labelledby="gate-q">
              <button ref={step === 'ask' ? first : undefined} type="button" role="radio" aria-checked={step === 'no'} className={`gate-answer${step === 'no' ? ' is-on' : ''}`} onClick={() => setStep('no')} data-testid="gate-no">{t('No', 'No')}</button>
              <button type="button" role="radio" aria-checked={step === 'yes'} className={`gate-answer${step === 'yes' ? ' is-on' : ''}`} onClick={() => setStep('yes')} data-testid="gate-yes">{t('Yes', 'Sí')}</button>
            </div>
            {step === 'no' && (
              <div className="gate-actions">
                <button ref={first} type="button" className="btn gate-main" onClick={() => go('beginner')} data-testid="gate-start-training">{t('Start training (Guided mode)', 'Comenzar entrenamiento (Modo Guiado)')}</button>
                <button type="button" className="btn btn-small gate-minor" onClick={() => setStep('confirm-pro')} data-testid="gate-skip-pro">{t('Go straight to the Pro version', 'Ir directo a la versión Pro')}</button>
              </div>
            )}
            {step === 'yes' && (
              <div className="gate-actions">
                <button ref={first} type="button" className="btn gate-main" onClick={() => go('leader')} data-testid="gate-open-leader">{t('Open Mission Leader (Full mode)', 'Abrir Mission Leader (Modo Completo)')}</button>
                <button type="button" className="btn btn-small gate-minor" onClick={() => go('beginner')} data-testid="gate-forgot">{t('Forgot how it works? Go to the training', '¿Te olvidaste cómo funciona? Ir al entrenamiento')}</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
