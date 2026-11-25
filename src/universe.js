import * as THREE from 'three';

// A behfar-style particle universe: starfield, spiral galaxies, nebulae, a dust
// lane and near dust for parallax. Everything sits in one group centred on the
// rocket, so rotating the group reads as the camera orbiting the rocket.

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;
// Pixels per world unit at depth 1 for a 900px-tall, DPR 1 viewport (fov 30°).
// Sizes below are authored in CSS px at that reference and scale with the viewport.
const REF = (0.5 * 900) / Math.tan(15 * D2R);

export function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const vert = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uScale;
  uniform float uPixelRatio;
  uniform vec2 uMouse;
  uniform float uAspect;
  uniform float uRepel;
  uniform float uRadius;
  uniform float uTwinkle;
  uniform float uFade;
  uniform float uMaxSize;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec4 clip = projectionMatrix * mv;
    float depth = -mv.z;
    float push = 0.0;
    if (clip.w > 0.0) {
      // Part the particles around the cursor, in screen space.
      vec2 ndc = clip.xy / clip.w;
      vec2 d = ndc - uMouse;
      d.x *= uAspect;
      float dist = length(d);
      push = smoothstep(uRadius, 0.0, dist);
      push *= push;
      vec2 dir = d / max(dist, 1e-4);
      dir.x /= uAspect;
      ndc += dir * push * uRepel;
      clip.xy = ndc * clip.w;
    }
    gl_Position = clip;

    float tw = 1.0 + uTwinkle * 0.5 * sin(uTime * (0.7 + aPhase * 2.6) + aPhase * 40.0);
    float ps = aSize * uScale / max(depth, 0.001) * tw;
    // Sub-pixel points shimmer; draw them at 1.2px and dim them instead.
    float minPs = 1.2 * uPixelRatio;
    float dim = clamp(ps / minPs, 0.0, 1.0);
    gl_PointSize = clamp(max(ps, minPs), 0.0, uMaxSize * uPixelRatio);
    vColor = aColor * dim * (1.0 + push * 1.6);
    vAlpha = uFade * smoothstep(1.5, 8.0, depth);
  }
`;

const frag = /* glsl */ `
  uniform float uSoft;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float r2 = dot(p, p) * 4.0;
    if (r2 > 1.0) discard;
    float a = exp(-r2 * uSoft) * (1.0 - r2);
    gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
  }
