/**
 * 3-D effects of the Beginner training (v3.0), drawn only in the training:
 *  - radio waves: rings that travel from the antenna towards the Earth while
 *    the link is open, on the steps that talk about the radio link.
 * With prefers-reduced-motion the mast appears at once and the rings stay
 * still. Nothing here changes the physics: both read the live sky state.
 */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { DoubleSide, Group, Mesh, MeshBasicMaterial, Quaternion, RingGeometry, Vector3 } from 'three';
import { LiveSky, landerAnim } from '../components/3d/sceneMath';
import { useBeginner } from './state';
import { SCRIPT } from './script';

const UP = new Vector3(0, 1, 0);
const reduced = (): boolean => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const RADIO_STEPS = new Set(['m0-earth-sets', 'm4-ok', 'm5-ok']);

export function BeginnerFx({ live, linkOpen }: { live: LiveSky; linkOpen: () => boolean }) {
  const { waves, group, dust } = useMemo(() => {
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
    return { waves: rings, group: g, dust };
  }, []);
  const q = useMemo(() => new Quaternion(), []);
  const v = useMemo(() => new Vector3(), []);

  useEffect(() => () => {
    for (const o of group.children) { const m = o as Mesh; m.geometry.dispose(); (m.material as MeshBasicMaterial).dispose(); }
  }, [group]);

  useFrame(() => {
    if (!live.valid) return;
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
    // Radio waves towards the Earth (one ring every 0.6 s, under 2 per second).
    const st = useBeginner.getState();
    const step = st.step >= 0 ? SCRIPT[st.step]?.id : '';
    const on = RADIO_STEPS.has(step ?? '') && linkOpen();
    const t = performance.now() / 1000;
    waves.forEach((w, k) => {
      w.visible = on;
      if (!on) return;
      const phase = reduced() ? (k + 1) / 4 : ((t / 1.8 + k / 3) % 1);
      v.copy(live.earthDir).multiplyScalar(0.05 + phase * 1.2);
      w.position.copy(live.eye).add(v);
      w.quaternion.copy(q.setFromUnitVectors(UP.clone().set(0, 0, 1), live.earthDir));
      const s = 0.012 + phase * 0.05;
      w.scale.set(s, s, s);
      (w.material as MeshBasicMaterial).opacity = 0.7 * (1 - phase);
    });
  });

  return <primitive object={group} />;
}
