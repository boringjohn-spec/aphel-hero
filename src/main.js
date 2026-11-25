import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createUniverse } from './universe.js';
import { loadRocket, createPlume } from './rocket.js';
import { createEngineAudio } from './audio.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const params = new URLSearchParams(location.search);
const still = params.has('still'); // QA: no idle drift, for repeatable screenshots

const $ = (id) => document.getElementById(id);
const el = {
  canvas: $('scene'),
  heading: $('heading'),
  engineState: $('engine-state'),
  thrust: $('thrust'),
  ignite: $('ignite'),
  roHeading: $('ro-heading'),
  roEngine: $('ro-engine'),
  leaderHeading: $('leader-heading'),
  leaderEngine: $('leader-engine'),
  tip: $('tip'),
  loader: $('loader'),
  progress: $('progress'),
  countdown: $('countdown'),
  sound: $('sound'),
  soundState: $('sound-state'),
  copy: document.querySelector('.copy'),
  topbar: document.querySelector('.topbar'),
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* ---------- Renderer, scene, camera ---------- */

const renderer = new THREE.WebGLRenderer({ canvas: el.canvas, antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.setClearColor(0x020203, 1);
const DPR = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(DPR);

const scene = new THREE.Scene();
const FOV = 30;
const TAN = Math.tan(((FOV / 2) * Math.PI) / 180);
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 2000);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.36;

// Key from the left, a little above the rocket's middle: high enough to model the body,
// low enough that it doesn't glare off the nose cone. A soft cool rim from behind, and a
// faint warm under-fill like galaxy light.
const KEY = 1.9;
const key = new THREE.DirectionalLight(0xfff0dd, KEY);
key.position.set(-6, 2.2, 7);
const rim = new THREE.DirectionalLight(0xb4c6ff, 1.2);
rim.position.set(6, 0.5, -7);
const under = new THREE.DirectionalLight(0xffa25a, 0.7);
under.position.set(2, -7, 3);
scene.add(key, rim, under);

const universe = createUniverse();
if (reduced) universe.setTwinkle(false);
scene.add(universe.group);

// pivot: tilt (drag pitch, bank, lean). spin: yaw about the rocket's own axis.
const pivot = new THREE.Group();
const spin = new THREE.Group();
pivot.add(spin);
scene.add(pivot);

const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, target);
composer.setPixelRatio(DPR);
composer.addPass(new RenderPass(scene, camera));
// Threshold sits above the rocket's specular highlights, so only stars, galaxy cores and the plume glow.
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.62, 0.3, 0.8);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ---------- Layout: fit the rocket between the top bar and the copy ---------- */

const view = { W: 1, H: 1, dist: 14, pxPerM: 1, rocketLen: 3.75 };
let rocket = null;
let plume = null;

function layout() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  view.W = W;
  view.H = H;
  renderer.setSize(W, H, false);
  composer.setSize(W, H);

  const top = el.topbar.getBoundingClientRect().bottom + Math.max(14, H * 0.03);
  const bottom = el.copy.getBoundingClientRect().top - Math.max(14, H * 0.03);
  const region = Math.max(bottom - top, H * 0.28);
  const centerY = top + region / 2;
  const rocketPx = region * 0.94;

  view.dist = (view.rocketLen * H) / (rocketPx * 2 * TAN);
  view.pxPerM = H / (2 * view.dist * TAN);

  camera.aspect = W / H;
  camera.setViewOffset(W, H, 0, H / 2 - centerY, W, H);
  camera.updateProjectionMatrix();

  // Sit the dust lane a hair below the nozzle, whatever the screen shape.
  const tail = rocket ? -rocket.bottom : view.rocketLen / 2;
  // Solve for the elevation (seen from the origin, 260 out) that the camera sees just under the tail.
  const want = Math.atan((tail + 0.18) / view.dist);
  const e = want + Math.asin(clamp((view.dist * Math.sin(want)) / 260, -1, 1));
  universe.setLaneElevation(-((Math.min(e, 0.35) * 180) / Math.PI));

  const scale = (H * DPR * 0.5) / TAN;
  const u = universe.uniforms;
  u.uScale.value = scale;
  u.uPixelRatio.value = DPR;
  u.uAspect.value = W / H;
  plume?.setScale(scale);
}

window.addEventListener('resize', layout);
layout();
document.fonts?.ready.then(layout);

/* ---------- State ---------- */

