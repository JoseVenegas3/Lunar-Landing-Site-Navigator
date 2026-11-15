/** The video pitch lasts exactly 180 s, in six acts and seventeen scenes with no gap or overlap. */
import { describe, expect, it } from 'vitest';
import { ACTS, MARKS, PITCH_DURATION_S, SCENES, actAt, clock, fill, nextSceneStart, prevSceneStart, sceneAt } from '../timeline';
import { DIRECTION } from '../director';

describe('pitch timeline', () => {
  it('is exactly 180 s with the six acts of the brief', () => {
    expect(PITCH_DURATION_S).toBe(180);
    expect(ACTS.map((a) => [a.start, a.end])).toEqual([[0, 25], [25, 45], [45, 80], [80, 135], [135, 160], [160, 180]]);
    expect(MARKS.map(clock)).toEqual(['0:00', '0:25', '0:45', '1:20', '2:15', '2:40', '3:00']);
  });
  it('tiles the timeline with scenes, each inside its act', () => {
    expect(SCENES[0].start).toBe(0);
    expect(SCENES[SCENES.length - 1].end).toBe(180);
    for (let i = 1; i < SCENES.length; i++) expect(SCENES[i].start).toBe(SCENES[i - 1].end);
    for (const s of SCENES) {
      const a = ACTS.find((x) => x.id === s.act)!;
      expect(s.start).toBeGreaterThanOrEqual(a.start);
      expect(s.end).toBeLessThanOrEqual(a.end);
      expect(s.end).toBeGreaterThan(s.start);
    }
    // the five differentiators of Mission Leader take 11 s each
    expect(SCENES.filter((s) => s.id.startsWith('ocean')).map((s) => s.end - s.start)).toEqual([11, 11, 11, 11, 11]);
  });
  it('has a direction and a bilingual teleprompter line for every scene', () => {
    for (const s of SCENES) {
      expect(DIRECTION[s.id]).toBeDefined();
      expect(s.say[0].length).toBeGreaterThan(30);
      expect(s.say[1].length).toBeGreaterThan(30);
      // the same live slots in both languages
      const slots = (x: string) => (x.match(/\{\w+\}/g) ?? []).sort().join();
      expect(slots(s.say[0])).toBe(slots(s.say[1]));
    }
  });
  it('finds the scene and the act at any time, and steps between scenes', () => {
    expect(sceneAt(0).id).toBe('im1');
    expect(sceneAt(24.99).id).toBe('stat');
    expect(sceneAt(25).id).toBe('brand');
    expect(sceneAt(180).id).toBe('finale');
    expect(sceneAt(999).id).toBe('finale');
    expect(actAt(140).id).toBe('emergency');
    expect(nextSceneStart(30)).toBe(34);
    expect(prevSceneStart(36)).toBe(34);
    expect(prevSceneStart(34.5)).toBe(25);
    expect(nextSceneStart(175)).toBe(180);
  });
  it('fills live values into the teleprompter', () => {
    expect(fill('Now: {head}', { head: 'SURVIVES' })).toBe('Now: SURVIVES');
    expect(fill('Now: {head}', {})).toBe('Now: …');
  });
  it('types no engine figure by hand in the teleprompter (they come from the app)', () => {
    // allowed: dates of real missions, the 3.7 m dish, 10 m mast, 200 m, 20 m maps, 30 degrees, P10/P50/P90, 500 m, 25 points
    const allowed = /(IM-[12]|6-DOF|3-D|3D|2024|2025|3[.,]7|10 met|200 met|20 m|30 deg|30 grad|P10|P50|P90|500 met|25 (touchdown|puntos))/g;
    for (const s of SCENES) for (const line of s.say) expect(line.replace(allowed, '').replace(/\{\w+\}/g, ''), line).not.toMatch(/\d/);
  });
});
