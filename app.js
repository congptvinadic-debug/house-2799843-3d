// House 2799843 - entry #17 - three.js viewer of the CAD model (house.py -> Blender -> glTF).
// Coordinates: house metres (x along the road, y into the plot, z = RL) -> three.js (x, z, -y).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const Q = new URLSearchParams(location.search);
const RENDER = Q.has('render');
if (RENDER) document.body.classList.add('render');
const $ = (s) => document.querySelector(s);
const hv = (x, y, z) => new THREE.Vector3(x, z, -y);
const D2R = Math.PI / 180;
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const lerp = (a, b, t) => a + (b - a) * t;
const EASE = {
  linear: (t) => t,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  sine: (t) => 0.5 - 0.5 * Math.cos(Math.PI * t),
};
const MOBILE = () => innerWidth < 960;

// ------------------------------------------------------------------ data
const data = await fetch('assets/rooms.json').then((r) => r.json());
const META = data.meta;
const LV = { L0: 'Garage level', L1: 'Ground floor', L2: 'First floor' };
const RL = { L0: META.levels.L0, L1: META.levels.L1, L2: META.levels.L2 };

// sun table: NOAA, Riyadh 24.71 N 46.68 E, UTC+3 (alt, az from north clockwise), 08:00 / 12:00 / 16:00
const SUN = {
  mar: [[26.4, 103.9], [64.8, 179.1], [27.1, 255.8]],
  jun: [[36.9, 78.3], [88.2, 224.8], [34.5, 282.4]],
  dec: [[16.2, 126.1], [41.8, 182.8], [12.8, 236.4]],
};
const SEASON_TXT = { mar: '20 Mar', jun: '21 Jun', dec: '21 Dec' };
const SUN_TXT = ['Morning 08:00', 'Noon 12:00', 'Afternoon 16:00'];
const SKY = [ // top, mid, low per time of day
  ['#9fb7d4', '#d7dfe6', '#f1e3cf'],
  ['#7ea8d4', '#c6dae9', '#eef2ef'],
  ['#a2b1cb', '#dcd6d3', '#f3d9b8'],
];

// ------------------------------------------------------------------ views
const lensFov = (f) => (2 * Math.atan(18 / f)) / D2R; // horizontal FOV on a 36 mm sensor
function view(eye, target, hfov, shiftY = 0) {
  return { eye: hv(...eye), target: hv(...target), hfov, shiftY, lvl: shiftY ? 1 : 0 };
}
function orbitView(target, dist, elev, az, hfov) { // az: degrees west of south, camera side
  const h = dist * Math.cos(elev * D2R);
  const eye = [target[0] - h * Math.sin(az * D2R), target[1] - h * Math.cos(az * D2R), target[2] + dist * Math.sin(elev * D2R)];
  return view(eye, target, hfov);
}
const C = META.cams;
const VIEWS = {
  front: view(C.front.eye, C.front.target, lensFov(C.front.lens), C.front.shift_y),
  corner: view(C.corner.eye, C.corner.target, lensFov(C.corner.lens), C.corner.shift_y),
  rear: view(C.rear.eye, C.rear.target, lensFov(C.rear.lens)),
  aerial: view(C.aerial.eye, C.aerial.target, lensFov(C.aerial.lens)),
  // top-down orbits over each peeled level (from the south-south-west)
  lvl_L2: orbitView([9.4, 9.0, 8.4], 30, 60, 20, 52),
  lvl_L1: orbitView([9.4, 10.2, 4.8], 33, 60, 20, 52),
  lvl_L0: orbitView([10.4, 5.4, 0.3], 27, 64, 15, 52),
  section: view([-1.0, -13.0, 12.5], [9.4, 12.5, 5.0], 58),
};
function rotated(v, deg) { // same view orbited around its target
  const o = v.eye.clone().sub(v.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), deg * D2R);
  return { ...v, eye: v.target.clone().add(o), target: v.target.clone() };
}
VIEWS.lvl_L1d = rotated(VIEWS.lvl_L1, -4);
VIEWS.front_d = { ...VIEWS.front, eye: VIEWS.front.eye.clone().lerp(VIEWS.front.target, 0.05), target: VIEWS.front.target.clone() };
VIEWS.corner_d = rotated(VIEWS.corner, 2);
VIEWS.aerial_d = rotated(VIEWS.aerial, -2);
VIEWS.lvl_L2d = rotated(VIEWS.lvl_L2, -2.5);
VIEWS.lvl_L0d = rotated(VIEWS.lvl_L0, -3);
VIEWS.sectiond = rotated(VIEWS.section, -2.5);
VIEWS.reard = rotated(VIEWS.rear, 5);
const FLOOR_VIEW = { all: 'aerial', L2: 'lvl_L2', L1: 'lvl_L1', L0: 'lvl_L0' };

