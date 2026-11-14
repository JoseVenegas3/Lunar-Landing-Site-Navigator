/**
 * Lunar terrain tile: a height-field mesh shaded with a Lommel-Seeliger /
 * Lambert blend and a hard shadow mask. There is no atmosphere, so there is no
 * sky light: shadowed ground receives only a faint earthshine term and is kept
 * readable with elevation contours.
 *
 * The shadow mask is produced on the CPU by the engine's O(N) sweep and uploaded
 * as a texture whenever the Sun moves, which keeps the fragment shader trivial.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute, BufferGeometry, DataTexture, LinearFilter, LineBasicMaterial, LineLoop, RedFormat, RGBAFormat,
  ShaderMaterial, UnsignedByteType, Vector3,
} from 'three';
import {
  DEG, Grid, MissionResult, RAD, accumulateVisible, azElAt, azimuthToMap, decimateGrid, farHorizonAt, farHorizonDistAt, farPlaneBase,
  litFractionBytes, makeSweepContext, siteFrame, sweepShadowCeiling,
} from '../../engine';
import { OverlayKind } from '../../state/store';
import { LiveSky, SceneFrame, useSceneUi } from './sceneMath';

const MESH_STRIDE = 2;

const VERTEX = /* glsl */ `
  attribute float aHeight;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying float vHeight;
  void main() {
    vUv = uv;
    vNormalW = normal;
    vPosW = position;
    vHeight = aHeight;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uShadow;
  uniform sampler2D uOverlay;
  uniform float uOverlayMix;
  uniform vec3 uSunDir;
  uniform float uContourM;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying float vHeight;

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vPosW);
    float lit = texture2D(uShadow, vUv).r;
    float mu0 = max(dot(n, uSunDir), 0.0);
    float mu = max(dot(n, v), 0.0);
    // Lunar regolith is strongly backscattering: blend Lambert with Lommel-Seeliger.
    // The Lambert share carries the relief (it follows the incidence angle), the
    // Lommel-Seeliger share keeps grazing-lit plains from going black.
    float ls = 2.0 * mu0 / (mu0 + mu + 1e-3);
    float refl = mix(mu0 * 2.2, ls, 0.3) * lit;
    float slope = 1.0 - n.y;
    vec3 albedo = vec3(0.60, 0.585, 0.56) * (0.86 + 0.6 * slope);
    // Filmic shoulder: grazing-lit plains stay mid-grey, Sun-facing slopes do not clip.
    float l = refl * 1.9;
    l = 1.3 * l / (1.0 + l);
    vec3 col = albedo * l;
    // Earthshine and light scattered from sunlit slopes: a few thousandths of direct sunlight.
    col += vec3(0.010, 0.014, 0.022) * (0.4 + 0.6 * n.y);

    // Elevation contours keep the relief legible inside shadow.
    float hc = vHeight * 1000.0 / uContourM;
    float line = 1.0 - min(abs(fract(hc - 0.5) - 0.5) / fwidth(hc), 1.0);
    float major = 1.0 - min(abs(fract(hc / 5.0 - 0.5) - 0.5) / fwidth(hc / 5.0), 1.0);
    float dark = 1.0 - smoothstep(0.0, 0.25, l);
    col = mix(col, vec3(0.16, 0.26, 0.38), max(line * 0.30, major * 0.62) * (0.28 + 0.72 * dark));

    vec4 ov = texture2D(uOverlay, vUv);
    col = mix(col, ov.rgb * (0.55 + 0.45 * l) + ov.rgb * 0.25, uOverlayMix * ov.a * 0.86);

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

function buildGeometry(grid: Grid, f: SceneFrame): BufferGeometry {
  const n = grid.n;
  const m = Math.floor((n - 1) / MESH_STRIDE) + 1;
  const pos = new Float32Array(m * m * 3);
  const nor = new Float32Array(m * m * 3);
  const uv = new Float32Array(m * m * 2);
  const hgt = new Float32Array(m * m);
  const d = grid.data, sp = grid.spacingKm;
  for (let b = 0; b < m; b++) {
    const j = b * MESH_STRIDE;
    for (let a = 0; a < m; a++) {
      const i = a * MESH_STRIDE;
      const k = b * m + a;
      const h = d[j * n + i];
      pos[k * 3] = grid.x0 + i * sp - f.cx;
      pos[k * 3 + 1] = h - f.h0;
      pos[k * 3 + 2] = -(grid.y0 + j * sp - f.cy);
      // Normal from full-resolution central differences (map frame -> scene frame).
      const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(n - 1, j + 1);
      const gx = (d[j * n + i1] - d[j * n + i0]) / ((i1 - i0) * sp);
      const gy = (d[j1 * n + i] - d[j0 * n + i]) / ((j1 - j0) * sp);
      const inv = 1 / Math.hypot(gx, gy, 1);
      nor[k * 3] = -gx * inv;
      nor[k * 3 + 1] = inv;
      nor[k * 3 + 2] = gy * inv;
      uv[k * 2] = i / (n - 1);
      uv[k * 2 + 1] = j / (n - 1);
      hgt[k] = h;
    }
  }
  const idx = new Uint32Array((m - 1) * (m - 1) * 6);
  let t = 0;
  for (let b = 0; b < m - 1; b++) {
    for (let a = 0; a < m - 1; a++) {
      const p = b * m + a, q = p + 1, r = p + m, s = r + 1;
      idx[t++] = p; idx[t++] = q; idx[t++] = r;
      idx[t++] = q; idx[t++] = s; idx[t++] = r;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setAttribute('aHeight', new BufferAttribute(hgt, 1));
  g.setIndex(new BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

/** Outline following the four edges of the tile. */
function buildFrame(grid: Grid, f: SceneFrame): BufferGeometry {
  const n = grid.n, sp = grid.spacingKm, d = grid.data;
  const pts: number[] = [];
  const push = (i: number, j: number): void => {
    pts.push(grid.x0 + i * sp - f.cx, d[j * n + i] - f.h0 + 0.004, -(grid.y0 + j * sp - f.cy));
  };
  for (let i = 0; i < n; i += 4) push(i, 0);
  for (let j = 0; j < n; j += 4) push(n - 1, j);
  for (let i = n - 1; i >= 0; i -= 4) push(i, n - 1);
  for (let j = n - 1; j >= 0; j -= 4) push(0, j);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
  return g;
}

/** Perceptual ramps for the coverage overlays; t in 0..1. */
function ramp(kind: OverlayKind, t: number, out: Uint8Array, k: number): void {
  const stops = kind === 'insolation'
    ? [[20, 8, 40], [120, 28, 60], [222, 96, 30], [245, 158, 11], [255, 240, 170]]
    : [[10, 16, 44], [14, 60, 110], [0, 150, 190], [0, 240, 255], [220, 255, 255]];
  const x = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(x), u = x - i;
  out[k] = stops[i][0] + (stops[i + 1][0] - stops[i][0]) * u;
  out[k + 1] = stops[i][1] + (stops[i + 1][1] - stops[i][1]) * u;
  out[k + 2] = stops[i][2] + (stops[i + 1][2] - stops[i][2]) * u;
  out[k + 3] = 255;
}

/** Slope classes for landing: emerald up to 5 deg, then amber, red from 15 deg, dark red from 25 deg. */
export const SLOPE_STOPS: [number, [number, number, number]][] = [
  [0, [16, 185, 129]], [5, [132, 204, 22]], [10, [245, 158, 11]], [15, [239, 68, 68]], [25, [127, 29, 29]],
];
function slopeRamp(deg: number, out: Uint8Array, k: number): void {
  let i = 0;
  while (i < SLOPE_STOPS.length - 2 && deg > SLOPE_STOPS[i + 1][0]) i++;
  const [d0, c0] = SLOPE_STOPS[i], [d1, c1] = SLOPE_STOPS[i + 1];
  const u = Math.max(0, Math.min(1, (deg - d0) / (d1 - d0)));
  out[k] = c0[0] + (c1[0] - c0[0]) * u;
  out[k + 1] = c0[1] + (c1[1] - c0[1]) * u;
  out[k + 2] = c0[2] + (c1[2] - c0[2]) * u;
  out[k + 3] = 255;
}

interface TerrainProps {
  grid: Grid;
  frame: SceneFrame;
  result: MissionResult;
  live: LiveSky;
  overlay: OverlayKind;
}

export function Terrain({ grid, frame, result, live, overlay }: TerrainProps) {
  // Shadows and coverage maps are swept at the mesh resolution (64 m): a quarter
  // of the cells of the full grid, which keeps the per-frame sweep near 2 ms.
  const sweepGrid = useMemo(() => decimateGrid(grid, MESH_STRIDE), [grid]);
  const n = sweepGrid.n;
  const geometry = useMemo(() => buildGeometry(grid, frame), [grid, frame]);
  const frameLine = useMemo(() => {
    const line = new LineLoop(buildFrame(grid, frame), new LineBasicMaterial({ color: 0x2b3a52 }));
    line.frustumCulled = false;
    return line;
  }, [grid, frame]);
  const ctx = useMemo(() => makeSweepContext(sweepGrid), [sweepGrid]);
  const buffers = useMemo(() => ({
    hi: new Float32Array(n * n), lo: new Float32Array(n * n), bytes: new Uint8Array(n * n),
  }), [n]);

  const shadowTex = useMemo(() => {
    const t = new DataTexture(buffers.bytes, n, n, RedFormat, UnsignedByteType);
    t.minFilter = LinearFilter;
    t.magFilter = LinearFilter;
    t.needsUpdate = true;
    return t;
  }, [buffers, n]);
  const overlayTex = useMemo(() => {
    const t = new DataTexture(new Uint8Array(n * n * 4), n, n, RGBAFormat, UnsignedByteType);
    t.minFilter = LinearFilter;
    t.magFilter = LinearFilter;
    t.needsUpdate = true;
    return t;
  }, [n]);

  const material = useMemo(() => new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uShadow: { value: shadowTex },
      uOverlay: { value: overlayTex },
      uOverlayMix: { value: 0 },
      uSunDir: { value: new Vector3(1, 0, 0) },
      uContourM: { value: 50 },
    },
  }), [shadowTex, overlayTex]);

  useEffect(() => () => { geometry.dispose(); }, [geometry]);
  useEffect(() => () => { frameLine.geometry.dispose(); }, [frameLine]);
  useEffect(() => () => { shadowTex.dispose(); }, [shadowTex]);
  useEffect(() => () => { overlayTex.dispose(); }, [overlayTex]);
  useEffect(() => () => { material.dispose(); }, [material]);

  // ---- hard shadows, re-swept when the Sun or the lander moves
  const last = useRef({ az: NaN, el: NaN, result: null as MissionResult | null });
  useFrame(() => {
    if (!live.valid) return;
    (material.uniforms.uSunDir.value as Vector3).copy(live.sunDir);
    const l = last.current;
    if (l.result === result && Math.abs(l.az - live.sunAz) < 0.02 && Math.abs(l.el - live.sunEl) < 0.004) return;
    l.result = result; l.az = live.sunAz; l.el = live.sunEl;
    const obs = result.observer;
    const [dirX, dirY] = azimuthToMap(obs.lonDeg, live.sunAz);
    const farTan = Math.tan(farHorizonAt(result.horizon, live.sunAz) * DEG);
    const farDist = farHorizonDistAt(result.horizon, live.sunAz);
    const tanUp = Math.tan((live.sunEl + live.sunRadius) * DEG);
    const tanLo = Math.tan((live.sunEl - live.sunRadius) * DEG);
    sweepShadowCeiling(ctx, { dirX, dirY, tanEl: tanUp, farBase: farPlaneBase(obs.heightKm, farTan, farDist, tanUp), originX: obs.x, originY: obs.y }, buffers.hi);
    sweepShadowCeiling(ctx, { dirX, dirY, tanEl: tanLo, farBase: farPlaneBase(obs.heightKm, farTan, farDist, tanLo), originX: obs.x, originY: obs.y }, buffers.lo);
    litFractionBytes(ctx, buffers.hi, buffers.lo, buffers.bytes);
    shadowTex.needsUpdate = true;
  });

  // ---- cumulative coverage overlay (time-sliced, cancellable)
  useEffect(() => {
    material.uniforms.uOverlayMix.value = 0;
    if (overlay === 'none') {
      useSceneUi.getState().set({ overlayProgress: null });
      return;
    }
    if (overlay === 'slope') {
      // Static: the slope of each cell of the 64 m mesh from central differences.
      const g = sweepGrid, m = g.n, d = g.data, two = 2 * g.spacingKm;
      const px = overlayTex.image.data as Uint8Array;
      for (let j = 0; j < m; j++) {
        for (let i = 0; i < m; i++) {
          const ix0 = Math.max(0, i - 1), ix1 = Math.min(m - 1, i + 1), iy0 = Math.max(0, j - 1), iy1 = Math.min(m - 1, j + 1);
          const gx = (d[j * m + ix1] - d[j * m + ix0]) / (((ix1 - ix0) / 2) * two);
          const gy = (d[iy1 * m + i] - d[iy0 * m + i]) / (((iy1 - iy0) / 2) * two);
          slopeRamp(Math.atan(Math.hypot(gx, gy)) * RAD, px, (j * m + i) * 4);
        }
      }
      overlayTex.needsUpdate = true;
      material.uniforms.uOverlayMix.value = 1;
      useSceneUi.getState().set({ overlayProgress: null });
      return;
    }
    let cancelled = false;
    const start = setTimeout(() => {
      const obs = result.observer;
      const sf = siteFrame(obs.latDeg, obs.lonDeg, obs.heightKm);
      const stride = Math.max(1, Math.ceil(result.count / 180));
      const acc = new Float32Array(n * n);
      const ceil = new Float32Array(n * n);
      const margin = result.input.rf.elevationMarginDeg;
      let i = 0, used = 0;
      const tick = (): void => {
        if (cancelled) return;
        const t0 = performance.now();
        while (i < result.count && performance.now() - t0 < 9) {
          const body = azElAt(result.eph, i, sf, overlay === 'insolation' ? 'sun' : 'earth');
          const el = overlay === 'insolation' ? body.elDeg : body.elDeg - margin;
          const [dirX, dirY] = azimuthToMap(obs.lonDeg, body.azDeg);
          const tanEl = Math.tan(el * DEG);
          const farBase = farPlaneBase(obs.heightKm, Math.tan(farHorizonAt(result.horizon, body.azDeg) * DEG), farHorizonDistAt(result.horizon, body.azDeg), tanEl);
          sweepShadowCeiling(ctx, { dirX, dirY, tanEl, farBase, originX: obs.x, originY: obs.y }, ceil);
          accumulateVisible(ctx, ceil, acc);
          used++;
          i += stride;
        }
        if (i < result.count) {
          useSceneUi.getState().set({ overlayProgress: i / result.count });
          setTimeout(tick, 0);
          return;
        }
        const px = overlayTex.image.data as Uint8Array;
        for (let k = 0; k < acc.length; k++) ramp(overlay, acc[k] / used, px, k * 4);
        overlayTex.needsUpdate = true;
        material.uniforms.uOverlayMix.value = 1;
        useSceneUi.getState().set({ overlayProgress: null });
      };
      useSceneUi.getState().set({ overlayProgress: 0 });
      tick();
    }, 260); // debounce: the lander may still be dragged
    return () => {
      cancelled = true;
      clearTimeout(start);
    };
  }, [overlay, result, ctx, n, overlayTex, material, sweepGrid]);

  return (
    <group>
      <mesh name="terrain" geometry={geometry} material={material} frustumCulled={false} />
      <primitive object={frameLine} />
    </group>
  );
}
