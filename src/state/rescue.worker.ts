/**
 * Web Worker of the one-click rescue (v3.1, R6): the 25-point and calendar
 * search runs here, off the main thread, so the 3-D view keeps its frame
 * rate. Progress is posted at most every 100 ms.
 */
import { runRescue } from '../engine/rescue';
import type { RescueRequest, RescueReply } from './rescueProtocol';

const ctx = self as unknown as { onmessage: ((e: MessageEvent<RescueRequest>) => void) | null; postMessage: (m: RescueReply) => void };

ctx.onmessage = (e) => {
  const { id, dem, input, horizon, before, options } = e.data;
  let last = 0;
  try {
    const result = runRescue(dem, input, horizon, before, options, (p) => {
      const now = performance.now();
      if (now - last > 100) { last = now; ctx.postMessage({ id, kind: 'progress', progress: p }); }
    });
    ctx.postMessage({ id, kind: 'done', result });
  } catch (err) {
    ctx.postMessage({ id, kind: 'error', message: String(err) });
  }
};