// ------------------------------------------------------------------ renderer / scene
const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: RENDER, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(RENDER ? 1 : Math.min(devicePixelRatio, MOBILE() ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;
stage.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'labels';
stage.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
scene.fog = new THREE.Fog(0xeef2ef, 70, 230);
const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 600);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 5;
controls.maxDistance = 110;
controls.maxPolarAngle = 1.86; // allow the low road-level views, ground clamp below
controls.screenSpacePanning = true;

const hemi = new THREE.HemisphereLight(0xdfe9f5, 0x8a7d68, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 3.0);
sun.castShadow = true;
const SC = hv(9.4, 10.5, 3);
sun.target.position.copy(SC);
scene.add(sun, sun.target);
const sm = MOBILE() ? 1024 : 2048;
sun.shadow.mapSize.set(sm, sm);
Object.assign(sun.shadow.camera, { left: -21, right: 21, top: 21, bottom: -21, near: 1, far: 140 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;

// section plane: keeps house y >= Y (A-10 looks north at the rear part)
const plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 250);
const planes = [plane];

// ------------------------------------------------------------------ materials (by Blender material name)
const MAT = {
  M_Render_White: { color: '#dddcd6', roughness: 0.88 },
  M_Charcoal: { color: '#2b2d30', roughness: 0.6 },
  M_Stone_Grey: { color: '#6e6c67', roughness: 0.92 },
  M_Alu_Black: { color: '#131416', roughness: 0.35, metalness: 0.6 },
  M_Glass: { color: '#9db3bb', roughness: 0.05, metalness: 0.2, opacity: 0.28, glass: true },
  M_Interior: { color: '#cdbca6', roughness: 0.75 },
  M_Concrete: { color: '#a6a5a1', roughness: 0.92 },
  M_Asphalt: { color: '#323337', roughness: 0.95 },
  M_Grass: { color: '#71894a', roughness: 1 },
  M_Hedge: { color: '#4c6a33', roughness: 1 },
  M_Tree: { color: '#5d7e3b', roughness: 1 },
  M_Trunk: { color: '#5b4735', roughness: 1 },
  M_Earth: { color: '#8b806c', roughness: 1, soil: true },
  M_Paving: { color: '#cbc7bf', roughness: 0.8 },
  M_Light: { color: '#ffe2b0', emissive: '#ffcf8a', emissiveIntensity: 1.6 },
  M_Furniture: { color: '#d1c7b7', roughness: 0.75 },
  M_Car: { color: '#2c3138', roughness: 0.3, metalness: 0.5 },
  M_Sanitary: { color: '#f1f1ef', roughness: 0.25 },
};
const CAP_BUILD = new THREE.MeshBasicMaterial({ color: '#2b2b2b', side: THREE.BackSide, clippingPlanes: planes, toneMapped: false });
const CAP_TREE = new THREE.MeshBasicMaterial({ color: '#4f6d35', side: THREE.BackSide, clippingPlanes: planes, toneMapped: false });
const CAP_SOIL = new THREE.MeshBasicMaterial({ color: '#857a66', side: THREE.BackSide, clippingPlanes: planes, toneMapped: false });

const groups = {}; // GRP_* nodes
const caps = [];
const gmats = {}; // group -> [materials]
const gmeshes = {}; // group -> [shadow-casting meshes]

function makeMat(name) {
  const d = MAT[name] || { color: '#cccccc', roughness: 0.8 };
  const m = new THREE.MeshStandardMaterial({
    color: d.color, roughness: d.roughness ?? 0.8, metalness: d.metalness ?? 0,
    emissive: d.emissive || '#000000', emissiveIntensity: d.emissiveIntensity ?? 0,
    transparent: !!d.glass, opacity: d.opacity ?? 1, depthWrite: !d.glass,
    clippingPlanes: planes, clipShadows: true,
  });
  m.userData = { base: d.opacity ?? 1, glass: !!d.glass, soil: !!d.soil };
  return m;
}

// ------------------------------------------------------------------ labels
const labels = [];
function addLabels() {
  for (const r of data.rooms) {
    const [x1, y1, x2, y2] = r.rect;
    const el = document.createElement('div');
    el.className = 'lbl';
    el.innerHTML = `${r.name}<small>${r.area.toFixed(1)} m²</small>`;
    el.addEventListener('click', (e) => { e.stopPropagation(); openDrawer(r); });
    const o = new CSS2DObject(el);
    o.position.copy(hv((x1 + x2) / 2, (y1 + y2) / 2, r.rl + 1.2));
    o.visible = false;
    o.userData = { room: r, cy: (y1 + y2) / 2 };
    scene.add(o);
    labels.push(o);
  }
}
const secMarks = [];
let secLine, base;
function addSectionMarks() {
  const g = new THREE.BufferGeometry().setFromPoints([hv(-1.2, 0, 5.06), hv(19.98, 0, 5.06)]);
  secLine = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#e2483b', depthTest: false, transparent: true }));
  secLine.renderOrder = 10;
  secLine.visible = false;
  scene.add(secLine);
  // model base at road level, not clipped: shown with the section so the cut sits on a plinth, not on the sky
  base = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#837d72', roughness: 1, transparent: true, opacity: 0 }));
  base.position.set(9.4, -0.02, -11);
  base.receiveShadow = true;
  base.visible = false;
  scene.add(base);
  for (const x of [-1.2, 19.98]) {
    const el = document.createElement('div');
    el.className = 'secmark';
    el.textContent = 'B';
    const o = new CSS2DObject(el);
    o.position.copy(hv(x, 0, 5.6));
    o.visible = false;
    o.userData.x = x;
    scene.add(o);
    secMarks.push(o);
  }
}

// ------------------------------------------------------------------ state (one object, written by tweens, the tour or the user)
const S = {
  eye: VIEWS.front.eye.clone(), target: VIEWS.front.target.clone(), hfov: VIEWS.front.hfov, shiftY: VIEWS.front.shiftY, lvl: 1,
  p: { Roof: 0, L2: 0, L1: 0 }, lab: { L0: 0, L1: 0, L2: 0 },
  sec: 0, secY: META.sec_b_y, sunT: 1, season: 'mar', caption: '', capO: 0,
};
let driven = true; // true: camera written from S (presets, tour); false: OrbitControls drive it
let camK = 1;
const ui = { view: 'front', floors: 'all', sun: 1 };

const tmp = new THREE.Vector3();
const qa = new THREE.Quaternion();
const m4 = new THREE.Matrix4();
function fovFit() {
  // keep the whole 3:2 Blender frame in view on wide screens ("contain"); on portrait cap the vertical FOV and dolly back
  const aspect = innerWidth / innerHeight;
  const th = Math.tan(S.hfov * D2R / 2);
  let vf = 2 * Math.atan(th / Math.min(aspect, 1.5)), k = 1;
  const vmax = 62 * D2R;
  if (vf > vmax) { k = th / (Math.tan(vmax / 2) * aspect); vf = vmax; k = 1 + (k - 1) * 0.45; } // portrait: fit the house, not the whole 3:2 frame
  return { vf, k, aspect };
}
// portrait dolly-back: level (road-height) views move back horizontally only, so the eye never sinks below the road
function scaleOff(v, k, inverse) {
  const ky = lerp(k, 1, S.lvl);
  if (inverse) { v.x /= k; v.z /= k; v.y /= ky; } else { v.x *= k; v.z *= k; v.y *= ky; }
  return v;
}
function applyCamera() {
  const { vf, k, aspect } = fovFit();
  camK = k;
  camera.fov = vf / D2R;
  if (driven) {
    camera.position.copy(S.target).add(scaleOff(tmp.subVectors(S.eye, S.target), k, false));
    controls.target.copy(S.target);
    camera.lookAt(S.target);
  }
  if (S.lvl > 0.001) { // Blender two-point perspective: level camera + vertical lens shift
    const lv = tmp.set(S.target.x, camera.position.y, S.target.z);
    m4.lookAt(camera.position, lv, camera.up);
    qa.setFromRotationMatrix(m4);
    camera.quaternion.slerp(qa, S.lvl);
  }
  camera.updateProjectionMatrix();
  if (S.lvl > 0.001 && S.shiftY) {
    camera.projectionMatrix.elements[9] += 2 * S.shiftY * S.lvl * Math.min(Math.max(aspect, 1), 1.5);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }
}

function setOpacity(mat, o) {
  const b = mat.userData.base;
  const tr = mat.userData.glass || o < 0.999;
  if (mat.transparent !== tr) { mat.transparent = tr; mat.needsUpdate = true; }
  mat.opacity = b * o;
  mat.depthWrite = !mat.userData.glass && o > 0.6;
}
function applyPeel() {
  for (const g of ['Roof', 'L2', 'L1']) {
    const node = groups[g];
    if (!node) continue;
    const t = S.p[g];
    node.position.y = 3.0 * t;
    node.visible = t < 0.995;
    for (const m of gmats[g]) setOpacity(m, 1 - t);
    const cast = t < 0.5; // a fading storey stops casting shadows half-way (no shadow pop at the first fade frame)
    for (const o of gmeshes[g]) o.castShadow = cast;
  }
}
function applySection() {
  const on = S.sec > 0.001;
  const y = on ? lerp(-14, S.secY, S.sec) : -250;
  plane.constant = -y;
  for (const c of caps) c.visible = on && (c.userData.g === 'Site' || c.userData.g === 'L0' || c.userData.g === 'Trees' || S.p[c.userData.g] < 0.005);
  secLine.visible = on;
  base.visible = on;
  base.material.opacity = clamp01(S.sec * 1.6); // fades with the cut, never pops
  secLine.position.z = -y;
  secLine.material.opacity = clamp01(S.sec * 2);
  const atB = Math.abs(S.secY - META.sec_b_y) < 0.03 && S.sec > 0.98;
  for (const o of secMarks) { o.visible = atB; o.position.z = -y; }
  return y;
}
function applyLabels(secY) {
  const narrow = innerWidth < 480;
  for (const o of labels) {
    const r = o.userData.room;
    let op = S.lab[r.level];
    if (S.sec > 0.001 && o.userData.cy < secY) op = 0;
    o.visible = op > 0.01;
    if (o.visible) o.element.style.opacity = op.toFixed(3);
    o.element.classList.toggle('narrow', narrow);
  }
}
function sunDir(t, season) {
  const tab = SUN[season];
  const i = Math.min(1, Math.floor(t)), f = t - i;
  const alt = lerp(tab[i][0], tab[i + 1][0], f) * D2R;
  const az = lerp(tab[i][1], tab[i + 1][1], f) * D2R;
  return { v: new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt)), alt: alt / D2R, az: az / D2R };
}
const cWarm = new THREE.Color('#ffd2a1'), cNoon = new THREE.Color('#fff6ea'), cTmp = new THREE.Color();
let lastSky = '';
function applySun() {
  const d = sunDir(S.sunT, S.season);
  sun.position.copy(SC).addScaledVector(d.v, 60);
  const w = Math.abs(S.sunT - 1); // 0 noon, 1 morning/afternoon
  sun.color.copy(cTmp.copy(cNoon).lerp(cWarm, w));
  sun.intensity = lerp(3.6, 3.0, w) * clamp01(0.35 + Math.sin(d.alt * D2R) * 1.4);
  hemi.intensity = lerp(0.9, 0.8, w);
  const i = Math.min(1, Math.floor(S.sunT)), f = S.sunT - i;
  const sky = [0, 1, 2].map((k) => '#' + new THREE.Color(SKY[i][k]).lerp(new THREE.Color(SKY[i + 1][k]), f).getHexString());
  const key = sky.join();
  if (key !== lastSky) {
    lastSky = key;
    const el = $('#sky').style;
    el.setProperty('--sky-top', sky[0]); el.setProperty('--sky-mid', sky[1]); el.setProperty('--sky-low', sky[2]);
    scene.fog.color.set(sky[2]);
  }
  return d;
}
const capEl = $('#caption');
let lastCap = null;
function applyCaption() {
  if (S.caption !== lastCap) { capEl.textContent = S.caption; lastCap = S.caption; }
  capEl.style.opacity = S.caption ? S.capO.toFixed(3) : '0';
}
const needle = $('#needle');
function applyCompass() {
  camera.getWorldDirection(tmp);
  const ang = Math.atan2(tmp.x, -tmp.z); // angle of the view direction from north (house +y = three -z)
  needle.style.transform = `rotate(${(-ang / D2R).toFixed(1)}deg)`;
}

