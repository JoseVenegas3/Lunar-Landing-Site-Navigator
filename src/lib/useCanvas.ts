import { DependencyList, RefObject, useEffect, useRef } from 'react';
import { useApp } from '../state/store';

export interface CanvasLayers {
  /** Expensive layer: redrawn only when the inputs or the size change, then cached. */
  base: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  /** Cheap layer: redrawn whenever the shared time cursor moves. */
  overlay: (ctx: CanvasRenderingContext2D, width: number, height: number, cursorHours: number) => void;
}

/**
 * High-DPI 2-D canvas with a cached base layer and a live overlay. The time
 * cursor is read straight from the store inside a requestAnimationFrame loop,
 * so playback neither re-renders React nor repaints the expensive layer.
 * Call `invalidate.current()` to repaint the overlay (for example on hover).
 */
export function useCanvas(layers: CanvasLayers, deps: DependencyList): {
  ref: RefObject<HTMLCanvasElement | null>;
  invalidate: RefObject<() => void>;
} {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const baseDirty = useRef(true);
  const overlayDirty = useRef(true);
  const invalidate = useRef(() => { overlayDirty.current = true; });
  const layersRef = useRef(layers);
  layersRef.current = layers;

  useEffect(() => { baseDirty.current = true; }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cache = document.createElement('canvas');
    const cacheCtx = cache.getContext('2d');
    if (!ctx || !cacheCtx) return;
    let raf = 0;
    let lastCursor = NaN;
    let w = 0, h = 0, dpr = 1;

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      canvas.width = cache.width = Math.round(w * dpr);
      canvas.height = cache.height = Math.round(h * dpr);
      baseDirty.current = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const loop = (): void => {
      const cursor = useApp.getState().cursorHours;
      if (baseDirty.current) {
        baseDirty.current = false;
        overlayDirty.current = true;
        cacheCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        layersRef.current.base(cacheCtx, w, h);
      }
      if (overlayDirty.current || cursor !== lastCursor) {
        overlayDirty.current = false;
        lastCursor = cursor;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(cache, 0, 0);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        layersRef.current.overlay(ctx, w, h, cursor);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return { ref, invalidate };
}

export const FONT_MONO = '"JetBrains Mono", ui-monospace, monospace';
export const FONT_UI = '"B612", system-ui, sans-serif';

export const C = {
  bg: '#06080D',
  panel: '#0D111A',
  line: '#1E293B',
  lineSoft: '#141C2B',
  text: '#C9D4E3',
  dim: '#7385A0',
  faint: '#465672',
  rf: '#06B6D4',
  sun: '#F59E0B',
  crit: '#EF4444',
  ops: '#10B981',
  rock: '#94A3B8',
};
