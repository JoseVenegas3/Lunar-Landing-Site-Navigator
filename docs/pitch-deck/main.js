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
  ACESFilmicToneMapping, AmbientLight, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, DoubleSide, Group,
  MathUtils, Mesh, MeshBasicMaterial, MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, Points, PointsMaterial, RepeatWrapping,
  RingGeometry, SRGBColorSpace, Scene, SphereGeometry, TextureLoader, Vector3, WebGLRenderer, BoxGeometry, Quaternion,
} from 'three';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const k = (rate) => (reduced ? 1 : rate); // per-frame easing factor

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
const CRATERS = [[-14, -10, 7], [16, -22, 10], [24, 12, 6], [-26, 18, 9], [6, 30, 5], [-40, -30, 14]];
function heightAt(x, z) {
  let y = (fbm(x * 0.05 + 10, z * 0.05 + 3) - 0.5) * 7 + (fbm(x * 0.3, z * 0.3) - 0.5) * 0.6;
  y += Math.max(0, x - 18) * 0.35; // a ridge to the east, where the light is
  for (const [cx, cz, r] of CRATERS) { const d = Math.hypot(x - cx, z - cz) / r; if (d < 1.25) y += d < 1 ? -2.2 * (1 - d * d) : 1.4 * (1.25 - d) * 4 * (d - 1); }
  return y;
}

// ------------------------------------------------------------------ surface scene: terrain, lander, Earth
const surface = new Scene();
surface.background = new Color(0x05070b);
surface.add(stars());
const ambient = new AmbientLight(0x3a4560, 0.25); surface.add(ambient);
const sun = new DirectionalLight(0xfff1d6, 3.2);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 260 });
surface.add(sun, sun.target);
{
  const g = new PlaneGeometry(220, 220, 260, 260); g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  g.computeVertexNormals();
  const relief = tex.load(moonReliefUrl); relief.wrapS = relief.wrapT = RepeatWrapping; relief.repeat.set(6, 6);
  const ground = new Mesh(g, new MeshStandardMaterial({ color: 0x9a9a98, roughness: 0.97, metalness: 0, bumpMap: relief, bumpScale: 2.5 }));
  ground.receiveShadow = true; surface.add(ground);
}
const earth = new Mesh(new SphereGeometry(4, 48, 32), new MeshStandardMaterial({ color: 0x2f6fd8, emissive: 0x0d2a5c, roughness: 0.6 }));
earth.position.set(-120, 22, -170); surface.add(earth);