const st = {
  scrollTarget: 0,
  scroll: 0,
  prevScroll: 0,
  scrollVel: 0,
  idle: 0,
  dragYaw: 0,
  yawVel: 0,
  pitch: 0,
  pitchTarget: 0,
  dragging: false,
  swiping: false,
  pointerId: null,
  downT: 0,
  lastX: 0,
  lastY: 0,
  lastT: 0,
  moved: 0,
  px: -1,
  py: -1,
  pointerType: 'mouse',
  inside: false,
  mouse: new THREE.Vector2(),
  mouseS: new THREE.Vector2(),
  hover: false,
  hoverK: 0,
  engine: 'cold',
  engineT: 0,
  throttle: 0,
  ready: false,
  intro: 0,
};
window.__hero = st; // handy for QA from the console

/* ---------- Hit testing against the projected rocket axis ---------- */

const v3 = new THREE.Vector3();
const pTop = new THREE.Vector2();
const pBot = new THREE.Vector2();

function project(x, y, z, out) {
  v3.set(x, y, z).applyMatrix4(pivot.matrixWorld).project(camera);
  out.x = (v3.x * 0.5 + 0.5) * view.W;
  out.y = (-v3.y * 0.5 + 0.5) * view.H;
  return out;
}

function hitRocket(x, y) {
  if (!rocket || !st.ready) return false;
  project(0, rocket.top, 0, pTop);
  project(0, rocket.bottom, 0, pBot);
  const dx = pBot.x - pTop.x;
  const dy = pBot.y - pTop.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = clamp(((x - pTop.x) * dx + (y - pTop.y) * dy) / len2, 0, 1);
  const d = Math.hypot(x - (pTop.x + dx * t), y - (pTop.y + dy * t));
  // Wider near the tail, where the fins are.
  const tol = Math.max(22, 0.3 * view.pxPerM) + (t > 0.78 ? 0.18 * view.pxPerM : 0);
  return d < tol;
}

/* ---------- Engine ---------- */

const ENGINE_LABEL = { cold: 'Cold', igniting: 'Igniting', burning: 'Burning', shutdown: 'Shutdown' };
const audio = createEngineAudio();
window.__audio = audio; // QA: __audio.level()

function setEngine(state) {
  st.engine = state;
  st.engineT = 0;
  el.roEngine.dataset.state = state;
  el.engineState.textContent = ENGINE_LABEL[state];
  const on = state === 'igniting' || state === 'burning';
  el.ignite.textContent = on ? 'Cut Engine' : 'Ignite Engine';
  el.leaderEngine.classList.toggle('is-hot', on);
  el.tip.textContent = on ? 'Drag to inspect · Click to cut engine' : 'Drag to inspect · Click to ignite';
  document.body.classList.toggle('is-burning', on);
  if (state === 'igniting') audio.ignite();
  else if (state === 'shutdown') audio.shutdown();
}

function renderSound() {
  const on = audio.enabled;
  el.sound.setAttribute('aria-pressed', String(on));
  el.soundState.textContent = on ? 'On' : 'Off';
}
el.sound.addEventListener('click', () => {
  audio.setEnabled(!audio.enabled);
  renderSound();
});
renderSound();

function toggleEngine() {
  if (!st.ready) return;
  if (st.engine === 'cold' || st.engine === 'shutdown') setEngine('igniting');
  else setEngine('shutdown');
}

function updateEngine(dt) {
  st.engineT += dt;
  if (st.engine === 'igniting') {
    const k = Math.min(1, st.engineT / 0.55);
    const sputter = k < 1 ? 0.5 + 0.5 * Math.abs(Math.sin(st.engineT * 41)) : 1;
    st.throttle = easeOutCubic(k) * sputter;
    if (k >= 1) setEngine('burning');
  } else if (st.engine === 'burning') {
    st.throttle = damp(st.throttle, 1, 8, dt);
  } else if (st.engine === 'shutdown') {
    st.throttle = damp(st.throttle, 0, 3, dt);
    if (st.throttle > 0.25) st.throttle *= 0.96 + 0.04 * Math.sin(st.engineT * 47);
    if (st.throttle < 0.004) {
      st.throttle = 0;
      setEngine('cold');
    }
  }
}

el.ignite.addEventListener('click', toggleEngine);

/* ---------- Input: wheel, keys, pointer ---------- */

window.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    let d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (e.deltaMode === 1) d *= 32;
    else if (e.deltaMode === 2) d *= view.H;
    st.scrollTarget += clamp(d, -240, 240) * 0.0024;
  },
  { passive: false },
);

