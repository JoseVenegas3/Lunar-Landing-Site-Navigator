// Pitch deck controller and 3-D scenes (three.js). Runs offline: npm run pitch-deck
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './style.css';
import moonColorUrl from './assets/moon-color.jpg';
import moonReliefUrl from './assets/moon-relief.jpg';
import {
  ACESFilmicToneMapping, AdditiveBlending, AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, ConeGeometry,
  CylinderGeometry, DirectionalLight, DodecahedronGeometry, DoubleSide, Group, HemisphereLight, LatheGeometry, Line, LineDashedMaterial,
  MathUtils, Mesh, MeshBasicMaterial, MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, Points, PointsMaterial,
  Quaternion, RepeatWrapping, RingGeometry, SRGBColorSpace, Scene, SphereGeometry, Sprite, SpriteMaterial, TextureLoader, Vector2, Vector3,
  WebGLRenderer,
} from 'three';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const k = (rate) => (reduced ? 1 : rate); // per-frame easing factor
const Y = new Vector3(0, 1, 0);

// ------------------------------------------------------------------ speaker script (honest figures, from the app)
const NOTES = [
  { act: 'Acto I · El gancho trágico · 0:00–0:25', dir: 'Tono grave y seguro. Mirada fija al jurado, sin mirar la pantalla todavía. Un clic por frase.',
    say: 'Febrero de 2024. La misión IM-1 Odysseus llega al Polo Sur de la Luna. Toca suelo, pero queda inclinada unos 30 grados: su antena deja de apuntar bien a la Tierra. En 2025, Athena terminó de costado en un pequeño cráter en sombra y su misión duró unas 13 horas. Llegar a la Luna ya no es el problema: el verdadero reto es sobrevivir en la superficie.' },
  { act: 'Acto II · La paradoja polar · 0:25–0:50', dir: 'Tono explicativo y riguroso. Señala cada cifra cuando aparece.',
    say: 'En el Polo Sur lunar las reglas de la Tierra no aplican: no hay atmósfera ni crepúsculo. El Sol nunca sube más de unos 2 grados sobre el horizonte, así que una montaña proyecta sombras de kilómetros. La Tierra no sale ni se pone: solo se mece por libración, baja sobre las crestas. Y el horizonte lunar cae casi cuatro veces más rápido que el terrestre. Todo esto lo calculamos sobre la topografía LOLA de la NASA, con efemérides contrastadas con JPL Horizons.' },
  { act: 'Acto III · La solución dual · 0:50–1:15', dir: 'Tono energético. Manos abiertas, mostrando accesibilidad.',
    say: 'Para resolverlo, en GISAT creamos Lunar Landing Site Navigator. ¿Cómo entregar una consola de ingeniería profesional sin dejar fuera a las escuelas y al público? Con una sola puerta, bilingüe y con unidades métricas o imperiales: un Modo Guiado de ocho misiones con insignias que enseña por qué moverse 200 metros lo cambia todo en la Luna, y la consola completa Mission Leader.' },
  { act: 'Acto IV · Física real (1/2) · 1:15–1:40', dir: 'Autoridad técnica, ritmo ágil. Apunta al módulo en pantalla en cada clic.',
    say: 'Las herramientas comunes asumen que la nave aterriza derecha y miden luz geométrica. Nosotros modelamos la actitud en seis grados de libertad: con la inclinación de IM-1, el enlace con la Tierra cae del 35 al 7 por ciento de la ventana. El cardán de la antena lo recupera. Y acoplamos energía y temperatura: calefactores a cero grados, batería perdida a menos veinte, y un mástil de 10 metros que saca los paneles de la sombra.' },
  { act: 'Acto IV · Física real (2/2) · 1:40–2:05', dir: 'Mismo ritmo. Sigue con la mano el camino de la señal.',
    say: 'Reemplazamos la línea de vista de sí o no por física de radio: la señal se difracta sobre hasta tres crestas y rebota en el regolito. La conectamos con la Red del Espacio Profundo de la NASA, con un satélite de relevo, y con una estación hipotética de GISAT de 3,7 metros aquí en Concepción.' },
  { act: 'Acto V · Clímax: demo de rescate · 2:05–2:35', dir: 'Emoción contenida, ritmo de cuenta regresiva. Un compañero puede hacer la demo en vivo en la app.',
    say: 'Veámoslo en acción. Emergencia: el módulo cae fuera de curso en una ladera en sombra cerca de Nobile. El sistema da un veredicto humano inmediato: no sobrevive tal como está, sale de su rango térmico en dos días y diecisiete horas. Pero no nos quedamos en el diagnóstico: evalúa 25 puntos de contacto y traza el vector de escape. Un clic, y la nave se mueve 250 metros al este. El indicador cambia a verde: sobrevive los 15 días con 13 por ciento de margen.' },
  { act: 'Acto VI · Cierre · 2:35–3:00', dir: 'Tono solemne y confiado. Postura firme, contacto visual con todo el jurado.',
    say: 'Esto no es una maqueta: es una aplicación terminada, con 175 pruebas unitarias y 159 comprobaciones en navegador, y que funciona sin conexión a internet. Lleva física de actitud, supervivencia criogénica y difracción de radio a un navegador web abierto, para misiones y para aulas. Porque en el Polo Sur lunar, 200 metros o unas pocas horas escriben la historia. Hoy, esa frontera está abierta para todos. Muchas gracias.' },
];

