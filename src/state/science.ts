/**
 * Loader of the orbital science layers in public/science/. They are optional:
 * the application runs without them and the score falls back to what the
 * terrain engine can derive.
 */
import { create } from 'zustand';
import { ScienceLayers, ScienceManifest, decodeScienceLayers } from '../engine';

interface ScienceState {
  layers: ScienceLayers | null;
  status: 'idle' | 'loading' | 'ready' | 'missing';
}
export const useScience = create<ScienceState>(() => ({ layers: null, status: 'idle' }));

let started = false;

export function loadScienceLayers(): void {
  if (started) return;
  started = true;
  useScience.setState({ status: 'loading' });
  const url = (file: string): string => `${import.meta.env.BASE_URL}science/${file}`;
  void (async () => {
    try {
      const res = await fetch(url('layers.json'));
      if (!res.ok) throw new Error(`layers.json: HTTP ${res.status}`);
      const manifest = (await res.json()) as ScienceManifest;
      const [psr, gravity] = await Promise.all([
        fetch(url(manifest.layers.psr.file)).then((r) => { if (!r.ok) throw new Error(`psr: HTTP ${r.status}`); return r.arrayBuffer(); }),
        fetch(url(manifest.layers.gravity.file)).then((r) => { if (!r.ok) throw new Error(`gravity: HTTP ${r.status}`); return r.arrayBuffer(); }),
      ]);
      useScience.setState({ layers: decodeScienceLayers(manifest, psr, gravity), status: 'ready' });
    } catch (err) {
      console.warn('Science layers unavailable; the score uses terrain-derived criteria only.', err);
      useScience.setState({ layers: null, status: 'missing' });
    }
  })();
}
