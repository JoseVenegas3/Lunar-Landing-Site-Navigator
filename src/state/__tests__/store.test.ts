import { describe, expect, it } from 'vitest';
import { normaliseMode, useApp } from '../store';

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