function renderNow() {
  applyCamera();
  applyPeel();
  const y = applySection();
  applyLabels(y);
  applySun();
  applyCaption();
  applyCompass();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  declutter();
}
// hide labels that would overlap a larger room's label (greedy by area)
function declutter() {
  const vis = labels.filter((o) => o.visible);
  if (!vis.length) return;
  vis.sort((a, b) => b.userData.room.area - a.userData.room.area);
  const kept = [];
  for (const o of vis) {
    o.element.style.visibility = '';
    const r = o.element.getBoundingClientRect();
    const hit = kept.some((k) => r.left < k.right + 2 && r.right > k.left - 2 && r.top < k.bottom + 2 && r.bottom > k.top - 2);
    if (hit) o.element.style.visibility = 'hidden'; else kept.push(r);
  }
}

// ------------------------------------------------------------------ tweens
const tweens = [];
function tween(ms, fn, ease = EASE.inOut, done) {
  const tw = { t0: performance.now(), ms, fn, ease, done };
  tweens.push(tw);
  return tw;
}
function stepTweens(now) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    const t = clamp01((now - tw.t0) / tw.ms);
    tw.fn(tw.ease(t));
    if (t >= 1) { tweens.splice(i, 1); tw.done && tw.done(); }
  }
}
const sph = new THREE.Spherical(), sph2 = new THREE.Spherical();
function flyLerp(a, b, t, out = S, bulge = 0, lift = 0) {
  const tg = a.target.clone().lerp(b.target, t);
  sph.setFromVector3(tmp.subVectors(a.eye, a.target));
  sph2.setFromVector3(tmp.subVectors(b.eye, b.target));
  let dth = sph2.theta - sph.theta;
  while (dth > Math.PI) dth -= 2 * Math.PI;
  while (dth < -Math.PI) dth += 2 * Math.PI;
  // bulge: arc outwards mid-way so long moves never skim the facade
  const s = new THREE.Spherical(lerp(sph.radius, sph2.radius, t) * (1 + bulge * Math.sin(Math.PI * t)), Math.max(0.12, lerp(sph.phi, sph2.phi, t) - lift * Math.sin(Math.PI * t)), sph.theta + dth * t);
  out.target.copy(tg);
  out.eye.copy(tg).add(new THREE.Vector3().setFromSpherical(s));
  out.hfov = lerp(a.hfov, b.hfov, t);
  out.shiftY = lerp(a.shiftY, b.shiftY, t);
  out.lvl = lerp(a.lvl, b.lvl, t);
}
const snap = () => ({ eye: S.eye.clone(), target: S.target.clone(), hfov: S.hfov, shiftY: S.shiftY, lvl: S.lvl });
let camTween = null;
function flyTo(name, ms = 1100) {
  const a = snap(), b = VIEWS[name];
  const far = a.target.distanceTo(b.target) > 3 || Math.abs(new THREE.Spherical().setFromVector3(a.eye.clone().sub(a.target)).theta - new THREE.Spherical().setFromVector3(b.eye.clone().sub(b.target)).theta) > 0.8;
  driven = true;
  controls.enabled = false;
  if (camTween) tweens.splice(tweens.indexOf(camTween), 1);
  camTween = tween(ms, (t) => flyLerp(a, b, t, S, far ? 0.18 : 0), EASE.inOut, () => { camTween = null; driven = false; controls.enabled = true; controls.update(); });
}

