/**
 * 3-D effects of the Beginner training (v3.0), drawn only in the training:
 *  - radio waves: rings that travel from the antenna towards the Earth while
 *    the link is open, on the steps that talk about the radio link, and up to
 *    the orbital relay once it is switched on;
 *  - sunlight pulses: glowing beads that run down the Sun direction onto the
 *    array while the Sun is up, on the energy steps;
 *  - a dust ring wherever the lander touches down (landing, relocation hop).
 * With prefers-reduced-motion the mast appears at once and the rings stay
 * still. Nothing here changes the physics: both read the live sky state.
 */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, DoubleSide, Group, Mesh, MeshBasicMaterial, Quaternion, RingGeometry, SphereGeometry, Vector3 } from 'three';
import { useApp } from '../state/store';
import { LiveSky, landerAnim } from '../components/3d/sceneMath';
import { useBeginner } from './state';
import { SCRIPT } from './script';

const UP = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);
const reduced = (): boolean => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const RADIO_STEPS = new Set(['m0-earth-sets', 'm4-ok', 'm4-relay', 'm5-ok', 'm5-gimbal']);
const SUN_STEPS = new Set(['m0-zoom', 'm0-low-sun', 'm0-play', 'm0-charged', 'm3-mast', 'm3-mount', 'm3-ok']);

export function BeginnerFx({ live, linkOpen }: { live: LiveSky; linkOpen: () => boolean }) {
  const { waves, group, dust, beads } = useMemo(() => {
    const g = new Group();
    const rings: Mesh[] = [];
    for (let k = 0; k < 3; k++) {
      const r = new Mesh(new RingGeometry(0.8, 1, 40), new MeshBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.6, side: DoubleSide, depthWrite: false }));
      r.visible = false;
      g.add(r);
      rings.push(r);
    }
    const dust = new Mesh(new RingGeometry(0.6, 1, 48), new MeshBasicMaterial({ color: 0xcbbfa8, transparent: true, opacity: 0, side: DoubleSide, depthWrite: false }));
    dust.rotation.x = -Math.PI / 2;
    g.add(dust);
    const beads: Mesh[] = [];
    for (let k = 0; k < 6; k++) {
      const m = new Mesh(new SphereGeometry(1, 10, 8), new MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }));
      m.visible = false;
      g.add(m);
      beads.push(m);
    }
    return { waves: rings, group: g, dust, beads };
  }, []);
  const q = useMemo(() => new Quaternion(), []);
  const v = useMemo(() => new Vector3(), []);

  useEffect(() => () => {
    for (const o of group.children) { const m = o as Mesh; m.geometry.dispose(); (m.material as MeshBasicMaterial).dispose(); }
  }, [group]);

  useFrame(() => {
    if (!live.valid) return;
    const st = useBeginner.getState();
    // Dust ring at touchdown: 1.6 s, expanding on the ground.
    const age = (performance.now() - landerAnim.dustAt) / 1600;
    const dm = dust.material as MeshBasicMaterial;
    if (landerAnim.dustAt > 0 && age < 1) {
      dust.position.copy(live.lander);
      dust.position.y += 0.0005;
      const s = 0.004 + age * 0.06;
      dust.scale.set(s, s, s);
      dm.opacity = 0.75 * (1 - age);
    } else dm.opacity = 0;
    // Sunlight pulses running down the Sun direction onto the array.
    const sunOn = SUN_STEPS.has((st.step >= 0 ? SCRIPT[st.step]?.id : '') ?? '') && live.sunFrac > 0;
    const tt = performance.now() / 1000;
    beads.forEach((bd, k) => {
      bd.visible = sunOn;
      if (!sunOn) return;
      const ph = reduced() ? (k + 0.5) / beads.length : ((tt / 1.6 + k / beads.length) % 1);
      bd.position.copy(live.eye).addScaledVector(live.sunDir, 0.9 * (1 - ph));
      const r = 0.004 + 0.003 * Math.sin(Math.PI * ph);
      bd.scale.set(r, r, r);
      (bd.material as MeshBasicMaterial).opacity = 0.9 * Math.sin(Math.PI * ph);
    });
    // Radio waves towards the Earth (one ring every 0.6 s, under 2 per second).
    const step = st.step >= 0 ? SCRIPT[st.step]?.id : '';
    const relay = useApp.getState().relay.enabled;
    const on = RADIO_STEPS.has(step ?? '') && (linkOpen() || relay);
    const t = performance.now() / 1000;
    waves.forEach((w, k) => {
      w.visible = on;
      if (!on) return;
      const phase = reduced() ? (k + 1) / 4 : ((t / 1.8 + k / 3) % 1);
      // with the relay on, every other ring climbs to the orbiting relay above the pole
      const dir = relay && k % 2 === 1 ? UP : live.earthDir;
      v.copy(dir).multiplyScalar(0.05 + phase * 1.2);
      w.position.copy(live.eye).add(v);
      w.quaternion.copy(q.setFromUnitVectors(Z_AXIS, dir));
      const s = 0.012 + phase * 0.05;
      w.scale.set(s, s, s);
      (w.material as MeshBasicMaterial).opacity = 0.7 * (1 - phase);
    });
  });

  return <primitive object={group} />;
}
