/** Node loader of the offline terrain and science layers, for the tutorial scenario finder and its unit test. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DemManifest, DemStack, ScienceLayers, ScienceManifest, decodeGrid, decodeScienceLayers, latLonToXY } from '../src/engine';

const buf = (path: string): ArrayBuffer => {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

export interface OfflineData {
  sites: { siteId: string; latDeg: number; lonDeg: number; name: string; dem: DemStack }[];
  layers: ScienceLayers;
}

export function loadOffline(root = process.cwd()): OfflineData {
  const dir = join(root, 'public', 'dem');
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as DemManifest;
  const regional = decodeGrid(buf(join(dir, manifest.regional.file)), manifest.regional);
  const sites = manifest.sites.map((s) => {
    const [cx, cy] = latLonToXY(s.latDeg, s.lonDeg);
    const local = decodeGrid(buf(join(dir, s.file)), s, cx, cy);
    return { siteId: s.id, name: s.name, latDeg: s.latDeg, lonDeg: s.lonDeg, dem: { regional, local } };
  });
  const sdir = join(root, 'public', 'science');
  const sm = JSON.parse(readFileSync(join(sdir, 'layers.json'), 'utf8')) as ScienceManifest;
  const layers = decodeScienceLayers(sm, buf(join(sdir, sm.layers.psr.file)), buf(join(sdir, sm.layers.gravity.file)));
  return { sites, layers };
}
