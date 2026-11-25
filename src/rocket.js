import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// Roket2: one mesh, long axis on FBX +x, units in cm. We stand it up nose-first
// on +y and centre it on its own middle so it spins about its centre of mass.
const AXIS_CENTER = 38.9;
const SCALE = 0.01;

// The FBX still points at the 4K PNGs from the archive. We swap in a compressed
// WebP set, so answer those requests with a blank pixel instead of fetching 40 MB.
const BLANK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export async function loadRocket(manager) {
  manager.setURLModifier((url) => (/\.png$/i.test(url) ? BLANK_PNG : url));
  const tl = new THREE.TextureLoader(manager);
  const [map, normalMap, orm, fbx] = await Promise.all([
    tl.loadAsync('/models/engine_basecolor.webp'),
    tl.loadAsync('/models/engine_normal.webp'),
    tl.loadAsync('/models/engine_orm.webp'),
    new FBXLoader(manager).loadAsync('/models/engine.fbx'),
  ]);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, normalMap, orm]) t.anisotropy = 8;

  let src;
  fbx.traverse((o) => { if (o.isMesh && !src) src = o; });

  const geo = src.geometry.clone();
  geo.clearGroups();
  geo.translate(-AXIS_CENTER, 0, 0);
  geo.scale(SCALE, SCALE, SCALE);
  geo.rotateZ(Math.PI / 2); // FBX +x → +y (nose up)
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  geo.translate(0, -(bb.min.y + bb.max.y) / 2, 0);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  const { min, max } = geo.boundingBox;
  const length = max.y - min.y;

  // Measure the nozzle exit: the widest ring of vertices near the tail, inside the body radius.
  const pos = geo.attributes.position;
  let nozzleR = 0;
  let bodyR = 0;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const rr = Math.hypot(pos.getX(i), pos.getZ(i));
    if (y < min.y + 0.03 && rr < 0.16) nozzleR = Math.max(nozzleR, rr);
    if (Math.abs(y) < 0.4 && rr < 0.3) bodyR = Math.max(bodyR, rr);
  }
  if (!nozzleR) nozzleR = 0.09;
  if (!bodyR) bodyR = 0.15;

  const mat = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    aoMap: orm,
    roughnessMap: orm,
    metalnessMap: orm,
    metalness: 1,
    roughness: 1,
    envMapIntensity: 1,
    transparent: true,
    opacity: 0,
  });

  const mesh = new THREE.Mesh(geo, mat);
  return { mesh, material: mat, length, top: max.y, bottom: min.y, nozzleR, bodyR };
}

const noise = /* glsl */ `
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
`;

const flameVert = /* glsl */ `
  uniform float uTime;
  uniform float uThrottle;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vUv = uv;
    vec3 p = position;
    float t = 1.0 - uv.y;
    p.xz *= 1.0 + 0.07 * sin(uTime * 47.0 + t * 14.0) * t;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const flameFrag = /* glsl */ `
  uniform float uTime;
  uniform float uThrottle;
  uniform float uIntensity;
  uniform float uReach;
  uniform float uSpeed;
  uniform float uFreq;
  uniform float uDiamonds;
  uniform float uEdge;
  uniform vec3 uHot;
  uniform vec3 uMid;
  uniform vec3 uCool;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  ${noise}
  void main() {
    float t = 1.0 - vUv.y;               // 0 at the nozzle lip, 1 at the tail
    float ang = vUv.x * 6.2831853;
    float n = fbm(vec3(cos(ang) * 1.3, sin(ang) * 1.3, t * uFreq - uTime * uSpeed));
    float facing = abs(dot(normalize(vN), normalize(vV)));
    float body = pow(facing, uEdge);
    float reach = uReach * mix(0.3, 1.0, uThrottle);
    float fade = 1.0 - smoothstep(reach * 0.2, reach, t + (n - 0.5) * 0.45);
    float lip = smoothstep(0.0, 0.035, t);
    float bands = mix(1.0, 0.62 + 0.38 * cos(t * 58.0 - uTime * 3.0), uDiamonds * exp(-t * 5.0));
    vec3 col = mix(uHot, uMid, smoothstep(0.02, 0.28, t));
    col = mix(col, uCool, smoothstep(0.28, 0.85, t));
    float a = body * fade * lip * bands * (0.5 + 0.95 * n) * uThrottle * uIntensity;
    gl_FragColor = vec4(col * a, 1.0);
  }
`;

const sparkVert = /* glsl */ `
  attribute float aSeed;
  attribute vec2 aDir;
  uniform float uTime;
  uniform float uThrottle;
  uniform float uLen;
  uniform float uScale;
  varying float vA;
  varying float vLife;
  void main() {
    float life = fract(uTime * (0.7 + aSeed * 0.9) + aSeed * 17.0);
    float spread = 0.06 + life * 0.42;
    vec3 p = vec3(aDir.x * spread, -life * uLen * (0.7 + aSeed * 0.5), aDir.y * spread);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (1.0 - life) * (0.016 + aSeed * 0.02) * uScale / max(-mv.z, 0.001);
    vA = (1.0 - life) * uThrottle;
    vLife = life;
  }