window.addEventListener('keydown', (e) => {
  const steps = { ArrowDown: 0.26, ArrowRight: 0.26, ArrowUp: -0.26, ArrowLeft: -0.26, PageDown: 1.05, PageUp: -1.05 };
  if (e.key in steps) {
    st.scrollTarget += steps[e.key];
    e.preventDefault();
  } else if (e.key === ' ' && (e.target === document.body || e.target === el.canvas)) {
    st.scrollTarget += e.shiftKey ? -1.05 : 1.05;
    e.preventDefault();
  }
});

const isUI = (t) => t instanceof Element && t.closest('a, button');

window.addEventListener('pointermove', (e) => {
  st.px = e.clientX;
  st.py = e.clientY;
  st.pointerType = e.pointerType;
  st.inside = true;
  st.mouse.set((e.clientX / view.W) * 2 - 1, -(e.clientY / view.H) * 2 + 1);
  if (e.pointerId !== st.pointerId) return;

  const dx = e.clientX - st.lastX;
  const dy = e.clientY - st.lastY;
  const now = performance.now();
  st.moved += Math.abs(dx) + Math.abs(dy);
  if (st.dragging) {
    st.dragYaw += dx * 0.009;
    st.pitchTarget = clamp(st.pitchTarget + dy * 0.007, -1.25, 1.25);
    const sec = Math.max(8, now - st.lastT) / 1000;
    st.yawVel = st.yawVel * 0.4 + ((dx * 0.009) / sec) * 0.6;
  } else if (st.swiping) {
    st.scrollTarget += (-dy - dx * 0.5) * 0.0068;
  }
  st.lastX = e.clientX;
  st.lastY = e.clientY;
  st.lastT = now;
});

window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || isUI(e.target)) return;
  st.px = e.clientX;
  st.py = e.clientY;
  st.pointerType = e.pointerType;
  st.pointerId = e.pointerId;
  st.downT = st.lastT = performance.now();
  st.lastX = e.clientX;
  st.lastY = e.clientY;
  st.moved = 0;
  if (hitRocket(e.clientX, e.clientY)) {
    st.dragging = true;
    st.yawVel = 0;
    document.body.classList.add('is-grabbing');
  } else if (e.pointerType !== 'mouse') {
    st.swiping = true;
  }
  try {
    e.target.setPointerCapture?.(e.pointerId);
  } catch {
    /* capture is a nicety */
  }
});

function endPointer(e) {
  if (e.pointerId !== st.pointerId) return;
  const tap = performance.now() - st.downT < 400 && st.moved < 8;
  if (st.dragging && tap && e.type === 'pointerup') toggleEngine();
  if (st.dragging && tap) st.yawVel = 0;
  // Touch has no hover: keep the readouts up for a moment after touching the rocket.
  if (st.dragging && st.pointerType !== 'mouse') hud.holdUntil = performance.now() + 2600;
  st.dragging = false;
  st.swiping = false;
  st.pointerId = null;
  document.body.classList.remove('is-grabbing');
}
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);
document.documentElement.addEventListener('pointerleave', () => {
  st.inside = false;
});
window.addEventListener('blur', () => {
  st.inside = false;
});

/* ---------- Readouts on leader lines ---------- */

const anchor = new THREE.Vector2();
let lastHeading = '';
let lastThrust = '';
let lastGrab = false;

function setLeader(g, x1, y, x2) {
  const line = g.firstElementChild;
  const dot = g.lastElementChild;
  const yy = Math.round(y) + 0.5;
  line.setAttribute('x1', x1.toFixed(1));
  line.setAttribute('x2', x2.toFixed(1));
  line.setAttribute('y1', yy);
  line.setAttribute('y2', yy);
  dot.setAttribute('cx', x1.toFixed(1));
  dot.setAttribute('cy', yy);
}

// Readouts show only while the cursor is on the rocket (or on a readout, or the button has
// keyboard focus). They power up and down mechanically: the anchor dot clicks on, the leader
// line extends in hard steps, then the label types across with a flicker. Leaving runs it
// backwards. A short grace lets the cursor travel from the rocket to a label.
const hud = { t: 0, lastWant: -1e9, holdUntil: 0, lineK: -1, labelK: -1 };
const HUD_GRACE = 380;
const HUD_IN = 0.5;
const HUD_OUT = 0.42;
const LABEL_OPACITY = [0, 0.55, 0.25, 0.85, 0.5, 1]; // per label step: flickers on, flickers off
const step = (x, n) => Math.ceil(clamp(x, 0, 1) * n) / n;

function readoutHovered() {
  return el.roHeading.matches(':hover') || el.roEngine.matches(':hover');
}