// ------------------------------------------------------------------ public actions
function setView(name, quiet) {
  stopTour();
  ui.view = name;
  syncSeg('view', name);
  flyTo(name);
  if (!quiet) toast({ front: 'Front view · as elevation sheet A-05', corner: 'Corner view · front-left', rear: 'Rear view · garden + roof terrace', aerial: 'Aerial view' }[name]);
}
function setFloors(f, quiet) {
  stopTour();
  ui.floors = f;
  syncSeg('floors', f);
  const tgt = { all: [0, 0, 0], L2: [1, 0, 0], L1: [1, 1, 0], L0: [1, 1, 1] }[f];
  const from = { ...S.p };
  const labFrom = { ...S.lab };
  tween(600, (t) => { S.p.Roof = lerp(from.Roof, tgt[0], t); S.p.L2 = lerp(from.L2, tgt[1], t); S.p.L1 = lerp(from.L1, tgt[2], t); }, EASE.out);
  tween(200, (t) => { for (const k in S.lab) S.lab[k] = labFrom[k] * (1 - t); }, EASE.linear, () => {
    if (f !== 'all') setTimeout(() => tween(250, (t) => { S.lab[f] = t; }, EASE.linear), 400);
  });
  flyTo(FLOOR_VIEW[f]);
  ui.view = null;
  syncSeg('view', null);
  if (!quiet) {
    const n = data.rooms.filter((r) => r.level === f).length;
    toast(f === 'all' ? 'All floors' : `${LV[f]} +${RL[f].toFixed(2)} · ${n} rooms labelled`);
  }
}
function setSection(on, y, quiet) {
  stopTour();
  const b = $('#secBtn');
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  if (y !== undefined) { S.secY = y; $('#secRange').value = y; }
  const from = S.sec;
  if (on && from > 0.99) { /* slider drag: live */ } else tween(on ? 700 : 450, (t) => { S.sec = lerp(from, on ? 1 : 0, t); }, EASE.inOut);
  $('#secOut').textContent = on ? `y ${S.secY.toFixed(2)} m` : 'off';
  $('#secOut').classList.toggle('off', !on);
  if (!quiet && on) toast(Math.abs(S.secY - META.sec_b_y) < 0.03 ? 'Section B-B at y 12.50 m · as sheet A-10' : `Section at y ${S.secY.toFixed(2)} m`);
}
function setSun(i, quiet) {
  stopTour();
  ui.sun = i;
  syncSeg('sun', String(i));
  const from = S.sunT;
  tween(600, (t) => { S.sunT = lerp(from, i, t); }, EASE.inOut);
  if (!quiet) { const d = sunDir(i, S.season); toast(`${SUN_TXT[i]} · ${SEASON_TXT[S.season]} · sun ${d.alt.toFixed(0)}° high`); }
}
function setSeason(s) {
  S.season = s;
  $('#season').value = s;
  const d = sunDir(S.sunT, s);
  toast(`${SUN_TXT[Math.round(S.sunT)]} · ${SEASON_TXT[s]} · sun ${d.alt.toFixed(0)}° high`);
  dirty = true;
}