`;

const sparkFrag = /* glsl */ `
  varying float vA;
  varying float vLife;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float r2 = dot(p, p) * 4.0;
    if (r2 > 1.0) discard;
    vec3 col = mix(vec3(3.0, 2.2, 1.2), vec3(2.2, 0.6, 0.12), vLife);
    gl_FragColor = vec4(col * (1.0 - r2) * vA, 1.0);
  }
`;

function flame(radiusTop, radiusBottom, length, u) {
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 48, 48, true);
  geo.translate(0, -length / 2, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: flameVert,
    fragmentShader: flameFrag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 2;
  return m;
}

function flareTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,220,170,0.75)');
  grad.addColorStop(0.45, 'rgba(255,140,60,0.22)');
  grad.addColorStop(1, 'rgba(255,90,20,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Exhaust plume: hot core, flame body, long faint trail, nozzle flare, sparks and a heat light.
export function createPlume({ nozzleR }) {
  const group = new THREE.Group();
  const time = { value: 0 };
  const throttle = { value: 0 };
  const base = (o) => ({
    uTime: time,
    uThrottle: throttle,
    uIntensity: { value: o.intensity },
    uReach: { value: o.reach },
    uSpeed: { value: o.speed },
    uFreq: { value: o.freq },
    uDiamonds: { value: o.diamonds ?? 0 },
    uEdge: { value: o.edge ?? 1.6 },
    uHot: { value: new THREE.Color().setRGB(...o.hot) },
    uMid: { value: new THREE.Color().setRGB(...o.mid) },
    uCool: { value: new THREE.Color().setRGB(...o.cool) },
  });

  const R = nozzleR;
  // A sea-level style column (like the FMI launch shot): narrow, white at the
  // lip, amber through the body, thinning into a long faint trail.
  // Values stay modest: the layers add up, and ACES turns anything far past 1 into white haze.
  const core = flame(R * 0.78, R * 0.3, 0.85, base({
    intensity: 0.5, reach: 1.0, speed: 7.5, freq: 5, diamonds: 1, edge: 1.1,
    hot: [2.1, 1.7, 1.0], mid: [2.0, 1.05, 0.3], cool: [1.0, 0.3, 0.05],
  }));
  const body = flame(R * 0.92, R * 1.3, 2.1, base({
    intensity: 0.42, reach: 0.95, speed: 5.5, freq: 3.4, edge: 1.4,
    hot: [1.9, 1.15, 0.45], mid: [1.5, 0.58, 0.12], cool: [0.7, 0.16, 0.03],
  }));
  const trail = flame(R * 1.1, R * 2.2, 4.4, base({
    intensity: 0.12, reach: 0.92, speed: 3.0, freq: 2.0, edge: 2.2,
    hot: [1.1, 0.62, 0.25], mid: [0.85, 0.32, 0.08], cool: [0.4, 0.1, 0.03],
  }));
  group.add(trail, body, core);

  const flare = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flareTexture(),
    color: new THREE.Color().setRGB(1.1, 0.8, 0.5),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0,
  }));
  flare.position.y = -0.04;
  flare.renderOrder = 3;
  group.add(flare);

  const N = 260;
  const seed = new Float32Array(N);
  const dir = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    seed[i] = Math.random();
    const a = Math.random() * Math.PI * 2;
    const m = Math.pow(Math.random(), 0.5);
    dir[i * 2] = Math.cos(a) * m;
    dir[i * 2 + 1] = Math.sin(a) * m;
  }
  const sgeo = new THREE.BufferGeometry();
  sgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  sgeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  sgeo.setAttribute('aDir', new THREE.BufferAttribute(dir, 2));
  const sparkUniforms = { uTime: time, uThrottle: throttle, uLen: { value: 3.0 }, uScale: { value: 1600 } };
  const sparks = new THREE.Points(sgeo, new THREE.ShaderMaterial({
    uniforms: sparkUniforms,
    vertexShader: sparkVert,
    fragmentShader: sparkFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  sparks.frustumCulled = false;
  group.add(sparks);

  const light = new THREE.PointLight(0xff7424, 0, 0, 2);
  light.position.y = -0.5;
  group.add(light);

  group.visible = false;

  return {
    group,
    setScale(px) { sparkUniforms.uScale.value = px; },
    update(t, k) {
      time.value = t;
      throttle.value = k;
      group.visible = k > 0.002;
      const flicker = 0.88 + 0.12 * Math.sin(t * 53) * Math.sin(t * 31 + 1.3);
      flare.material.opacity = Math.min(1, k * 1.2);
      flare.scale.setScalar((0.16 + 0.14 * k) * flicker);
      light.intensity = k * 8 * flicker;
    },
  };
}