function animateHud(dt, now) {
  const want =
    st.ready &&
    (st.hover || st.dragging || readoutHovered() || el.ignite.matches(':focus-visible') || now < hud.holdUntil);
  if (want) hud.lastWant = now;
  const on = now - hud.lastWant < HUD_GRACE;
  hud.t = on ? Math.min(1, hud.t + dt / HUD_IN) : Math.max(0, hud.t - dt / HUD_OUT);
  return {
    dot: hud.t > 0,
    lineK: step((hud.t - 0.06) / 0.44, 6),
    labelK: step((hud.t - 0.5) / 0.5, 5),
  };
}

function applyLabel(node, k, fromRight) {
  const i = Math.round(k * 5);
  node.style.opacity = LABEL_OPACITY[i];
  const hidden = `${((1 - k) * 100).toFixed(0)}%`;
  node.style.clipPath = fromRight ? `inset(0 0 0 ${hidden})` : `inset(0 ${hidden} 0 0)`;
  node.classList.toggle('is-live', k > 0);
}

function updateHud(yaw, dt, now) {
  const deg = ((((yaw * 180) / Math.PI) % 360) + 360) % 360;
  const h = deg.toFixed(1).padStart(5, '0');
  if (h !== lastHeading) {
    el.heading.textContent = h;
    lastHeading = h;
  }
  const jitter = st.engine === 'burning' ? (Math.random() - 0.5) * 0.12 : 0;
  const thrust = Math.max(0, st.throttle * 9.8 + jitter).toFixed(1);
  if (thrust !== lastThrust) {
    el.thrust.textContent = thrust;
    lastThrust = thrust;
  }
  if (!rocket) return;

  const { dot, lineK, labelK } = animateHud(dt, now);
  const vis = dot ? 'visible' : 'hidden';
  el.leaderHeading.style.visibility = vis;
  el.leaderEngine.style.visibility = vis;
  if (labelK !== hud.labelK) {
    applyLabel(el.roHeading, labelK, false);
    applyLabel(el.roEngine, labelK, true);
    hud.labelK = labelK;
  }
  if (!dot && hud.lineK === 0) return; // fully off: skip the per-frame layout work
  hud.lineK = dot ? lineK : 0;

  const narrow = view.W < 761;
  const reach = narrow ? 128 : clamp(view.W * 0.12, 160, 220);
  const r = rocket.bodyR * view.pxPerM + 6;

  project(0, rocket.top * 0.3, 0, anchor);
  const hx = anchor.x - r;
  const hEnd = hx - reach;
  setLeader(el.leaderHeading, hx, anchor.y, hx - reach * lineK);
  el.roHeading.style.transform = `translate3d(${hEnd.toFixed(1)}px, ${anchor.y.toFixed(1)}px, 0) translateY(-100%)`;

  project(0, rocket.bottom + 0.4, 0, anchor);
  const ex = anchor.x + r + 0.1 * view.pxPerM;
  const eEnd = ex + reach;
  setLeader(el.leaderEngine, ex, anchor.y, ex + reach * lineK);
  el.roEngine.style.transform = `translate3d(${eEnd.toFixed(1)}px, ${anchor.y.toFixed(1)}px, 0) translate(-100%, -100%)`;
}

/* ---------- Next-flight countdown (a 14-day cadence) ---------- */

const EPOCH = Date.UTC(2026, 0, 6, 15, 0, 0);
const PERIOD = 14 * 864e5;
const pad = (n) => String(n).padStart(2, '0');
function tick() {
  let rem = PERIOD - ((((Date.now() - EPOCH) % PERIOD) + PERIOD) % PERIOD);
  const d = Math.floor(rem / 864e5);
  rem -= d * 864e5;
  const h = Math.floor(rem / 36e5);
  rem -= h * 36e5;
  const m = Math.floor(rem / 6e4);
  const s = Math.floor((rem - m * 6e4) / 1000);
  el.countdown.textContent = `T− ${pad(d)}d ${pad(h)}:${pad(m)}:${pad(s)}`;
}
tick();
setInterval(tick, 1000);

/* ---------- Load ---------- */

const manager = new THREE.LoadingManager();
let shownProgress = 0;
let targetProgress = 0;
manager.onProgress = (_url, loaded, total) => {
  targetProgress = Math.round((loaded / total) * 100);
};

loadRocket(manager)
  .then((r) => {
    rocket = r;
    spin.add(r.mesh);
    plume = createPlume(r);
    plume.group.position.y = r.bottom + 0.015;
    pivot.add(plume.group);
    view.rocketLen = r.length;
    layout();
    targetProgress = 100;
    st.ready = true;
    document.body.classList.add('is-ready');
  })
  .catch((err) => {
    console.error(err);
    el.loader.textContent = "We couldn't load the rocket. Refresh the page to try again.";
  });

