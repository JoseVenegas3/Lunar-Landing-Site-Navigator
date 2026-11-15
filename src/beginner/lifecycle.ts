/**
 * Start and end of the Beginner training (v3.0). Leaving it, by the diploma
 * or by "Exit to Pro", removes every lock and the training overrides
 * (attitude, hardware and `nowOverride`) but keeps the site the user
 * validated, and opens Mission Leader with every control free.
 */
import { DEFAULT_POWER, DEFAULT_RELAY, NOMINAL_ATTITUDE } from '../engine';
import { cancelSubsystemSwitch } from '../components/dashboard/SubsystemSwitch';
import { useApp } from '../state/store';
import { closeAudio } from './audio';
import { useBeginner } from './state';

export const DEFAULT_ATTITUDE_RESET = { ...NOMINAL_ATTITUDE };

export function finishTraining(): void {
  cancelSubsystemSwitch();
  const s = useApp.getState();
  s.setPlaying(false);
  s.setAttitude({ ...NOMINAL_ATTITUDE });
  s.setPower({ ...DEFAULT_POWER });
  s.setRelay({ ...DEFAULT_RELAY });
  s.setMast(2);
  if (s.compare) s.setCompare(false);
  s.setMode('planner');
  s.setOverlay('none');
  s.setExperience('leader'); // frees every subsystem and clears nowOverride
  useBeginner.getState().set({ step: -1, reveal: [], fresh: null, nudge: null, caption: null, stuck: 0 });
  closeAudio();
}

/** Back to the gate (the "Switch version" link). */
export function reopenGate(): void {
  cancelSubsystemSwitch();
  const s = useApp.getState();
  if (s.experience === 'beginner') finishTraining();
  useApp.getState().setExperience('gate');
}