// the lander: gold body, legs, mast with array, dish
const gold = new MeshStandardMaterial({ color: 0xc9a24b, metalness: 0.75, roughness: 0.35 });
const grey = new MeshStandardMaterial({ color: 0xc9d1dc, metalness: 0.4, roughness: 0.5 });
const cell = new MeshStandardMaterial({ color: 0x1a2a55, metalness: 0.3, roughness: 0.25, emissive: 0x0a1430 });
const lander = new Group(); surface.add(lander);
const body = new Group(); lander.add(body);
const add = (geo, mat, x, y, z, parent = body) => { const m = new Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
add(new CylinderGeometry(1.1, 1.25, 1.3, 8), gold, 0, 1.55, 0);
add(new CylinderGeometry(1.15, 1.15, 0.12, 8), grey, 0, 2.25, 0);
for (let i = 0; i < 4; i++) {
  const a = (i / 4) * Math.PI * 2 + Math.PI / 4, leg = add(new CylinderGeometry(0.06, 0.06, 1.9, 6), grey, Math.cos(a) * 1.35, 0.85, Math.sin(a) * 1.35);
  leg.rotation.z = -Math.cos(a) * 0.45; leg.rotation.x = Math.sin(a) * 0.45;
  add(new CylinderGeometry(0.28, 0.32, 0.08, 12), grey, Math.cos(a) * 1.75, 0.05, Math.sin(a) * 1.75);
}
add(new ConeGeometry(0.55, 0.7, 16, 1, true), grey, 0, 0.6, 0).rotation.x = Math.PI;
const mast = add(new CylinderGeometry(0.05, 0.05, 1, 6), grey, 0, 2.3, 0); mast.geometry.translate(0, 0.5, 0);
const array = add(new BoxGeometry(2.4, 1.3, 0.05), cell, 0, 3.6, 0);
const dishArm = new Group(); dishArm.position.set(0.9, 2.4, 0.4); body.add(dishArm);
const dish = add(new SphereGeometry(0.55, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.6), new MeshStandardMaterial({ color: 0xeef2f7, metalness: 0.3, roughness: 0.4, side: DoubleSide }), 0, 0, 0, dishArm);
dish.rotation.x = Math.PI / 2;
const beamMat = new MeshBasicMaterial({ color: 0x4fd8ff, transparent: true, opacity: 0.35, depthWrite: false });
const beam = new Mesh(new CylinderGeometry(0.05, 1.6, 1, 16, 1, true), beamMat); beam.geometry.translate(0, 0.5, 0); surface.add(beam);
const ring = new Mesh(new RingGeometry(0.8, 1, 48), new MeshBasicMaterial({ color: 0xcbbfa8, transparent: true, opacity: 0, side: DoubleSide, depthWrite: false }));
ring.rotation.x = -Math.PI / 2; surface.add(ring);
const arrow = new Mesh(new ConeGeometry(0.6, 1.6, 3), new MeshBasicMaterial({ color: 0x19d37f, transparent: true, opacity: 0 })); arrow.rotation.z = -Math.PI / 2; surface.add(arrow);

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
const S = { landerY: 0, roll: 0, gimbal: 0, mast: 0, sunEl: 0.06, sunI: 3.2, cold: 0, beamHue: 'rf', hopX: 0, arrow: 0,
  cam: new Vector3(7, 3.2, 9), look: new Vector3(0, 1.6, 0), gTilt: 0, gDist: 3.4, gEarth: 0, gSpin: 0.6 };
const T = { ...S, cam: S.cam.clone(), look: S.look.clone() };
let scene = 'surface', slideIdx = 0, step = 0;
const BEAM = { rf: new Color(0x4fd8ff), lost: new Color(0xff3b55), ok: new Color(0x19d37f) };

/** Scene targets per slide and step. */
function direct(si, st) {
  Object.assign(T, { roll: 0, gimbal: 0, mast: 0, sunI: 3.2, cold: 0, beamHue: 'rf', hopX: 0, arrow: 0, landerY: 0 });
  if (si === 0) {
    T.cam.set(6.5, 2.4, 8.5); T.look.set(0, 1.8, 0);
    if (st === 0) { T.landerY = 0; S.landerY = 14; S.roll = 0; T.cam.set(8, 4, 11); }
    if (st >= 1) { T.roll = 30; T.beamHue = 'lost'; }
    if (st >= 2) { T.sunI = 0.35; T.cold = 1; }
    if (st >= 3) { T.cam.set(16, 9, 22); T.look.set(0, 1, 0); }
  } else if (si === 3) {
    T.cam.set(-9.5, 4.2, 11.5); T.look.set(-1.2, 2.6, 0);
    if (st >= 1) { T.roll = 30; T.beamHue = 'lost'; }
    if (st >= 2) { T.gimbal = 1; T.beamHue = 'ok'; }
    if (st >= 3) { T.mast = 1; T.cam.set(-12, 6.5, 14); T.look.set(-1.5, 4, 0); }
  } else if (si === 5) {
    T.cam.set(9, 6, 13); T.look.set(3, 1, 0);
    T.sunI = st >= 3 ? 3.2 : 0.4; T.cold = st >= 3 ? 0 : 1;
    T.beamHue = st >= 3 ? 'ok' : 'lost'; T.roll = st >= 3 ? 0 : 8;
    if (st >= 2) T.arrow = 1;
    if (st >= 3) { T.hopX = 6; T.arrow = 0; }
  } else if (si === 1) {
    T.gTilt = st >= 1 ? 0.55 : 0.15; T.gDist = st >= 1 ? 3.3 : 4.0; T.gEarth = st >= 2 ? 1 : 0;
  } else if (si === 6) {
    T.gTilt = 0.35; T.gDist = 2.9; T.gEarth = 1;
  }
}

function surfaceFrame(t) {
  S.landerY += (T.landerY - S.landerY) * k(0.035);
  if (S.landerY < 0.02 && T.landerY === 0 && ring.material.opacity === 0 && slideIdx === 0 && step === 0 && !ring.userData.done) { ring.userData.done = true; ring.userData.t0 = t; }
  for (const key of ['roll', 'gimbal', 'mast', 'sunI', 'cold', 'hopX', 'arrow']) S[key] += (T[key] - S[key]) * k(0.04);
  S.cam.lerp(T.cam, k(0.025)); S.look.lerp(T.look, k(0.04));
  const groundY = heightAt(S.hopX, 0);
  const hopArc = slideIdx === 5 ? Math.sin(Math.PI * Math.min(1, S.hopX / 6)) * 2.2 : 0;
  lander.position.set(S.hopX, groundY + S.landerY + hopArc, 0);
  body.rotation.set(0, 0.6, MathUtils.degToRad(S.roll));
  mast.scale.y = 1 + S.mast * 4; array.position.y = 3.6 + S.mast * 4;
  // the dish: fixed to the body, or brought back to the Earth by the gimbal
  const dishWorld = new Vector3(); dish.getWorldPosition(dishWorld);
  const toEarth = earth.position.clone().sub(dishWorld).normalize();
  const bodyUp = new Vector3(0, 1, 0).applyQuaternion(body.getWorldQuaternion(new Quaternion()));
  const fixedDir = bodyUp.clone().multiplyScalar(0.35).add(new Vector3(-0.7, 0.15, -1).normalize()).normalize().applyAxisAngle(new Vector3(0, 0, 1), MathUtils.degToRad(-S.roll) * 1.6);
  const dir = fixedDir.lerp(toEarth, S.gimbal || (S.roll < 1 ? 1 : 0)).normalize();
  beam.position.copy(dishWorld);
  beam.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir);
  beam.scale.set(1, 26, 1);
  beamMat.color.lerp(BEAM[T.beamHue], k(0.06));
  beamMat.opacity = 0.18 + 0.12 * (0.5 + 0.5 * Math.sin(t * 0.004));
  // grazing Sun from the east: low, long shadows; dimmer and bluer in the cold
  sun.position.set(lander.position.x + 60, lander.position.y + 60 * Math.tan(0.1 + (1 - S.cold) * 0.04), 20);
  sun.target.position.copy(lander.position); sun.intensity = S.sunI;
  ambient.color.setRGB(0.23 - S.cold * 0.08, 0.27 - S.cold * 0.06, 0.38 + S.cold * 0.1);
  // touchdown dust ring
  if (ring.userData.t0) { const a = (t - ring.userData.t0) / 1600; ring.material.opacity = a < 1 ? 0.7 * (1 - a) : 0; const s = 1 + a * 6; ring.scale.set(s, s, s); ring.position.set(lander.position.x, groundY + 0.05, 0); }
  arrow.material.opacity = S.arrow * 0.9; arrow.position.set(3, heightAt(3, 0) + 0.4, 0);
  camera.position.copy(S.cam).add(new Vector3(lander.position.x * 0.5, 0, 0)); camera.lookAt(S.look.clone().add(new Vector3(lander.position.x * 0.6, 0, 0)));
}

function globeFrame(t) {
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

function loop(t) {
  if (scene === 'surface') { surfaceFrame(t); renderer.render(surface, camera); }
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
}

function go(si, st) {
  const nextScene = slides[si].dataset.scene;
  const change = si !== slideIdx;
  if (change && nextScene !== scene) {
    veil.classList.add('is-on');
    setTimeout(() => { scene = nextScene; slideIdx = si; step = st; ring.userData = {}; S.hopX = 0; render(); veil.classList.remove('is-on'); }, reduced ? 0 : 430);
    return;
  }
  if (change) ring.userData = {};
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
  return true;
}
fromHash();
addEventListener('hashchange', () => { if (fromHash()) render(); });
render();