/* ---------- Frame loop ---------- */

const clock = new THREE.Clock();
const zero = new THREE.Vector2();
const far = new THREE.Vector2(9, 9);
let time = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  time += dt;

  if (shownProgress < targetProgress) {
    shownProgress = Math.min(targetProgress, shownProgress + dt * 160);
    el.progress.textContent = Math.round(shownProgress);
  }

  const u = universe.uniforms;
  u.uTime.value = time;
  u.uFade.value = Math.min(1, time / (reduced ? 0.6 : 1.8));

  if (st.ready) st.intro = Math.min(1, st.intro + dt / (reduced ? 0.6 : 2.8));
  const ie = easeInOutCubic(st.intro);

  // Scroll → one shared angle for the rocket and the universe (reads as orbiting the rocket).
  st.scroll = damp(st.scroll, st.scrollTarget, 4.2, dt);
  const vel = (st.scroll - st.prevScroll) / Math.max(dt, 1e-4);
  st.prevScroll = st.scroll;
  st.scrollVel = damp(st.scrollVel, vel, 5, dt);
  if (!reduced && !still) st.idle += dt * 0.045;

  // Drag coasts after release, then the rocket tips back upright.
  if (!st.dragging) {
    st.dragYaw += st.yawVel * dt;
    st.yawVel *= Math.exp(-dt * 2.2);
    st.pitchTarget = damp(st.pitchTarget, 0, 1.3, dt);
  }
  st.pitch = damp(st.pitch, st.pitchTarget, 9, dt);

  const mouseOn = st.inside && st.pointerType === 'mouse';
  st.mouseS.lerp(mouseOn ? st.mouse : zero, 1 - Math.exp(-dt * 2.6));
  u.uMouse.value.lerp(mouseOn ? st.mouse : far, mouseOn ? 1 - Math.exp(-dt * 14) : 1);

  const world = st.scroll + st.idle;
  universe.group.rotation.y = world;
  universe.update(dt);

  const introSpin = reduced ? 0 : -(1 - ie) * 2.8;
  const yaw = world + st.dragYaw + introSpin;
  const look = st.dragging ? 0 : 1;
  spin.rotation.y = yaw + st.mouseS.x * 0.16 * look;
  const bank = clamp(-st.scrollVel * 0.03, -0.1, 0.1);
  pivot.rotation.set(st.pitch - st.mouseS.y * 0.07 * look, 0, bank - st.mouseS.x * 0.025);

  updateEngine(dt);
  if (rocket) {
    const shake = reduced ? 0 : st.throttle;
    rocket.mesh.position.set((Math.random() - 0.5) * 0.004 * shake, 0, (Math.random() - 0.5) * 0.004 * shake);
    rocket.material.opacity = Math.min(1, st.intro * 1.8);
    if (rocket.material.opacity >= 1 && rocket.material.transparent) {
      rocket.material.transparent = false;
      rocket.material.needsUpdate = true;
    }
    plume.update(time, st.throttle);
  }
  bloom.strength = 0.62 + st.throttle * 0.1;

  // Camera drifts toward the cursor; the rocket's centre stays fixed on screen.
  const dist = view.dist * (1 + (reduced ? 0 : 0.3 * (1 - ie)));
  camera.position.set(st.mouseS.x * 0.9, st.mouseS.y * 0.55, dist);
  const sh = reduced ? 0 : st.throttle * 0.005;
  camera.lookAt((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, 0);

  scene.updateMatrixWorld();
  camera.updateMatrixWorld();

  // Hover: grab cursor, brighter reflections, and a label that follows the cursor.
  st.hover = mouseOn && !st.dragging && hitRocket(st.px, st.py);
  const grab = st.hover || st.dragging;
  if (st.hover !== lastGrab) {
    el.canvas.classList.toggle('is-grab', st.hover);
    el.tip.classList.toggle('is-on', st.hover);
    lastGrab = st.hover;
  }
  if (st.hover) el.tip.style.transform = `translate3d(${st.px + 18}px, ${st.py + 20}px, 0)`;
  // A gentle lift on hover; kept small so the metal doesn't flare.
  st.hoverK = damp(st.hoverK, grab ? 1 : 0, 8, dt);
  if (rocket) rocket.material.envMapIntensity = 1 + st.hoverK * 0.25;
  key.intensity = KEY + st.hoverK * 0.25;

  const now = performance.now();
  audio.update(st.throttle, now);
  updateHud(yaw, dt, now);
  composer.render(dt);
}

renderer.setAnimationLoop(frame);
