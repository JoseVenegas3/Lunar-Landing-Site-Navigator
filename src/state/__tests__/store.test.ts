import { describe, expect, it } from 'vitest';
import { experienceFromUrl, normaliseMode, useApp } from '../store';

describe('app mode (v2.1: no Explorer)', () => {
  it('maps a stored or linked v2.0 "explorer" value, or anything unknown, to the planner', () => {
    expect(normaliseMode('explorer')).toBe('planner');
    expect(normaliseMode(undefined)).toBe('planner');
    expect(normaliseMode('triage')).toBe('triage');
    expect(normaliseMode('planner')).toBe('planner');
  });
  it('setMode never leaves the store in a retired mode', () => {
    useApp.getState().setMode('explorer');
    expect(useApp.getState().mode).toBe('planner');
    useApp.getState().setMode('triage');
    expect(useApp.getState().mode).toBe('triage');
    useApp.getState().setMode('planner');
  });
});

describe('v3.0 shared changes leave Mission Leader as it was', () => {
  it('outside the training every subsystem stays unlocked and the clock is the real one', () => {
    const s = useApp.getState();
    s.setExperience('leader');
    s.setUnlocked([]);
    s.setNowOverride(Date.UTC(2027, 8, 1));
    expect(useApp.getState().unlocked).toEqual(['overview', 'power', 'comms', 'terrain', 'science']);
    expect(useApp.getState().nowOverride).toBeNull();
  });
  it('the training can lock subsystems and fix "now"; leaving it frees both', () => {
    const s = useApp.getState();
    s.setExperience('beginner');
    s.setUnlocked(['overview']);
    s.setNowOverride(Date.UTC(2027, 8, 1));
    expect(useApp.getState().unlocked).toEqual(['overview']);
    expect(useApp.getState().nowOverride).toBe(Date.UTC(2027, 8, 1));
    s.setExperience('leader');
    expect(useApp.getState().unlocked).toHaveLength(5);
    expect(useApp.getState().nowOverride).toBeNull();
  });
  it('?mode= picks the experience; without it the gate comes first', () => {
    expect(experienceFromUrl('')).toBe('gate');
    expect(experienceFromUrl('?mode=leader')).toBe('leader');
    expect(experienceFromUrl('?mode=beginner&tutorialSpeed=fast')).toBe('beginner');
    expect(experienceFromUrl('?mode=other')).toBe('gate');
  });
  it('"Adopt this site" makes B the main scenario and ends the comparison; without a comparison it does nothing', () => {
    const s = useApp.getState();
    s.setCompare(true);
    s.updateScenario('B', { siteId: 'malapert-massif' });
    s.adoptB();
    expect(useApp.getState().scenarios.A.siteId).toBe('malapert-massif');
    expect(useApp.getState().compare).toBe(false);
    const before = useApp.getState().scenarios;
    useApp.getState().adoptB();
    expect(useApp.getState().scenarios).toBe(before);
  });
});
