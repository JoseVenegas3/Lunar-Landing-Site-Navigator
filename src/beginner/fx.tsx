/**
 * 3-D effects of the Beginner training (v3.0), drawn only in the training:
 *  - the telescopic mast: a pole from the deck to the array height the
 *    engine uses (`live.eye`, set by the mast selector), which grows when the
 *    mast goes from 2 m to 10 m;
 *  - radio waves: rings that travel from the antenna towards the Earth while
 *    the link is open, on the steps that talk about the radio link.
 * With prefers-reduced-motion the mast appears at once and the rings stay
 * still. Nothing here changes the physics: both read the live sky state.
 */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, RingGeometry, Vector3 } from 'three';
import { LiveSky } from '../components/3d/sceneMath';
import { useBeginner } from './state';
import { SCRIPT } from './script';

const UP = new Vector3(0, 1, 0);
const reduced = (): boolean => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const RADIO_STEPS = new Set(['m0-earth-sets', 'm4-ok', 'm5-ok']);

export function BeginnerFx({ live, linkOpen }: { live: LiveSky; linkOpen: () => boolean }) {
  const { mast, waves, group } = useMemo(() => {
    const g = new Group();
    const pole = new Mesh(new CylinderGeometry(1, 1, 1, 10), new MeshStandardMaterial({ color: 0xc9d4e3, metalness: 0.6, roughness: 0.4 }));
    pole.geometry.translate(0, 0.5, 0);
    g.add(pole);
    const rings: Mesh[] = [];
    for (let k = 0; k < 3; k++) {
      const r = new Mesh(new RingGeometry(0.8, 1, 40), new MeshBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.6, side: DoubleSide, depthWrite: false }));
      r.visible = false;
      g.add(r);
      rings.push(r);
    }
    return { mast: pole, waves: rings, group: g };
  }, []);
  const q = useMemo(() => new Quaternion(), []);
  const v = useMemo(() => new Vector3(), []);
  const state = useMemo(() => ({ height: 0 }), []);

  useEffect(() => () => {
    for (const o of group.children) { const m = o as Mesh; m.geometry.dispose(); (m.material as MeshBasicMaterial).dispose(); }
  }, [group]);

  useFrame((_, dt) => {
    if (!live.valid) return;
    // Mast: deck to the array height of the engine, growing at 1/s of the full height.
    const target = live.eye.y - live.lander.y;
    state.height = reduced() ? target : state.height + Math.sign(target - state.height) * Math.min(Math.abs(target - state.height), Math.max(0.002, Math.abs(target)) * dt * 1.2);
    mast.position.copy(live.lander);
    mast.scale.set(0.0018, Math.max(0.0001, state.height), 0.0018);
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
