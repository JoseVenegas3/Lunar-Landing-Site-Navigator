import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

const LOLA_BASE = 'https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/';
const LOLA_FILES = new Set(['LDEM_80S_20MPP_ADJ.TIF']);

/**
 * Same-origin range proxy for the LOLA cloud-optimised GeoTIFF. The PGDA server
 * sends no CORS headers, so the browser reads /lola-cog/<file> and this
 * middleware forwards the byte range. Requests without a Range header are
 * refused: the file is 2.7 GB.
 */
function lolaProxy(): Plugin {
  const handle = (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const url = req.url ?? '';
    const at = url.indexOf('/lola-cog/');
    if (at < 0) { next(); return; }
    const name = url.slice(at + '/lola-cog/'.length).split('?')[0];
    const range = req.headers.range;
    if (!LOLA_FILES.has(name)) { res.statusCode = 404; res.end(); return; }
    if (req.method !== 'HEAD' && !range) { res.statusCode = 416; res.end('Range header required'); return; }
    void (async () => {
      try {
        const up = await fetch(LOLA_BASE + name, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers: range ? { Range: range } : {} });
        res.statusCode = up.status;
        for (const h of ['content-type', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
          const v = up.headers.get(h);
          if (v) res.setHeader(h, v);
        }
        res.setHeader('cache-control', 'public, max-age=86400');
        if (req.method === 'HEAD') {
          const len = up.headers.get('content-length');
          if (len) res.setHeader('content-length', len);
          res.end();
          return;
        }
        res.end(Buffer.from(await up.arrayBuffer()));
      } catch {
        res.statusCode = 502;
        res.end('LOLA source unreachable');
      }
    })();
  };
  return {
    name: 'lola-cog-proxy',
    configureServer(server) { server.middlewares.use(handle); },
    configurePreviewServer(server) { server.middlewares.use(handle); },
  };
}

export default defineConfig({
  plugins: [react(), lolaProxy()],
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  preview: { port: 4173, strictPort: true, host: '127.0.0.1' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
  test: { environment: 'node', include: ['src/**/*.test.ts'], testTimeout: 60000 },
});
