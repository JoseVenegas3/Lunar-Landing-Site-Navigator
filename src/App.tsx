import { useEffect, useState } from 'react';
import { TopBar } from './components/TopBar';
import { PlannerLayout } from './components/dashboard/PlannerLayout';
import { TriageLayout } from './components/triage/TriageLayout';
import { MissionBriefingTour } from './components/MissionBriefingTour';
import { Gate } from './beginner/Gate';
import { Beginner } from './beginner/Beginner';
import { useBeginner } from './beginner/state';
import { ensureRegional } from './state/dem';
import { loadScienceLayers } from './state/science';
import { MissionProvider } from './state/mission';
import { maxCursorHours, useApp } from './state/store';
import { useT } from './lib/format';

/** Advances the shared time cursor while playback is on. */
function usePlayback(): void {
  const playing = useApp((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      const s = useApp.getState();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const max = maxCursorHours(s);
      let next = s.cursorHours + s.speed * dt;
      if (next >= max) next = 0;
      s.setCursor(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

function BootScreen({ progress }: { progress: number }) {
  const t = useT();
  return (
    <div className="boot" role="status" data-testid="boot">
      <div className="boot-inner">
        <img className="boot-logo" src={`${import.meta.env.BASE_URL}brand/logo-gisat.png`} alt="GISAT UDEC" width="96" height="96" data-testid="boot-logo" />
        <strong>CLPS Lunar Mission Browser</strong>
        <p>{t('Loading the south-polar terrain (LRO LOLA)', 'Cargando el terreno del polo sur (LRO LOLA)')}</p>
        <div className="bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
        <p className="mono boot-detail">
          80° S – 90° S · 800 m/px · {Math.round(progress * 100)}%
        </p>
      </div>
    </div>
  );
}

export function App() {
  const mode = useApp((s) => s.mode);
  const experience = useApp((s) => s.experience);
  const setExperience = useApp((s) => s.setExperience);
  const reveal = useBeginner((s) => s.reveal);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  usePlayback();

  useEffect(() => {
    let alive = true;
    void ensureRegional((f) => { if (alive) setProgress(f); }).then(() => { if (alive) setReady(true); });
    loadScienceLayers();
    return () => { alive = false; };
  }, []);

  // v3.0: the entry gate comes first, over the terrain loading (which goes on behind it).
  if (experience === 'gate') {
    return (
      <>
        <BootScreen progress={progress} />
        <Gate ready={ready} progress={progress} onEnter={setExperience} />
      </>
    );
  }
  if (!ready) return <BootScreen progress={progress} />;
  return (
    <MissionProvider>
      <div className={`app app-${mode}`} data-experience={experience} data-reveal={experience === 'beginner' ? reveal.join(' ') : undefined}>
        <TopBar />
        {mode === 'triage' ? <TriageLayout /> : <PlannerLayout />}
        {experience === 'leader' && <MissionBriefingTour />}
        {experience === 'beginner' && <Beginner />}
      </div>
    </MissionProvider>
  );
}