// ------------------------------------------------------------------ UI wiring
let toastTimer;
function toast(msg) {
  if (RENDER || !msg) return;
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}
function syncSeg(name, v) {
  const seg = document.querySelector(`.seg[data-seg="${name}"]`);
  let on = null;
  for (const b of seg.querySelectorAll('button')) { const hit = b.dataset.v === v; b.classList.toggle('on', hit); b.setAttribute('aria-pressed', hit); if (hit) on = b; }
  const ind = seg.querySelector('.ind');
  if (on && on.offsetWidth) { ind.style.width = on.offsetWidth + 'px'; ind.style.transform = `translateX(${on.offsetLeft}px)`; ind.style.opacity = 1; } else if (!on) ind.style.opacity = 0;
}
function resyncSegs() { syncSeg('view', ui.view); syncSeg('floors', ui.floors); syncSeg('sun', String(ui.sun)); }
for (const seg of document.querySelectorAll('.seg')) {
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const n = seg.dataset.seg;
    if (n === 'view') setView(b.dataset.v);
    else if (n === 'floors') setFloors(b.dataset.v);
    else if (n === 'sun') setSun(+b.dataset.v);
  });
}
for (const t of document.querySelectorAll('.tabs button')) {
  t.addEventListener('click', () => {
    for (const x of document.querySelectorAll('.tabs button')) x.setAttribute('aria-selected', x === t);
    for (const p of document.querySelectorAll('.panel')) p.classList.toggle('active', p.dataset.panel === t.dataset.tab);
    resyncSegs();
  });
}
$('#secBtn').addEventListener('click', () => setSection(S.sec < 0.5, $('#secBtn').getAttribute('aria-pressed') === 'true' ? undefined : META.sec_b_y));
$('#secRange').addEventListener('input', (e) => {
  let y = +e.target.value;
  if (Math.abs(y - META.sec_b_y) < 0.25) { y = META.sec_b_y; e.target.value = y; } // snap to B-B
  S.secY = y;
  if (S.sec < 0.99) setSection(true, y, true); else { $('#secOut').textContent = `y ${y.toFixed(2)} m`; $('#secOut').classList.remove('off'); $('#secBtn').setAttribute('aria-pressed', 'true'); }
  dirty = true;
});
$('#secRange').addEventListener('change', () => setSection(true, S.secY));
$('#season').addEventListener('change', (e) => setSeason(e.target.value));

