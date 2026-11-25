import * as THREE from 'three';
import { PaperModel, DEG, clamp } from './model.js';
import { createTimeline } from './timeline.js';

/* ==================================================================
 *  渲染器 / 场景 / 灯光 / 地面
 * ================================================================== */
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);

scene.add(new THREE.HemisphereLight(0xffffff, 0xe8e0d2, 0.85));
scene.add(new THREE.AmbientLight(0xffffff, 0.2));
const keyLight = new THREE.DirectionalLight(0xfff3e0, 2.05);
keyLight.position.set(3.0, 7.6, 3.4);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 1; keyLight.shadow.camera.far = 22;
keyLight.shadow.camera.left = -3.6; keyLight.shadow.camera.right = 3.6;
keyLight.shadow.camera.top = 3.6; keyLight.shadow.camera.bottom = -3.6;
keyLight.shadow.bias = -0.0007;
keyLight.shadow.radius = 3.5;
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xdce6ff, 0.45);
fillLight.position.set(-4, 3.4, -2.4);
scene.add(fillLight);

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(256, 256, 30, 256, 256, 256);
  r.addColorStop(0, '#fdfaf3');
  r.addColorStop(0.45, '#f1e9da');
  r.addColorStop(1, '#d5c8b1');
  g.fillStyle = r; g.fillRect(0, 0, 512, 512);
  g.globalAlpha = 0.05;
  for (let i = 0; i < 4500; i++) {
    g.fillStyle = Math.random() > 0.5 ? '#000' : '#fff';
    g.fillRect(Math.random() * 512, Math.random() * 512, 1.6, 1.6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(9, 72),
  new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.99, metalness: 0 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

/* ==================================================================
 *  纸模型 + 完整时间轴
 * ================================================================== */
const model = new PaperModel();
scene.add(model.root);

const TL = createTimeline(model);
scene.add(TL.bike.group);

/* ==================================================================
 *  摄像机
 * ================================================================== */
function applyCamera(t) {
  const inRide = t >= TL.rideStep.t0 - 0.2;
  const orbit = inRide ? Math.sin((t - TL.rideStep.t0) * 0.32) * 13 : 0;
  const yaw = TL.cam.yaw + TL.camUser.dyaw + orbit;
  const pitch = clamp(TL.cam.pitch + TL.camUser.dpitch, 2, 88);
  const dist = clamp(TL.cam.dist + TL.camUser.ddist, 1.8, 12);
  const p = new THREE.Vector3(TL.cam.tx, TL.cam.ty, TL.cam.tz);
  camera.position.set(
    p.x + dist * Math.cos(pitch * DEG) * Math.sin(yaw * DEG),
    p.y + dist * Math.sin(pitch * DEG),
    p.z + dist * Math.cos(pitch * DEG) * Math.cos(yaw * DEG)
  );
  camera.lookAt(p.x * 0.9, p.y + (inRide ? -0.03 : 0), p.z);
}

/* ==================================================================
 *  播放循环
 * ================================================================== */
const clock = new THREE.Clock();
let time = 0;
let playing = true;
let speed = 1;
let rideT = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (playing) time = Math.min(time + dt * speed, TL.total);
  if (time >= TL.rideStep.t0 - 0.03 && time > rideT0) rideT += dt * speed;
  else if (time < TL.rideStep.t0 - 0.03) rideT = 0;

  TL.applyTime(time, rideT);
  applyCamera(time);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
let rideT0 = TL.rideStep.t0;

/* ==================================================================
 *  UI
 * ================================================================== */
const ui = {
  capIndex: document.getElementById('cap-index'),
  capTitle: document.getElementById('cap-title'),
  capDesc: document.getElementById('cap-desc'),
  ticks: document.getElementById('ticks'),
  playBtn: document.getElementById('play'),
  bar: document.getElementById('bar-fill'),
  caption: document.getElementById('caption'),
};

const tickEls = TL.steps.map((s, i) => {
  const el = document.createElement('button');
  el.className = 'tick';
  el.title = `${i + 1}. ${s.title}`;
  el.onclick = () => { seekTo(i >= TL.steps.length - 1 ? TL.rideStep.t0 + 0.03 : s.t0 + 0.002); };
  ui.ticks.appendChild(el);
  return el;
});

function seekTo(t) {
  time = t;
  rideT = 0;
  syncUI();
}
function syncUI() {
  const i = TL.stepIndexAt(time);
  const s = TL.steps[i];
  ui.capIndex.textContent = `${i + 1} / ${TL.steps.length}`;
  ui.capTitle.textContent = s.title;
  ui.capDesc.textContent = s.desc;
  ui.caption.classList.remove('pop'); void ui.caption.offsetWidth; ui.caption.classList.add('pop');
  tickEls.forEach((el, k) => el.classList.toggle('on', k <= i));
  ui.bar.style.width = `${(100 * Math.min(time, TL.total)) / TL.total}%`;
  ui.playBtn.textContent = playing ? '❚❚' : '▶';
}

ui.playBtn.onclick = () => { playing = !playing; syncUI(); };
document.getElementById('next').onclick = () => {
  const i = TL.stepIndexAt(time);
  const n = Math.min(i + 1, TL.steps.length - 1);
  playing = false;
  seekTo(n >= TL.steps.length - 1 ? TL.rideStep.t0 + 0.03 : TL.steps[n].t0 + 0.002);
};
document.getElementById('prev').onclick = () => {
  const i = TL.stepIndexAt(time);
  const n = Math.max(i - 1, 0);
  playing = false;
  seekTo(TL.steps[n].t0 + 0.002);
};
document.getElementById('replay').onclick = () => {
  TL.camUser.dyaw = TL.camUser.dpitch = TL.camUser.ddist = 0;
  playing = true;
  seekTo(0);
};
document.querySelectorAll('.spd').forEach((b) => {
  b.onclick = () => {
    speed = parseFloat(b.dataset.s);
    document.querySelectorAll('.spd').forEach((x) => x.classList.toggle('on', x === b));
  };
});
const hint = document.getElementById('hint');
if (hint) hint.onclick = () => { hint.style.display = 'none'; };

/* 交互：拖动旋转 / 滚轮缩放 */
let dragging = false, lastX = 0, lastY = 0;
canvas.addEventListener('pointerdown', (e) => {
  dragging = true; lastX = e.clientX; lastY = e.clientY;
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
});
canvas.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('pointercancel', () => { dragging = false; });
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  TL.camUser.dyaw -= (e.clientX - lastX) * 0.3;
  TL.camUser.dpitch = clamp(TL.camUser.dpitch + (e.clientY - lastY) * 0.22, -70, 70);
  lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  TL.camUser.ddist = clamp(TL.camUser.ddist + e.deltaY * 0.0022, -3.2, 6);
}, { passive: false });
window.addEventListener('resize', resize);
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
resize();