`;

function material(shared, { soft = 3, maxSize = 48, twinkle = 0 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uSoft: { value: soft },
      uMaxSize: { value: maxSize },
      uTwinkle: { value: twinkle },
    },
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function points(count, fill, mat) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const s = fill(i, p, c);
    pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    size[i] = s;
    phase[i] = (i * 0.61803398875) % 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  return new THREE.Points(geo, mat);
}

function gauss(r) {
  let u = 0, v = 0;
  while (u === 0) u = r();
  while (v === 0) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}

function randomDir(r, out) {
  const z = r() * 2 - 1;
  const a = r() * TAU;
  const s = Math.sqrt(1 - z * z);
  return out.set(Math.cos(a) * s, z, Math.sin(a) * s);
}

// az 0 = straight ahead of the camera (−z), positive = to the right; el positive = up.
function dirFrom(az, el) {
  const a = az * D2R, e = el * D2R;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

function place(obj, { az, el, dist, tilt = [0, 0, 0] }) {
  const holder = new THREE.Group();
  holder.position.copy(dirFrom(az, el).multiplyScalar(dist));
  holder.lookAt(0, 0, 0);
  holder.rotateX(tilt[0] * D2R);
  holder.rotateY(tilt[1] * D2R);
  holder.rotateZ(tilt[2] * D2R);
  holder.add(obj);
  return holder;
}

function starfield(r, mat) {
  const white = new THREE.Color('#ffffff');
  const blue = new THREE.Color('#c8d8ff');
  const warm = new THREE.Color('#ffd7ad');
  const d = new THREE.Vector3();
  return points(15000, (i, p, c) => {
    randomDir(r, d);
    const dist = 170 + Math.pow(r(), 0.7) * 430;
    p.copy(d).multiplyScalar(dist);
    const bright = r() < 0.05;
    const px = bright ? 2.2 + r() * 2.6 : 0.8 + Math.pow(r(), 2.2) * 1.9;
    const t = r();
    c.copy(t < 0.6 ? white : t < 0.82 ? blue : warm);
    c.multiplyScalar(bright ? 1.8 + r() * 1.8 : 0.4 + r() * 0.9);
    return (px * dist) / REF;
  }, mat);
}

function nearDust(r, mat) {
  const d = new THREE.Vector3();
  const tint = new THREE.Color('#e9dccb');
  return points(1400, (i, p, c) => {
    randomDir(r, d);
    const dist = 22 + Math.pow(r(), 1.4) * 60;
    p.copy(d).multiplyScalar(dist);
    c.copy(tint).multiplyScalar(0.18 + r() * 0.35);
    return ((0.9 + r() * 1.3) * dist) / REF;
  }, mat);
}

function spiral(r, mat, o) {
  const {
    count = 13000, radius = 12, branches = 3, spin = 1.6, randomness = 0.42, power = 2.6,
    inside = '#ffb072', outside = '#5a7dff', brightness = 0.55, px = 1.5, dist = 160, flat = 0.32,
  } = o;
  const cin = new THREE.Color(inside);
  const cout = new THREE.Color(outside);
  const core = new THREE.Color('#fff1dc');
  const bulge = Math.floor(count * 0.12);
  return points(count, (i, p, c) => {
    if (i < bulge) {
      // Bright central bulge.
      const s = radius * 0.09;
      p.set(gauss(r) * s, gauss(r) * s * 0.6, gauss(r) * s);
      c.copy(core).multiplyScalar(brightness * (1.1 + r()));
      return ((px * (0.9 + r() * 0.8)) * dist) / REF;
    }
    const rad = Math.pow(r(), 1.5) * radius;
    const branch = ((i % branches) / branches) * TAU;
    const spinA = (rad / radius) * spin * TAU * 0.5;
    const off = () => Math.pow(r(), power) * (r() < 0.5 ? 1 : -1) * randomness * rad;
    p.set(Math.cos(branch + spinA) * rad + off(), off() * flat, Math.sin(branch + spinA) * rad + off());
    c.copy(cin).lerp(cout, Math.min(1, rad / radius));
    c.multiplyScalar(brightness * (0.45 + r() * 0.75));
    return ((px * (0.6 + r() * 0.9)) * dist) / REF;
  }, mat);
}

function cloud(r, mat, o) {
  const {
    count = 5000, sigma = [8, 5, 8], colors = ['#ff9a5c', '#5e7bff'], brightness = 0.05,
    px = [8, 26], dist = 150,
  } = o;
  const a = new THREE.Color(colors[0]);
  const b = new THREE.Color(colors[1]);
  return points(count, (i, p, c) => {
    p.set(gauss(r) * sigma[0], gauss(r) * sigma[1], gauss(r) * sigma[2]);
    const k = THREE.MathUtils.clamp(0.5 + p.x / (sigma[0] * 2.4) + gauss(r) * 0.15, 0, 1);
    // Fainter toward the edge so the cloud has no hard boundary.
    const edge = Math.exp(-(p.x * p.x) / (2 * sigma[0] * sigma[0]) - (p.y * p.y) / (2 * sigma[1] * sigma[1]));
    c.copy(a).lerp(b, k).multiplyScalar(brightness * (0.25 + r() * 0.6) * (0.35 + edge));
    const s = px[0] + r() * (px[1] - px[0]);
    return (s * dist) / REF;
  }, mat);
}

function ringNebula(r, mat, o) {
  const { radius = 7, dist = 140, brightness = 0.07 } = o;
  const ringA = new THREE.Color('#ff9447');
  const ringB = new THREE.Color('#ffcf8a');
  const coreC = new THREE.Color('#7fb4ff');
  return points(2600, (i, p, c) => {
    if (i < 700) {
      const s = radius * 0.32;
      p.set(gauss(r) * s, gauss(r) * s, gauss(r) * s * 0.5);
      c.copy(coreC).multiplyScalar(brightness * (1.2 + r() * 1.2));
      return ((12 + r() * 22) * dist) / REF;
    }
    const a = r() * TAU;
    const rr = radius * (1 + gauss(r) * 0.16);
    p.set(Math.cos(a) * rr + gauss(r) * 0.8, Math.sin(a) * rr * 0.92 + gauss(r) * 0.8, gauss(r) * 1.2);
    c.copy(ringA).lerp(ringB, r() * 0.6).multiplyScalar(brightness * (0.5 + r() * 1.1));
    return ((6 + r() * 20) * dist) / REF;
  }, mat);
}

function dustLane(r, mat, o) {
  const { length = 70, dist = 240, brightness = 0.32 } = o;
  const a = new THREE.Color('#ff8f6b');
  const b = new THREE.Color('#d8a6ff');
  const w = new THREE.Color('#fff0e0');
  return points(7000, (i, p, c) => {
    const x = gauss(r) * length * 0.42;
    const falloff = Math.exp(-Math.abs(x) / (length * 0.35));
    p.set(x, gauss(r) * 0.35 * (0.4 + falloff), gauss(r) * length * 0.05);
    c.copy(a).lerp(b, r()).lerp(w, falloff * 0.5).multiplyScalar(brightness * (0.3 + falloff) * (0.5 + r()));
    return ((0.9 + r() * 1.4) * dist) / REF;
  }, mat);
}

export function createUniverse() {
  const r = rng(20261125);
  const shared = {
    uTime: { value: 0 },
    uScale: { value: REF },
    uPixelRatio: { value: 1 },
    uMouse: { value: new THREE.Vector2(9, 9) },
    uAspect: { value: 1.6 },
    uRepel: { value: 0.045 },
    uRadius: { value: 0.24 },
    uFade: { value: 0 },
  };

  const mats = {
    stars: material(shared, { soft: 4.5, maxSize: 10, twinkle: 1 }),
    dust: material(shared, { soft: 4, maxSize: 6 }),
    galaxy: material(shared, { soft: 3.2, maxSize: 8 }),
    cloud: material(shared, { soft: 1.6, maxSize: 160 }),
  };

  const group = new THREE.Group();
  const spinners = [];

  group.add(starfield(r, mats.stars));
  group.add(nearDust(r, mats.dust));

  // Galaxies spread around the full circle, so every heading has something to look at.
  // The first two frame the opening view: one upper-left, one lower-right.
  const galaxies = [
    { az: -15, el: 7, dist: 170, tilt: [62, 0, 18], radius: 13, branches: 2, spin: 1.9, inside: '#ffb27a', outside: '#6f8cff' },
    { az: 14, el: -7, dist: 150, tilt: [74, 0, -12], radius: 8, branches: 4, spin: 1.3, inside: '#fff0d6', outside: '#c98a5a', brightness: 0.55 },
    { az: 58, el: 12, dist: 190, tilt: [35, 0, 40], radius: 15, branches: 3, spin: 1.5, inside: '#ffcf9a', outside: '#4f6dff' },
    { az: 112, el: -10, dist: 160, tilt: [70, 0, -30], radius: 11, branches: 2, spin: 2.2, inside: '#ffd2b0', outside: '#ff6f8a' },
    { az: 165, el: 9, dist: 210, tilt: [20, 0, 10], radius: 17, branches: 5, spin: 1.1, inside: '#fff4e2', outside: '#6aa0ff' },
    { az: 222, el: -5, dist: 170, tilt: [80, 0, 25], radius: 12, branches: 3, spin: 1.7, inside: '#ffb27a', outside: '#9b72ff' },
    { az: 280, el: 13, dist: 190, tilt: [50, 0, -45], radius: 10, branches: 2, spin: 2.0, inside: '#ffe0b8', outside: '#ff8a4c' },
    { az: 318, el: -11, dist: 160, tilt: [65, 0, 5], radius: 9, branches: 4, spin: 1.4, inside: '#fff1d8', outside: '#5f86ff' },
  ];
  for (const g of galaxies) {
    const pts = spiral(r, mats.galaxy, g);
    const holder = place(pts, g);
    spinners.push({ obj: pts, speed: (0.015 + r() * 0.02) * (r() < 0.5 ? 1 : -1) });
    group.add(holder);
  }

  // Ring nebula (the behfar blue-core, amber-ring look) and two soft clouds.
  group.add(place(ringNebula(r, mats.cloud, { radius: 6.5, dist: 140 }), { az: -38, el: 10, dist: 140, tilt: [0, 20, 0] }));
  group.add(place(ringNebula(r, mats.cloud, { radius: 8, dist: 180, brightness: 0.06 }), { az: 196, el: 14, dist: 180, tilt: [10, -25, 0] }));
  group.add(place(cloud(r, mats.cloud, { sigma: [16, 5, 9], colors: ['#ff9a5c', '#ffcf9a'], brightness: 0.03, dist: 200 }), { az: 21, el: 9, dist: 200, tilt: [0, 0, 14] }));
  group.add(place(cloud(r, mats.cloud, { sigma: [10, 7, 10], colors: ['#5e7bff', '#9b72ff'], brightness: 0.03, dist: 170 }), { az: 88, el: -4, dist: 170 }));
  group.add(place(cloud(r, mats.cloud, { sigma: [12, 6, 8], colors: ['#ff7a6b', '#5e7bff'], brightness: 0.03, dist: 180 }), { az: 250, el: 6, dist: 180 }));

  // Long edge-on dust lane just under the rocket's tail, like behfar's underline.
  // Its elevation is set from the layout (setLaneElevation) so it hugs the tail on any screen.
  const lane = place(dustLane(r, mats.galaxy, { length: 90, dist: 260 }), { az: 0, el: -9.6, dist: 260 });
  group.add(lane);
  group.add(place(dustLane(r, mats.galaxy, { length: 70, dist: 230, brightness: 0.22 }), { az: 150, el: 4, dist: 230, tilt: [0, 0, -6] }));

  return {
    group,
    uniforms: shared,
    materials: mats,
    update(dt) {
      for (const s of spinners) s.obj.rotation.y += s.speed * dt;
    },
    setTwinkle(on) {
      mats.stars.uniforms.uTwinkle.value = on ? 1 : 0;
    },
    setLaneElevation(deg) {
      lane.position.copy(dirFrom(0, deg).multiplyScalar(260));
      lane.rotation.set(0, 0, 0);
      lane.lookAt(0, 0, 0);
    },
  };
}