// drawer
const drawer = $('#drawer');
function buildList() {
  const gross = {
    L0: (META.garage[2] - META.garage[0]) * (META.garage[3] - META.garage[1]),
    L1: (META.envelope[2] - META.envelope[0]) * (META.envelope[3] - META.envelope[1]),
    L2: (META.envelope[2] - META.envelope[0]) * (14.5 - META.envelope[1]),
  };
  let h = '';
  for (const lv of ['L2', 'L1', 'L0']) {
    h += `<div class="lvl"><button data-floor="${lv}">${LV[lv]} +${RL[lv].toFixed(2)}</button><small>${gross[lv].toFixed(1)} m² gross</small></div>`;
    for (const r of data.rooms.filter((x) => x.level === lv)) h += `<div class="room" data-room="${r.level}|${r.name}"><span>${r.name}</span><span>${r.area.toFixed(1)} m²</span></div>`;
    if (lv === 'L2') h += `<div class="room tot"><span>Front balcony</span><span>${META.balcony_area.toFixed(1)} m²</span></div><div class="room"><span>Roof terrace</span><span>${META.roof_terrace_area.toFixed(1)} m²</span></div>`;
  }
  $('#roomList').innerHTML = h;
  for (const b of drawer.querySelectorAll('[data-floor]')) b.addEventListener('click', () => setFloors(b.dataset.floor));
  for (const d of drawer.querySelectorAll('[data-room]')) d.addEventListener('click', () => { const [lv] = d.dataset.room.split('|'); if (ui.floors !== lv) setFloors(lv, true); highlight(d.dataset.room); });
}
function highlight(key) {
  for (const d of drawer.querySelectorAll('[data-room]')) d.classList.toggle('hi', d.dataset.room === key);
  for (const o of labels) o.element.classList.toggle('hi', `${o.userData.room.level}|${o.userData.room.name}` === key);
}
function openDrawer(room) {
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  $('#roomsBtn').setAttribute('aria-expanded', 'true');
  if (room) { const key = `${room.level}|${room.name}`; highlight(key); drawer.querySelector(`[data-room="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'center' }); }
}
function closeDrawer() {
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  $('#roomsBtn').setAttribute('aria-expanded', 'false');
}
$('#roomsBtn').addEventListener('click', (e) => { e.stopPropagation(); drawer.classList.contains('open') ? closeDrawer() : openDrawer(); });
$('#drawerClose').addEventListener('click', closeDrawer);
addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDrawer(); stopTour(); } });
document.addEventListener('pointerdown', (e) => { if (drawer.classList.contains('open') && !drawer.contains(e.target) && !e.target.closest('#roomsBtn')) closeDrawer(); });

// user takes the camera: drop the lens shift smoothly, stop tweens/tour
controls.addEventListener('start', () => {
  stopTour();
  if (camTween) { tweens.splice(tweens.indexOf(camTween), 1); camTween = null; }
  driven = false;
  controls.enabled = true;
  if (ui.view) { ui.view = null; syncSeg('view', null); }
  if (S.lvl > 0) { const l0 = S.lvl; tween(350, (t) => { S.lvl = l0 * (1 - t); }, EASE.out); }
});

// ------------------------------------------------------------------ tour timeline (also used by the recorded video via __seek)
const SHOTS = [ // [time, view, ease of the segment ending here]
  [0, 'front'], [3.4, 'front_d', 'sine'], [5.0, 'corner', 'inOut'], [6.6, 'corner_d', 'sine'], [8.2, 'aerial', 'inOut'], [9.0, 'aerial_d', 'sine'],
  [9.9, 'lvl_L2', 'inOut'], [10.8, 'lvl_L2d', 'sine'], [11.6, 'lvl_L1', 'inOut'], [14.0, 'lvl_L1d', 'sine'], [14.8, 'lvl_L0', 'inOut'],
  [16.2, 'lvl_L0d', 'sine'], [17.4, 'section', 'inOut'], [20.2, 'sectiond', 'sine'], [22.4, 'rear', 'crane'], [25.0, 'reard', 'sine'],
];
const CAPS = [
  [0.3, 3.3, 'Entry #17 · the same CAD geometry as the drawings, in 3D'],
  [5.0, 6.5, 'Road 0.00 → garage +0.30 → ground +4.80 → first +8.40'],
  [8.2, 9.0, 'Peel the floors'],
  [9.9, 10.8, 'First floor +8.40 · two master suites + family lounge'],
  [11.6, 14.0, 'Ground floor +4.80 · living room 36.4 m² · kitchen island · covered veranda'],
  [14.8, 16.2, 'Garage +0.30 · 2 covered cars, cut into the 5 m bank'],
  [17.4, 19.8, 'Section B-B at y = 12.50 m · the same cut as sheet A-10'],
  [22.4, 23.6, 'Sun at Riyadh 24.7° N · morning → afternoon, 20 March'],
  [24.0, 25.0, 'Orbit · peel · cut · sun — live 3D viewer'],
];
const TOUR_LEN = 25.0;
const ramp = (t, a, b, ease = EASE.out) => ease(clamp01((t - a) / (b - a)));
const pulse = (t, a, b, c, d) => (t < c ? ramp(t, a, b, EASE.linear) : 1 - ramp(t, c, d, EASE.linear));
function tourState(t) {
  let k = 0;
  while (k < SHOTS.length - 2 && t >= SHOTS[k + 1][0]) k++;
  const [ta, va] = SHOTS[k], [tb, vb, eb] = SHOTS[k + 1];
  // 'crane' (T7 section -> rear, 168 deg of azimuth): eased like inOut, but the eye pulls back to ~42 m and rises to ~45 deg elevation mid-way,
  // so the swing happens high above the trees and looks down on the roof instead of whipping past the plinth
  const crane = eb === 'crane';
  flyLerp(VIEWS[va], VIEWS[vb], (EASE[crane ? 'inOut' : eb] || EASE.linear)(clamp01((t - ta) / (tb - ta))), S,
    eb === 'inOut' ? 0.18 : crane ? 0.6 : 0, crane ? 0.4 : 0);
  const back = ramp(t, 16.2, 16.8, EASE.inOut);
  S.p.Roof = ramp(t, 9.0, 9.6) * (1 - back);
  S.p.L2 = ramp(t, 10.8, 11.4) * (1 - back);
  S.p.L1 = ramp(t, 14.0, 14.6) * (1 - back);
  S.lab.L2 = pulse(t, 9.6, 9.9, 10.8, 11.0);
  S.lab.L1 = pulse(t, 11.35, 11.6, 14.0, 14.2);
  S.lab.L0 = pulse(t, 14.55, 14.8, 16.2, 16.4);
  S.secY = META.sec_b_y;
  // the cut sweeps back out 19.8-20.2 while the camera still holds the section framing; the plinth fades with it
  S.sec = t < 19.8 ? ramp(t, 16.6, 17.4, EASE.inOut) : 1 - ramp(t, 19.8, 20.2, EASE.inOut);
  S.season = 'mar';
  S.sunT = t < 20.2 ? 1 : t < 22.4 ? 1 - ramp(t, 20.2, 22.4, EASE.inOut) : 2 * ramp(t, 22.4, 24.4, EASE.sine);
  S.caption = ''; S.capO = 0;
  for (const [a, b, txt] of CAPS) if (t >= a - 0.2 && t <= b + 0.2) { S.caption = txt; S.capO = Math.min(clamp01((t - a + 0.2) / 0.2), clamp01((b + 0.2 - t) / 0.2)); }
  // dock state follows the timeline
  const v = t < 4.2 ? 'front' : t < 7.4 ? 'corner' : t < 9.0 ? 'aerial' : t >= 20.2 ? 'rear' : null;
  const f = S.p.L1 > 0.5 ? 'L0' : S.p.L2 > 0.5 ? 'L1' : S.p.Roof > 0.5 ? 'L2' : 'all';
  const sunI = Math.round(S.sunT);
  if (v !== ui.view) { ui.view = v; syncSeg('view', v); }
  if (f !== ui.floors) { ui.floors = f; syncSeg('floors', f); }
  if (sunI !== ui.sun) { ui.sun = sunI; syncSeg('sun', String(sunI)); }
  const secOn = S.sec > 0.5;
  $('#secBtn').setAttribute('aria-pressed', secOn);
  $('#secOut').textContent = secOn ? `y ${S.secY.toFixed(2)} m` : 'off';
  $('#secOut').classList.toggle('off', !secOn);
  if (MOBILE()) { // show the panel that is changing
    const tab = t < 9.0 || t >= 20.2 && t < 22.4 ? 'view' : t < 16.4 ? 'floors' : t < 20.2 ? 'section' : 'sun';
    for (const x of document.querySelectorAll('.tabs button')) x.setAttribute('aria-selected', x.dataset.tab === tab);
    for (const p of document.querySelectorAll('.panel')) p.classList.toggle('active', p.dataset.panel === tab);
  }
}
let tour = null;
function startTour() {
  closeDrawer();
  tour = { t0: performance.now() };
  driven = true;
  controls.enabled = false;
  tweens.length = 0; camTween = null;
  $('#tourBtn').setAttribute('aria-pressed', 'true');
  $('#tourBtn span').textContent = 'Stop tour';
}
function stopTour() {
  if (!tour) return;
  tour = null;
  S.caption = ''; S.capO = 0;
  driven = false;
  controls.enabled = true;
  ui.view = null; syncSeg('view', null);
  $('#tourBtn').setAttribute('aria-pressed', 'false');
  $('#tourBtn span').textContent = 'Play tour';
  dirty = true;
}
$('#tourBtn').addEventListener('click', () => (tour ? stopTour() : startTour()));

// ------------------------------------------------------------------ load + loop
let dirty = true;
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
  resyncSegs();
  dirty = true;
}
addEventListener('resize', resize);

const loader = new GLTFLoader();
const ready = new Promise((resolve, reject) => {
  loader.load('assets/house.glb', (gltf) => {
    const root = gltf.scene;
    root.traverse((o) => {
      if (o.name.startsWith('GRP_')) { groups[o.name.slice(4)] = o; gmats[o.name.slice(4)] = []; }
    });
    for (const [g, node] of Object.entries(groups)) {
      const meshes = [];
      node.traverse((o) => { if (o.isMesh) meshes.push(o); });
      gmeshes[g] = [];
      for (const o of meshes) {
        const name = o.material.name;
        o.material = makeMat(name);
        gmats[g].push(o.material);
        const glass = o.material.userData.glass;
        o.castShadow = !glass && name !== 'M_Light';
        if (o.castShadow) gmeshes[g].push(o);
        o.receiveShadow = !glass;
        if (!glass && name !== 'M_Light') {
          const capM = g === 'Trees' ? CAP_TREE : o.material.userData.soil || (['M_Grass', 'M_Paving'].includes(name) && g === 'Site') ? CAP_SOIL : CAP_BUILD;
        const c = new THREE.Mesh(o.geometry, capM);
          c.visible = false;
          c.userData.g = g;
          c.renderOrder = -1;
          o.add(c);
          caps.push(c);
        }
      }
    }
    scene.add(root);
    addLabels();
    addSectionMarks();
    buildList();
    resize();
    resolve();
  }, (e) => {
    if (e.total) { const p = Math.min(100, Math.round((e.loaded / e.total) * 100)); $('#barFill').style.width = p + '%'; $('#loadPct').textContent = p + ' %'; }
  }, (err) => { $('#loadPct').textContent = 'Could not load the model'; reject(err); });
});
await ready;
syncSeg('view', 'front'); syncSeg('floors', 'all'); syncSeg('sun', '1');
renderNow();
requestAnimationFrame(() => $('#loader').classList.add('done'));
setTimeout(() => $('#loader').classList.add('done'), 300); // rAF is paused in background tabs
setTimeout(() => { driven = false; controls.update(); }, 0);

function loop(now) {
  requestAnimationFrame(loop);
  if (RENDER) return;
  if (tour) {
    const t = (now - tour.t0) / 1000;
    if (t >= TOUR_LEN) { stopTour(); } else { tourState(t); dirty = true; }
  }
  if (tweens.length) { stepTweens(now); dirty = true; }
  if (!driven) {
    if (controls.update()) dirty = true;
    const hy = -camera.position.z; // keep the eye above the ground (road 0.00, plot grade +5.00)
    const minH = hy < 0.6 ? 1.0 : 5.8;
    if (camera.position.y < minH) { camera.position.y = minH; dirty = true; }
    S.target.copy(controls.target);
    S.eye.copy(S.target).add(scaleOff(tmp.subVectors(camera.position, S.target), camK, true));
  }
  if (dirty) { dirty = false; renderNow(); }
}
requestAnimationFrame(loop);

// ------------------------------------------------------------------ hooks for tests and the frame-exact recorder
window.__seek = (t) => { driven = true; tourState(t); renderNow(); };
window.__viewer = {
  THREE, S, VIEWS, META, data, scene, camera, renderer, controls, plane, sun, groups, labels, caps,
  setView, setFloors, setSection, setSun, setSeason, startTour, stopTour, sunDir, hv,
  ready: true,
  summary() {
    const vis = {};
    for (const [g, n] of Object.entries(groups)) vis[g] = n.visible;
    const lab = { L0: 0, L1: 0, L2: 0 };
    for (const o of labels) if (o.visible && +o.element.style.opacity > 0.9) lab[o.userData.room.level]++;
    const shown = labels.filter((o) => o.visible && o.element.style.visibility !== 'hidden').length;
    const d = sun.position.clone().sub(sun.target.position).normalize();
    return { groups: vis, labels: lab, labelsShown: shown, planeConstant: plane.constant, sec: S.sec, castShadow: sun.castShadow,
      sunDir: [d.x, d.y, d.z], cam: camera.position.toArray(), target: controls.target.toArray(), ui: { ...ui } };
  },
};