// ------------------------------------------------------------------ renderer
const canvas = document.getElementById('gl');
const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
const camera = new PerspectiveCamera(36, 1, 0.05, 2000);
const tex = new TextureLoader();

function stars() {
  const n = 2600, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u), r = 600;
    p.set([r * s * Math.cos(a), r * Math.abs(u) * 0.9 + 20, r * s * Math.sin(a)], i * 3);
  }
  const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(p, 3));
  return new Points(g, new PointsMaterial({ color: 0xdfe7f2, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0.85 }));
}

// value noise for the regolith
const h = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const vn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return MathUtils.lerp(MathUtils.lerp(h(xi, yi), h(xi + 1, yi), u), MathUtils.lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v); };
const fbm = (x, y) => { let a = 0, f = 1, w = 0.5; for (let i = 0; i < 5; i++) { a += w * vn(x * f, y * f); f *= 2; w *= 0.5; } return a; };
const CRATERS = [[-14, -10, 7], [16, -22, 10], [24, 14, 6], [-26, 18, 9], [6, 30, 5], [-40, -30, 14], [-9, -26, 5]];
function rawHeight(x, z) {
  let y = (fbm(x * 0.05 + 10, z * 0.05 + 3) - 0.5) * 7 + (fbm(x * 0.3, z * 0.3) - 0.5) * 0.6;
  for (const [cx, cz, r] of CRATERS) { const d = Math.hypot(x - cx, z - cz) / r; if (d < 1.25) y += d < 1 ? -2.2 * (1 - d * d) : 1.4 * (1.25 - d) * 4 * (d - 1); }
  return y;
}
const H0 = rawHeight(0, 0);
/** Terrain height; a level pad around the landing site so the legs sit on the ground. */
function heightAt(x, z) { return MathUtils.lerp(H0, rawHeight(x, z), MathUtils.smoothstep(Math.hypot(x, z), 2.6, 7)); }

// ------------------------------------------------------------------ surface scene
const surface = new Scene();
surface.background = new Color(0x05070b);
surface.add(stars());
// light: a grazing Sun from the east (+x); a cool sky fill and a rim so the lander always reads, even in shadow
const hemi = new HemisphereLight(0x8ea2c8, 0x2a2622, 0.55); surface.add(hemi);
const fill = new DirectionalLight(0xb4c6e6, 0.5); surface.add(fill, fill.target);
const rim = new DirectionalLight(0xa4bcff, 1.1); surface.add(rim, rim.target);
const sun = new DirectionalLight(0xfff1d6, 3.6);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 10, bottom: -10, near: 1, far: 150 });
surface.add(sun, sun.target);
const SUN_HI = MathUtils.degToRad(6.5), SUN_MID = MathUtils.degToRad(4), SUN_LO = MathUtils.degToRad(0.6);

const relief = tex.load(moonReliefUrl); relief.wrapS = relief.wrapT = RepeatWrapping; relief.repeat.set(6, 6);
const groundMat = new MeshStandardMaterial({ color: 0x9a9a98, roughness: 0.97, metalness: 0, bumpMap: relief, bumpScale: 2.5 });
{
  const g = new PlaneGeometry(220, 220, 260, 260); g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  g.computeVertexNormals();
  const ground = new Mesh(g, groundMat); ground.receiveShadow = true; surface.add(ground);
}
/** A ridge east of the site: it is what casts the shadow, and its sunlit crest is where the rescue goes. */
function makeRidge(xc, H, half, slope, len) {
  const w = (half + slope) * 2 + 2, g = new PlaneGeometry(w, len, 90, 120); g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + xc, z = p.getZ(i);
    const prof = (1 - MathUtils.smoothstep(Math.abs(x - xc), half, half + slope)) * (1 - MathUtils.smoothstep(Math.abs(z), len * 0.3, len * 0.5));
    const n = (fbm(x * 0.45, z * 0.45) - 0.5) * 2.2 * prof * (1 - prof) * 4;
    const g0 = heightAt(x, z); p.setXYZ(i, x, MathUtils.lerp(g0, Math.max(g0, H0 + H), prof) + n - 0.06, z);
  }
  g.computeVertexNormals();
  const m = new Mesh(g, groundMat); m.castShadow = m.receiveShadow = true; m.visible = false; surface.add(m);
  return m;
}
const ridgeFar = makeRidge(30, 3.2, 3, 6, 70);     // acts I and IV: the Sun sinks behind it
const RIDGE_X = 8, RIDGE_H = 3.8;
const ridgeNear = makeRidge(RIDGE_X, RIDGE_H, 1.8, 3.4, 50); // act V: shadow here, sunlight on the crest
const crestY = Math.max(heightAt(RIDGE_X, 0), H0 + RIDGE_H) - 0.06;