/* 键盘：空格播放/暂停，左右切换步骤 */
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); playing = !playing; syncUI(); }
  if (e.code === 'ArrowRight') document.getElementById('next').click();
  if (e.code === 'ArrowLeft') document.getElementById('prev').click();
});

/* URL 调试参数 */
const qs = new URLSearchParams(location.search);
if (qs.has('t')) { playing = false; seekTo(parseFloat(qs.get('t'))); }
if (qs.has('step')) {
  const i = clamp(parseInt(qs.get('step'), 10) - 1, 0, TL.steps.length - 1);
  playing = false;
  seekTo(TL.steps[i].t0 + 0.002);
}
if (qs.has('nohud')) document.querySelectorAll('.hud').forEach((e) => (e.style.display = 'none'));
if (qs.has('debug')) {
  const v = model.validateTiling();
  const el = document.createElement('div');
  el.className = 'dbg';
  el.textContent = `pieces ${v.pieces} · 覆盖 ${v.covered.toFixed(1)}% · 重叠 ${v.overlap.toFixed(1)}% · 面积 ${model.areaSum().toFixed(2)}`;
  document.body.appendChild(el);
}

const boot = document.getElementById('boot');
boot.classList.add('hide');
setTimeout(() => { boot.style.display = 'none'; }, 700);
syncUI();
TL.applyTime(0, 0);
applyCamera(0);
frame();