// the Earth, low over the horizon (polar sky), lit by the same Sun
function earthMap() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#1a4896'; g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#6f7f4f';
  for (let i = 0; i < 10; i++) { g.beginPath(); g.ellipse(h(i, 1) * 512, 60 + h(i, 2) * 136, 18 + h(i, 3) * 46, 10 + h(i, 4) * 28, h(i, 5) * 3, 0, 7); g.fill(); }
  g.fillStyle = 'rgba(255,255,255,0.6)';
  for (let i = 0; i < 90; i++) { g.beginPath(); g.ellipse(h(i, 7) * 512, h(i, 8) * 256, 8 + h(i, 9) * 34, 2 + h(i, 10) * 6, h(i, 11) * 0.6, 0, 7); g.fill(); }
  g.fillStyle = '#f2f6fb'; g.fillRect(0, 0, 512, 14); g.fillRect(0, 242, 512, 14);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; return t;
}
function haloMap() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 18, 64, 64, 64);
  r.addColorStop(0, 'rgba(110,170,255,0.55)'); r.addColorStop(1, 'rgba(110,170,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128); return new CanvasTexture(c);
}
const EARTH = new Vector3(0.25, 0.125, -0.96).normalize().multiplyScalar(170);
const earth = new Mesh(new SphereGeometry(4, 48, 32), new MeshStandardMaterial({ map: earthMap(), roughness: 0.7, emissive: 0x0b2150, emissiveIntensity: 0.9 }));
earth.position.copy(EARTH); earth.rotation.set(0.3, 2.2, 0); surface.add(earth);
const halo = new Sprite(new SpriteMaterial({ map: haloMap(), blending: AdditiveBlending, depthWrite: false, transparent: true }));
halo.scale.set(17, 17, 1); halo.position.copy(EARTH); surface.add(halo);

// ------------------------------------------------------------------ the lander: a CLPS-class spacecraft
const crinkle = tex.load(moonReliefUrl); crinkle.wrapS = crinkle.wrapT = RepeatWrapping; crinkle.repeat.set(1.4, 1.4);
const M = {
  foil: new MeshStandardMaterial({ color: 0xd8a443, metalness: 0.8, roughness: 0.36, bumpMap: crinkle, bumpScale: 1.6, emissive: 0x3a2400, emissiveIntensity: 0.45 }),
  white: new MeshStandardMaterial({ color: 0xe8ecf1, metalness: 0.1, roughness: 0.55 }),
  metal: new MeshStandardMaterial({ color: 0xb4bcc7, metalness: 0.75, roughness: 0.35 }),
  dark: new MeshStandardMaterial({ color: 0x30343b, metalness: 0.6, roughness: 0.45, side: DoubleSide }),
  cell: new MeshStandardMaterial({ color: 0x1a2c5c, metalness: 0.55, roughness: 0.22, emissive: 0x0a1838, emissiveIntensity: 0.7 }),
  dish: new MeshStandardMaterial({ color: 0xf2f4f7, metalness: 0.2, roughness: 0.4, side: DoubleSide }),
};
const YAW = 0.5;
const lander = new Group(); surface.add(lander);
const tiltG = new Group(); lander.add(tiltG);
const body = new Group(); body.rotation.y = YAW; tiltG.add(body);
const shade = (m) => { m.castShadow = m.receiveShadow = true; return m; };
const part = (geo, mat, x, y, z, parent = body) => { const m = shade(new Mesh(geo, mat)); m.position.set(x, y, z); parent.add(m); return m; };
function rod(a, b, r, mat, parent = body) {
  const d = new Vector3().subVectors(b, a), m = shade(new Mesh(new CylinderGeometry(r, r, d.length(), 8), mat));
  m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(Y, d.normalize()); parent.add(m); return m;
}
// hexagonal bus in gold MLI, decks, avionics
part(new CylinderGeometry(1.05, 1.05, 1.35, 6), M.foil, 0, 1.6, 0);
part(new CylinderGeometry(1.15, 1.15, 0.09, 6), M.white, 0, 2.31, 0);
part(new CylinderGeometry(1.02, 1.02, 0.1, 6), M.dark, 0, 0.9, 0);
for (const s of [1, -1]) part(new BoxGeometry(0.03, 0.95, 0.98), M.cell, s * 0.925, 1.62, 0);
part(new BoxGeometry(0.55, 0.32, 0.42), M.white, -0.35, 2.51, -0.15);
part(new BoxGeometry(0.32, 0.22, 0.3), M.metal, 0.25, 2.46, -0.5);
part(new CylinderGeometry(0.09, 0.09, 0.25, 12), M.metal, -0.55, 2.48, 0.45);
// engine bell
part(new LatheGeometry([new Vector2(0.17, 0), new Vector2(0.22, -0.12), new Vector2(0.37, -0.42), new Vector2(0.46, -0.6)], 28), M.dark, 0, 0.85, 0);
const plume = new Mesh(new ConeGeometry(0.42, 1.8, 24, 1, true), new MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
plume.position.y = 0.25 - 0.9; plume.rotation.x = Math.PI; body.add(plume);
// four legs with struts and pads
const PADS = [];
for (let i = 0; i < 4; i++) {
  const a = (i / 4) * Math.PI * 2 + Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
  const top = new Vector3(c * 1.0, 1.75, s * 1.0), pad = new Vector3(c * 1.95, 0.08, s * 1.95), knee = top.clone().lerp(pad, 0.55);
  rod(top, pad, 0.055, M.metal);
  for (const d of [-0.42, 0.42]) rod(new Vector3(Math.cos(a + d) * 0.98, 0.95, Math.sin(a + d) * 0.98), knee, 0.03, M.metal);
  part(new CylinderGeometry(0.3, 0.34, 0.07, 18), M.metal, pad.x, 0.035, pad.z);
  PADS.push(new Vector3(pad.x, 0, pad.z));
}
// extendable mast with its solar array (faces the Sun in the east)
const mastG = new Group(); mastG.position.set(-0.1, 2.36, 0.4); body.add(mastG);
const mastTube = part(new CylinderGeometry(0.045, 0.06, 1, 8).translate(0, 0.5, 0), M.metal, 0, 0, 0, mastG);
const arrayG = new Group(); arrayG.rotation.y = -YAW; mastG.add(arrayG);
part(new BoxGeometry(0.035, 0.95, 1.5), M.cell, 0, 0.45, 0, arrayG);
part(new BoxGeometry(0.05, 1.0, 0.05), M.white, 0, 0.45, 0.77, arrayG); part(new BoxGeometry(0.05, 1.0, 0.05), M.white, 0, 0.45, -0.77, arrayG);
// high-gain dish on a two-axis gimbal
const armBase = new Vector3(0.6, 2.36, -0.15), armTop = new Vector3(0.6, 2.95, -0.15);
rod(armBase, armTop, 0.04, M.metal);
const gimbal = new Group(); gimbal.position.copy(armTop); body.add(gimbal);
const dishPts = []; for (let i = 0; i <= 12; i++) { const r = (i / 12) * 0.52; dishPts.push(new Vector2(r, r * r * 0.55)); }
part(new LatheGeometry(dishPts, 36), M.dish, 0, 0, 0, gimbal);
rod(new Vector3(0, 0, 0), new Vector3(0, 0.34, 0), 0.015, M.metal, gimbal);
part(new SphereGeometry(0.04, 10, 8), M.metal, 0, 0.34, 0, gimbal);

// a boulder under one pad (act I: the touchdown that tipped it)
const TILT_AXIS = new Vector3(-1, 0, -1).normalize();
const qYaw = new Quaternion().setFromAxisAngle(Y, YAW), qTilt = new Quaternion();
function padsAt(rollDeg) {
  qTilt.setFromAxisAngle(TILT_AXIS, MathUtils.degToRad(rollDeg));
  let min = 0, hi = null;
  for (const p of PADS) { const v = p.clone().applyQuaternion(qYaw).applyQuaternion(qTilt); if (v.y < min) min = v.y; if (!hi || v.y > hi.y) hi = v; }
  return { lift: -min, hi };
}
const rockG = new DodecahedronGeometry(1, 1);
{ const p = rockG.getAttribute('position'); for (let i = 0; i < p.count; i++) { const f = 0.82 + h(p.getX(i) * 3.1, p.getY(i) * 2.7 + p.getZ(i)) * 0.3; p.setXYZ(i, p.getX(i) * f, p.getY(i) * f, p.getZ(i) * f); } rockG.computeVertexNormals(); }
const rock = shade(new Mesh(rockG, new MeshStandardMaterial({ color: 0x8d8b88, roughness: 0.95, bumpMap: relief, bumpScale: 1.5, flatShading: true })));
const ROCK = (() => { const { lift, hi } = padsAt(30); const top = hi.y + lift - 0.02; return { x: hi.x * 1.06, z: hi.z * 1.06, top, sy: top * 0.85 + 0.35 }; })();
rock.scale.set(0.95, ROCK.sy, 0.8); rock.position.set(ROCK.x, H0 - ROCK.sy, ROCK.z); rock.visible = false; surface.add(rock);

// the radio link: a thin beam with travelling pulses, a dashed line of sight to the Earth, a splash where it hits the ground
const TONE = { rf: new Color(0x4fd8ff), lost: new Color(0xff3b55), ok: new Color(0x19d37f) };
const beamCore = new Mesh(new CylinderGeometry(0.02, 0.02, 1, 8, 1, true).translate(0, 0.5, 0), new MeshBasicMaterial({ color: 0x4fd8ff, transparent: true, opacity: 0, depthWrite: false }));
const beamGlow = new Mesh(new CylinderGeometry(0.09, 0.09, 1, 12, 1, true).translate(0, 0.5, 0), new MeshBasicMaterial({ color: 0x4fd8ff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
surface.add(beamCore, beamGlow);
const pulses = Array.from({ length: 7 }, () => { const m = new Mesh(new SphereGeometry(0.075, 12, 8), new MeshBasicMaterial({ color: 0x4fd8ff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false })); surface.add(m); return m; });
const splash = new Mesh(new RingGeometry(0.3, 0.42, 40), new MeshBasicMaterial({ color: 0xff3b55, transparent: true, opacity: 0, side: DoubleSide, depthWrite: false, blending: AdditiveBlending }));
splash.rotation.x = -Math.PI / 2; surface.add(splash);
const losGeo = new BufferGeometry().setFromPoints([new Vector3(), new Vector3(0, 1, 0)]);
const los = new Line(losGeo, new LineDashedMaterial({ color: 0xeef2f7, dashSize: 0.45, gapSize: 0.35, transparent: true, opacity: 0, depthWrite: false }));
surface.add(los);
// act V: escape vector to the lit crest
const hopAt = (u) => new Vector3(RIDGE_X * u, MathUtils.lerp(H0, crestY, u) + Math.sin(Math.PI * u) * 3.2, 0);
const pathDots = Array.from({ length: 16 }, (_, i) => { const m = new Mesh(new SphereGeometry(0.09, 10, 8), new MeshBasicMaterial({ color: 0x19d37f, transparent: true, opacity: 0, depthWrite: false })); m.position.copy(hopAt((i + 1) / 17)).add(new Vector3(0, 1.2, 0)); surface.add(m); return m; });
const target = new Mesh(new RingGeometry(1.7, 1.95, 64), new MeshBasicMaterial({ color: 0x19d37f, transparent: true, opacity: 0, side: DoubleSide, depthWrite: false }));
target.rotation.x = -Math.PI / 2; target.position.set(RIDGE_X, crestY + 0.06, 0); surface.add(target);
const dust = new Mesh(new RingGeometry(0.8, 1, 48), new MeshBasicMaterial({ color: 0xcbbfa8, transparent: true, opacity: 0, side: DoubleSide, depthWrite: false }));
dust.rotation.x = -Math.PI / 2; surface.add(dust);

// ------------------------------------------------------------------ globe scene: the real Moon (LRO maps, NASA SVS)
const globe = new Scene();
globe.background = new Color(0x05070b);
globe.add(stars());
globe.add(new AmbientLight(0x2a3242, 0.25));
const gsun = new DirectionalLight(0xfff4e0, 2.4); globe.add(gsun);
const moonMat = new MeshStandardMaterial({ roughness: 1, metalness: 0 });
tex.load(moonColorUrl, (t) => { t.colorSpace = SRGBColorSpace; t.anisotropy = 8; moonMat.map = t; moonMat.needsUpdate = true; });
tex.load(moonReliefUrl, (t) => { moonMat.bumpMap = t; moonMat.bumpScale = 5; moonMat.needsUpdate = true; });
const tilt = new Group(); globe.add(tilt);
const SPIN = { y: 0.6 };
const moon = new Mesh(new SphereGeometry(1, 160, 120), moonMat); tilt.add(moon);
const gearth = new Mesh(new SphereGeometry(0.27, 48, 32), new MeshStandardMaterial({ color: 0x2f6fd8, emissive: 0x0b2350, roughness: 0.6 }));
globe.add(gearth);

// ------------------------------------------------------------------ state, eased every frame
const SCAL = ['roll', 'gimbal', 'mast', 'sunEl', 'beam', 'rock', 'vo', 'path', 'gTilt', 'gDist', 'gEarth'];
const S = { landerY: 0, roll: 0, gimbal: 0, mast: 0, sunEl: SUN_HI, beam: 0, rock: 0, vo: 0.2, path: 0,
  cam: new Vector3(0.6, 3, 11.5), look: new Vector3(0, 2, 0), gTilt: 0, gDist: 3.4, gEarth: 0 };
const T = { ...S, cam: S.cam.clone(), look: S.look.clone(), tone: 'rf' };
let scene = 'surface', slideIdx = 0, step = 0, hopT0 = 0;
const ANCH = {};

/** Scene targets per slide and step. */
function direct(si, st) {
  Object.assign(T, { roll: 0, gimbal: 0, mast: 0, sunEl: SUN_HI, beam: 0, rock: 0, vo: 0.2, path: 0, tone: 'rf' });
  if (si === 0) {
    T.roll = 30; T.rock = 1; S.rock = 1;
    T.cam.set(0.8, 4.2, 16); T.look.set(0, 1.7, 0);
    if (st === 0) S.landerY = 14;
    if (st >= 1) { T.beam = 1; T.tone = 'lost'; }
    if (st >= 2) T.sunEl = SUN_LO;
    if (st >= 3) { T.cam.set(1.8, 6.5, 26); T.look.set(0.6, 2.8, 0); }
  } else if (si === 3) {
    T.cam.set(0.6, 4.0, 15); T.look.set(0, 1.8, 0); T.beam = 1;
    if (st >= 1) { T.roll = 30; T.rock = 1; T.tone = 'lost'; }
    if (st >= 2) { T.gimbal = 1; T.tone = 'ok'; }
    if (st >= 3) { T.mast = 1; T.sunEl = SUN_LO; T.cam.set(2.4, 6.2, 27); T.look.set(0.9, 4.4, 0); }
  } else if (si === 5) {
    T.vo = 0.2; T.sunEl = SUN_MID; T.cam.set(0.5, 10, 27); T.look.set(4.4, 2.2, 0);
    if (st >= 2) T.path = 1;
  } else if (si === 1) {
    T.gTilt = st >= 1 ? 0.55 : 0.15; T.gDist = st >= 1 ? 3.3 : 4.0; T.gEarth = st >= 2 ? 1 : 0;
  } else if (si === 6) {
    T.gTilt = 0.35; T.gDist = 2.9; T.gEarth = 1;
  }
  ridgeFar.visible = si === 0 || si === 3; ridgeNear.visible = si === 5; rock.visible = si === 0 || si === 3;
  if (si === 5 && st >= 3) { if (!hopT0) hopT0 = performance.now(); } else hopT0 = 0;
}
/** Jump straight to the targets (after a scene change behind the veil). */
function snap() { for (const key of SCAL) S[key] = T[key]; S.cam.copy(T.cam); S.look.copy(T.look); }

const v3 = () => new Vector3();
const tmpQ = new Quaternion();
function surfaceFrame(t) {
  S.landerY += (0 - S.landerY) * k(0.03);
  for (const key of ['roll', 'gimbal', 'mast', 'sunEl', 'beam', 'rock', 'vo', 'path']) S[key] += (T[key] - S[key]) * k(0.045);
  S.cam.lerp(T.cam, k(0.03)); S.look.lerp(T.look, k(0.045));

  // pose: tipping onto the boulder during touchdown (act I), or the 6-DOF tilt preset (act IV)
  const roll = slideIdx === 0 ? 30 * (1 - MathUtils.smoothstep(S.landerY, 0, 2.2)) : S.roll;
  const { lift } = padsAt(roll);
  tiltG.quaternion.copy(qTilt);
  const hop = slideIdx === 5 && hopT0 ? MathUtils.smootherstep((t - hopT0) / 2600, 0, 1) : 0;
  const base = slideIdx === 5 ? hopAt(hop) : new Vector3(0, H0, 0);
  lander.position.set(base.x, base.y + lift + S.landerY, base.z);
  rock.position.y = H0 + ROCK.top * S.rock - ROCK.sy;
  mastTube.scale.y = 0.55 + S.mast * 5.6; arrayG.position.y = mastTube.scale.y;
  lander.updateMatrixWorld(true);

  // dish: body-fixed boresight (aimed at the Earth when level), or the gimbal bringing it back to the Earth
  const dishPos = gimbal.getWorldPosition(v3());
  const toEarth = EARTH.clone().sub(dishPos).normalize();
  const levelDir = EARTH.clone().sub(new Vector3(lander.position.x, lander.position.y - lift + 2.95, 0)).normalize();
  const bore = levelDir.applyQuaternion(qTilt);
  const dir = bore.lerp(toEarth, S.gimbal).normalize();
  gimbal.quaternion.copy(body.getWorldQuaternion(tmpQ).invert().multiply(new Quaternion().setFromUnitVectors(Y, dir)));
  const o = dishPos.clone().addScaledVector(dir, 0.2);
  let end = null;
  for (let s = 0.5; s < 45; s += 0.2) { const p = o.clone().addScaledVector(dir, s); if (p.y < heightAt(p.x, p.z)) { end = p; break; } }
  const hit = !!end; if (!end) end = EARTH.clone().addScaledVector(dir, -4);
  const len = o.distanceTo(end), col = hit ? TONE.lost : TONE[T.tone];
  for (const m of [beamCore, beamGlow]) { m.position.copy(o); m.quaternion.setFromUnitVectors(Y, dir); m.scale.set(1, len, 1); m.material.color.lerp(col, k(0.08)); }
  beamCore.material.opacity = 0.95 * S.beam; beamGlow.material.opacity = 0.22 * S.beam;
  const run = Math.min(len, 26);
  pulses.forEach((m, i) => {
    const d = ((t * 0.006 + (i * run) / pulses.length) % run);
    m.position.copy(o).addScaledVector(dir, d); m.material.color.copy(beamCore.material.color);
    m.material.opacity = S.beam * (hit ? 1 : 1 - d / run) * 0.9;
  });
  const sp = (t % 1100) / 1100;
  splash.position.copy(end).setY(heightAt(end.x, end.z) + 0.04); splash.scale.setScalar(1 + sp * 3.5);
  splash.material.opacity = hit ? S.beam * (1 - sp) * 0.9 : 0;
  const lp = losGeo.getAttribute('position'); lp.setXYZ(0, o.x, o.y, o.z); lp.setXYZ(1, EARTH.x, EARTH.y, EARTH.z); lp.needsUpdate = true;
  los.computeLineDistances(); los.material.opacity = hit ? 0.5 * S.beam : 0;

  // descent plume and touchdown dust
  plume.material.opacity = MathUtils.clamp((S.landerY - 0.15) / 2.5, 0, 1) * (0.55 + (reduced ? 0 : 0.12 * Math.sin(t * 0.05)));
  if (slideIdx === 0 && step === 0 && S.landerY < 0.05 && !dust.userData.done) { dust.userData.done = true; dust.userData.t0 = t; }
  if (slideIdx === 5 && hop > 0.985 && !dust.userData.hopDone) { dust.userData.hopDone = true; dust.userData.t0 = t; }
  if (dust.userData.t0) { const a = (t - dust.userData.t0) / 1700; dust.material.opacity = a < 1 ? 0.6 * (1 - a) : 0; dust.scale.setScalar(1.6 + a * 6); dust.position.set(base.x, base.y + 0.05, 0); }
  else dust.material.opacity = 0;

  // escape vector
  pathDots.forEach((m, i) => { m.material.opacity = MathUtils.clamp(S.path * 18 - i, 0, 1) * 0.9 * (1 - hop); });
  target.material.opacity = S.path * (0.55 + 0.35 * Math.sin(t * 0.004)) * (1 - hop);

  // lights follow the lander; the Sun grazes from the east
  const L = lander.position;
  sun.position.set(L.x + Math.cos(S.sunEl) * 70, L.y + Math.sin(S.sunEl) * 70, L.z + 10); sun.target.position.copy(L);
  fill.position.set(L.x - 6, L.y + 8, L.z + 14); fill.target.position.copy(L);
  rim.position.set(L.x - 8, L.y + 6, L.z - 14); rim.target.position.copy(L);

  // camera: framed so the lander sits in the open right side of the slide
  camera.position.copy(S.cam).add(new Vector3(0, S.landerY * 0.3, 0));
  camera.lookAt(S.look.clone().add(new Vector3(0, S.landerY * 0.6, 0)));
  camera.setViewOffset(innerWidth, innerHeight, -S.vo * innerWidth, 0, innerWidth, innerHeight);

  ANCH.lander = tiltG.localToWorld(new Vector3(1.0, 1.7, 1.0));
  ANCH.dish = dishPos; ANCH.hit = end; ANCH.earth = EARTH.clone().add(new Vector3(-4.5, 0, 0));
  ANCH.array = arrayG.localToWorld(new Vector3(0, 0.9, 0.8)); ANCH.crest = new Vector3(RIDGE_X + 0.8, crestY + 0.4, 0);
}

function globeFrame(t) {
  camera.clearViewOffset();
  for (const key of ['gTilt', 'gDist', 'gEarth']) S[key] += (T[key] - S[key]) * k(0.03);
  moon.rotation.y = SPIN.y + t * (reduced ? 0 : 0.00004);
  tilt.rotation.x = -S.gTilt * (Math.PI / 2 - 0.12);
  // the Moon sits left of centre, clear of the data panel; grazing light from the left, as at the pole
  const off = slideIdx === 1 ? 0.95 : 0;
  camera.position.set(off, 0, S.gDist); camera.lookAt(off, slideIdx === 6 ? -0.25 : 0, 0);
  gsun.position.set(-3, 0.35 - S.gTilt * 0.3, 0.9);
  // the Earth: rising behind the limb, rocking a little (libration)
  const wob = reduced ? 0 : Math.sin(t * 0.0009) * 0.05;
  gearth.position.set((slideIdx === 1 ? -1.1 : 1.4) + wob, -1.4 + S.gEarth * 2.6 + wob * 0.5, -6);
  gearth.visible = S.gEarth > 0.02;
}

function resize() {
  const w = innerWidth, hgt = innerHeight;
  renderer.setSize(w, hgt, false); camera.aspect = w / hgt; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ------------------------------------------------------------------ telemetry tags pinned to the 3-D scene
const TAGS = {
  0: [[],
    [{ a: 'lander', t: 'ALABEO 30°', c: 'lost' }, { a: 'hit', t: 'ANTENA DESAPUNTADA', c: 'lost' }, { a: 'earth', t: 'TIERRA', c: 'rf' }],
    [{ a: 'lander', t: 'SIN LUZ SOLAR', c: 'lost' }, { a: 'hit', t: 'ANTENA DESAPUNTADA', c: 'lost' }, { a: 'earth', t: 'TIERRA', c: 'rf' }],
    [{ a: 'lander', t: 'SIN LUZ SOLAR', c: 'lost' }, { a: 'earth', t: 'TIERRA', c: 'rf' }]],
  3: [[{ a: 'lander', t: 'NIVELADO · ENLACE 35 %', c: 'rf' }, { a: 'earth', t: 'TIERRA', c: 'rf' }],
    [{ a: 'lander', t: 'ALABEO 30°', c: 'lost' }, { a: 'hit', t: 'ENLACE 7 %', c: 'lost' }, { a: 'earth', t: 'TIERRA', c: 'rf' }],
    [{ a: 'dish', t: 'CARDÁN → TIERRA', c: 'ok' }, { a: 'lander', t: 'ALABEO 30°', c: 'sun' }, { a: 'earth', t: 'TIERRA', c: 'rf' }],
    [{ a: 'array', t: 'MÁSTIL 10 m · PANELES AL SOL', c: 'sun' }, { a: 'lander', t: 'CUERPO EN SOMBRA · CALEFACTORES', c: 'rf' }]],
  5: [[{ a: 'lander', t: 'EN SOMBRA', c: 'lost' }, { a: 'crest', t: 'CRESTA CON SOL', c: 'sun' }],
    [{ a: 'lander', t: 'NO SOBREVIVE · T+2 d 17 h', c: 'lost' }, { a: 'crest', t: 'CRESTA CON SOL', c: 'sun' }],
    [{ a: 'lander', t: 'NO SOBREVIVE · T+2 d 17 h', c: 'lost' }, { a: 'crest', t: 'ESCAPE · 250 m AL ESTE', c: 'ok' }],
    [{ a: 'lander', t: 'SOBREVIVE 15 DÍAS · MARGEN 13 %', c: 'ok' }]],
};
const tagBox = document.getElementById('tags');
const tagEls = Array.from({ length: 3 }, () => { const el = document.createElement('div'); el.className = 'tag'; el.innerHTML = '<i></i><span></span>'; tagBox.appendChild(el); return el; });
function setTags() {
  const list = (scene === 'surface' && TAGS[slideIdx] && TAGS[slideIdx][step]) || [];
  tagEls.forEach((el, i) => {
    const d = list[i];
    if (!d) { el.classList.remove('is-on'); return; }
    el.dataset.a = d.a; el.querySelector('span').textContent = d.t;
    el.className = `tag ${d.c || ''}${d.a === 'earth' ? ' left' : ''} is-on`;
  });
}
const pv = new Vector3();
function placeTags() {
  for (const el of tagEls) {
    const p = ANCH[el.dataset.a];
    if (!p || !el.classList.contains('is-on')) continue;
    pv.copy(p).project(camera);
    const x = (pv.x + 1) / 2 * innerWidth, y = (1 - pv.y) / 2 * innerHeight;
    const left = el.dataset.a === 'earth' || x + 26 + el.offsetWidth > innerWidth - 12;
    el.classList.toggle('left', left);
    el.style.transform = left ? `translate(${x}px, ${y}px) translate(-100%, -50%) translateX(-26px)` : `translate(${x}px, ${y}px) translate(26px, -50%)`;
  }
}

function loop(t) {
  if (scene === 'surface') { surfaceFrame(t); renderer.render(surface, camera); placeTags(); }
  else if (scene === 'globe') { globeFrame(t); renderer.render(globe, camera); }
  else renderer.clear();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ------------------------------------------------------------------ slides, steps, counters, notes, timer
const slides = [...document.querySelectorAll('.slide')];
const veil = document.getElementById('veil');
const notes = document.getElementById('notes');
const acts = document.getElementById('acts');
acts.innerHTML = slides.map(() => '<i><b></b></i>').join('');

function countUp(el) {
  if (!el.dataset.count || el.dataset.done) return;
  el.dataset.done = '1';
  const to = Number(el.dataset.count), dec = Number(el.dataset.dec || 0), unit = el.dataset.unit || '', t0 = performance.now(), dur = reduced ? 1 : 1400;
  const tick = (now) => { const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = (to * e).toFixed(dec).replace('.', ',') + unit; if (p < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}

function render() {
  slides.forEach((s, i) => s.classList.toggle('is-current', i === slideIdx));
  const cur = slides[slideIdx];
  cur.querySelectorAll('[data-step]').forEach((el) => {
    const on = Number(el.dataset.step) <= step;
    el.classList.toggle('is-in', on);
    if (on) el.querySelectorAll('[data-count]').forEach(countUp);
    if (on && el.dataset.count) countUp(el);
  });
  const m4 = document.getElementById('m4');
  if (slideIdx === 3) {
    m4.textContent = step >= 2 ? 'Recuperado' : step >= 1 ? '7 %' : '35 %'; m4.classList.toggle('is-ok', step >= 2);
    m4.nextElementSibling.textContent = step >= 2 ? 'enlace con la Tierra, con el cardán de antena' : step >= 1 ? 'tiempo de enlace con 30° de alabeo (motor)' : 'tiempo de enlace con el módulo nivelado (motor)';
  }
  [...acts.children].forEach((i, n) => { i.firstChild.style.width = n < slideIdx ? '100%' : n === slideIdx ? `${((step + 1) / Number(cur.dataset.steps)) * 100}%` : '0'; });
  const nt = NOTES[slideIdx];
  notes.innerHTML = `<h4>${nt.act}</h4><p class="dir">${nt.dir}</p><p>${nt.say}</p>`;
  direct(slideIdx, step);
  setTags();
}

function go(si, st) {
  const nextScene = slides[si].dataset.scene;
  const change = si !== slideIdx;
  if (change) dust.userData = {};
  if (change && nextScene !== scene) {
    veil.classList.add('is-on');
    setTimeout(() => { scene = nextScene; slideIdx = si; step = st; render(); snap(); veil.classList.remove('is-on'); }, reduced ? 0 : 430);
    return;
  }
  slideIdx = si; step = st; scene = nextScene; render();
}
function next() {
  startClock();
  const steps = Number(slides[slideIdx].dataset.steps);
  if (step + 1 < steps) go(slideIdx, step + 1);
  else if (slideIdx + 1 < slides.length) go(slideIdx + 1, 0);
}
function prev() {
  if (step > 0) go(slideIdx, step - 1);
  else if (slideIdx > 0) go(slideIdx - 1, Number(slides[slideIdx - 1].dataset.steps) - 1);
}

// 3:00 countdown, red once over time
const clock = document.getElementById('clock');
let clockT0 = 0, clockRun = false;
function startClock() { if (!clockRun) { clockRun = true; clockT0 = performance.now(); } }
setInterval(() => {
  if (!clockRun) return;
  const left = 180 - (performance.now() - clockT0) / 1000, a = Math.abs(Math.round(left));
  clock.textContent = `${left < 0 ? '+' : ''}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
  clock.classList.toggle('is-late', left < 0);
}, 250);

addEventListener('keydown', (e) => {
  if (['ArrowRight', ' ', 'PageDown', 'Enter'].includes(e.key)) { e.preventDefault(); next(); }
  else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); prev(); }
  else if (e.key === 'n' || e.key === 'N') notes.hidden = !notes.hidden;
  else if (e.key === 't' || e.key === 'T') { clockRun = false; clock.textContent = '3:00'; clock.classList.remove('is-late'); }
  else if (e.key === 'f' || e.key === 'F') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); }
  else if (e.key === 'Home') go(0, 0);
});
addEventListener('click', (e) => { if (!e.target.closest('a, button, .notes')) next(); });
setTimeout(() => document.getElementById('help').classList.add('is-off'), 6000);
// deep link for review: #s=3.2 opens slide 3, step 2
function fromHash() {
  const m = /s=(\d+)(?:\.(\d+))?/.exec(location.hash);
  if (!m) return false;
  slideIdx = Math.min(slides.length - 1, Number(m[1]) - 1); step = Number(m[2] || 0); scene = slides[slideIdx].dataset.scene;
  dust.userData = {};
  return true;
}
fromHash();
addEventListener('hashchange', () => { if (fromHash()) { render(); snap(); } });
render(); snap();
