import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { drapeGeo, flatUv, footGeo, forearmGeo, handGeo, headGeo, longHairGeo, shinGeo, shortHairGeo, thighGeo,
  torsoGeo, upperArmGeo, BODY } from './body';
import { glowUniforms, halos, LightPool } from './night';
import { faceTexture, Pedestrians } from './pedestrians';
import { MELA, TEAR, WALL_LOOP } from './melaSite';
import { MapData } from './types';

/*
 The Moti Jheel mela, a night fair on the open ground of Tulsi Upvan:
   rides      giant wheel, Columbus boat, chair swing (chakri), carousel (ghoda jhoola), wooden hindola
   stage      kavi sammelan: poets on white gaddis, banner, speakers, marigold, a seated audience
   stalls     toys and balloons, chaat / jalebi, bangles, cotton candy, under strings of coloured bulbs
   crowd      people strolling the aisles (Pedestrians on a small private street graph) + the seated audience
 Everything is procedural: vertex-coloured merged geometry for the solid parts, emissive octahedra plus additive
 glow sprites for the bulbs, and a handful of real point lights (LightPool) that follow the camera.
*/

const C = (h: string) => new THREE.Color(h);
const FEST = ['#d62828', '#f77f00', '#fcbf49', '#2a9d8f', '#3a86ff', '#e63946', '#9b5de5', '#00bbf9', '#ef476f', '#06d6a0'];
const BULB = ['#ffb347', '#ff5a4f', '#ffe14d', '#59e36b', '#4fa9ff', '#ff6fd0'];
const rnd = (seed: number) => { const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

// ---- geometry helpers -----------------------------------------------------------------------------

/** Collects vertex-coloured parts (position, normal, colour) and merges them into one geometry. */
class Geo {
  private parts: THREE.BufferGeometry[] = [];

  add(g: THREE.BufferGeometry, color: THREE.Color | string, m?: THREE.Matrix4): this {
    const x = g.index ? g.toNonIndexed() : g.clone();
    if (m) x.applyMatrix4(m);
    for (const k of Object.keys(x.attributes)) if (k !== 'position' && k !== 'normal') x.deleteAttribute(k);
    const c = new THREE.Color(color);
    const n = x.getAttribute('position').count;
    x.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]), 3));
    this.parts.push(x);
    return this;
  }
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: THREE.Color | string, ry = 0): this {
    return this.add(new THREE.BoxGeometry(sx, sy, sz), color, new THREE.Matrix4().makeRotationY(ry).setPosition(cx, cy, cz));
  }
  cyl(cx: number, y0: number, cz: number, r: number, h: number, color: THREE.Color | string, segs = 10, r2 = r): this {
    return this.add(new THREE.CylinderGeometry(r2, r, h, segs), color, new THREE.Matrix4().makeTranslation(cx, y0 + h / 2, cz));
  }
  sphere(cx: number, cy: number, cz: number, r: number, color: THREE.Color | string, sx = 1, sy = 1, sz = 1): this {
    return this.add(new THREE.SphereGeometry(r, 8, 6), color, new THREE.Matrix4().makeScale(sx, sy, sz).setPosition(cx, cy, cz));
  }
  /** thin rod between two points */
  rod(a: THREE.Vector3, b: THREE.Vector3, r: number, color: THREE.Color | string, segs = 5): this {
    const d = b.clone().sub(a), len = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    return this.add(new THREE.CylinderGeometry(r, r, len, segs), color, m);
  }
  build(): THREE.BufferGeometry {
    return mergeGeometries(this.parts)!;
  }
}

const litMat = (extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.25, ...extra });

/** Emissive bulbs: octahedra that can chase (phase 0..1) + glow sprites. Add `.object` to the scene or a moving group. */
class Bulbs {
  private list: { x: number; y: number; z: number; c: THREE.Color; phase: number; size: number }[] = [];
  add(x: number, y: number, z: number, color: string | THREE.Color, phase = -1, size = 1.2): void {
    this.list.push({ x, y, z, c: new THREE.Color(color), phase, size });
  }
  get count(): number { return this.list.length; }
  object(haloStrength = 0.75): THREE.Group {
    const out = new THREE.Group();
    if (!this.list.length) return out;
    const parts = this.list.map((b) => {
      const g = new THREE.OctahedronGeometry(0.055 * b.size, 0).toNonIndexed();
      g.deleteAttribute('normal');
      g.deleteAttribute('uv');
      g.translate(b.x, b.y, b.z);
      const n = g.getAttribute('position').count;
      g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [b.c.r, b.c.g, b.c.b][i % 3]), 3));
      g.setAttribute('phase', new THREE.Float32BufferAttribute(new Array(n).fill(b.phase), 1));
      return g;
    });
    const mesh = new THREE.Mesh(mergeGeometries(parts)!, glowMaterial());
    mesh.frustumCulled = false;
    out.add(mesh);
    out.add(halos(this.list.map((b) => ({ x: b.x, y: b.y, z: b.z, color: b.c, size: 0.32 * b.size, phase: b.phase })), haloStrength));
    return out;
  }
}

let glowMat: THREE.MeshBasicMaterial | null = null;
function glowMaterial(): THREE.MeshBasicMaterial {
  if (glowMat) return glowMat;
  glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false });
  glowMat.onBeforeCompile = (sh) => {
    sh.uniforms.time = glowUniforms.time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float phase;
uniform float time;`)
      .replace('#include <color_vertex>', `#include <color_vertex>
vColor *= phase < 0.0 ? 1.0 : 0.3 + 0.7 * step(0.5, fract(time * 1.3 - phase));`);
  };
  return glowMat;
}

/** Canvas banner: lines of text on a coloured ground with a border. */
function banner(w: number, h: number, bg: string, border: string,
                lines: { text: string; size: number; color: string; y: number }[]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = border;
  g.lineWidth = h * 0.045;
  g.strokeRect(g.lineWidth, g.lineWidth, w - 2 * g.lineWidth, h - 2 * g.lineWidth);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const face = "'Noto Sans Devanagari','Kohinoor Devanagari','Mangal','Devanagari Sangam MN','Nirmala UI',Arial,sans-serif";
  for (const l of lines) {
    g.font = `bold ${l.size}px ${face}`;
    g.fillStyle = l.color;
    g.fillText(l.text, w / 2, l.y, w * 0.92);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const bannerMat = (tex: THREE.Texture, glow = 0.7) =>
  new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color(glow, glow, glow), roughness: 0.8, side: THREE.DoubleSide });

// ---- rides ----------------------------------------------------------------------------------------

interface Ride { group: THREE.Group; update(t: number, dt: number): void; post: [number, number, number][]; light: [number, number, number, string] }

/** Giant wheel: legs, two rims with chasing bulbs, 16 hanging cabins that stay upright. Wheel plane = the z-y plane. */
function giantWheel(): Ride {
  const R = 11, HUB = 13.2, N = 16, group = new THREE.Group();
  const frame = new Geo();
  for (const sx of [-1.7, 1.7]) {
    for (const sz of [-7.5, 7.5]) frame.rod(new THREE.Vector3(sx, 0, sz), new THREE.Vector3(sx, HUB, 0), 0.24, '#d8d8d8');
    frame.rod(new THREE.Vector3(sx, 0.3, -7.5), new THREE.Vector3(sx, 0.3, 7.5), 0.12, '#bbbbbb');
    frame.rod(new THREE.Vector3(sx, 5.2, -3.2), new THREE.Vector3(sx, 5.2, 3.2), 0.1, '#bbbbbb');
  }
  frame.cyl(0, HUB - 0.35, 0, 0.45, 0, '#999999');
  frame.rod(new THREE.Vector3(-2.1, HUB, 0), new THREE.Vector3(2.1, HUB, 0), 0.3, '#888888');
  frame.box(0, 0.12, 0, 5, 0.24, 18, '#55504a');   // concrete footing
  group.add(new THREE.Mesh(frame.build(), litMat()));

  const wheel = new THREE.Group();
  wheel.position.y = HUB;
  const rim = new Geo(), bulbs = new Bulbs();
  const SEG = 40;
  for (const x of [-1.0, 1.0]) {
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
      const p0 = new THREE.Vector3(x, Math.cos(a0) * R, Math.sin(a0) * R), p1 = new THREE.Vector3(x, Math.cos(a1) * R, Math.sin(a1) * R);
      rim.rod(p0, p1, 0.1, i % 2 ? '#e8e8e8' : '#d03030');
      bulbs.add(x, Math.cos(a0) * (R + 0.18), Math.sin(a0) * (R + 0.18), BULB[i % BULB.length], (i % 8) / 8, 1.4);
      const r2 = R * 0.52;
      if (i % 2 === 0) rim.rod(new THREE.Vector3(x, Math.cos(a0) * r2, Math.sin(a0) * r2), new THREE.Vector3(x, Math.cos(a1 + 0.16) * r2, Math.sin(a1 + 0.16) * r2), 0.05, '#cccccc');
    }
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      rim.rod(new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, c * R, s * R), 0.055, '#dddddd');
      for (let j = 1; j <= 4; j++) bulbs.add(x, c * R * (0.2 + j * 0.2), s * R * (0.2 + j * 0.2), BULB[(k + j) % BULB.length], ((k + j * 2) % 8) / 8, 1.0);
    }
  }
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    rim.rod(new THREE.Vector3(-1, Math.cos(a) * R, Math.sin(a) * R), new THREE.Vector3(1, Math.cos(a) * R, Math.sin(a) * R), 0.07, '#cccccc');
  }
  for (let j = 0; j < 12; j++) bulbs.add(0, Math.cos(j * 0.5236) * 1.6, Math.sin(j * 0.5236) * 1.6, BULB[j % 6], j / 12, 1.3);   // hub star
  wheel.add(new THREE.Mesh(rim.build(), litMat()), bulbs.object(0.8));
  group.add(wheel);

  // cabin: open bench seat with a canopy; colour variants share geometry
  const cabinGeo = (canopy: string) => {
    const g = new Geo();
    g.box(0, -1.35, 0, 1.9, 0.1, 1.2, '#3a3a3c');
    g.box(0, -1.0, -0.55, 1.9, 0.7, 0.08, canopy);
    g.box(0, -1.15, 0.45, 1.7, 0.1, 0.4, '#8a5a2a');
    g.box(-0.93, -0.95, 0, 0.06, 0.8, 1.2, canopy);
    g.box(0.93, -0.95, 0, 0.06, 0.8, 1.2, canopy);
    for (const sx of [-0.9, 0.9]) for (const sz of [-0.55, 0.55]) g.rod(new THREE.Vector3(sx, -1.3, sz), new THREE.Vector3(sx, -0.1, sz), 0.03, '#dddddd');
    g.box(0, -0.06, 0, 2.1, 0.08, 1.4, canopy);
    g.rod(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.1, 0), 0.04, '#aaaaaa');
    g.rod(new THREE.Vector3(-0.9, -0.06, 0), new THREE.Vector3(0, 0.55, 0), 0.03, '#cccccc');
    g.rod(new THREE.Vector3(0.9, -0.06, 0), new THREE.Vector3(0, 0.55, 0), 0.03, '#cccccc');
    return g.build();
  };
  const variants = ['#d62828', '#f77f00', '#2a9d8f', '#3a86ff'].map(cabinGeo);
  const cabinBulb = new Bulbs();
  for (const dx of [-0.7, 0, 0.7]) cabinBulb.add(dx, -0.14, 0, '#ffd47a', -1, 1.1);
  const cabinGlow = cabinBulb.object(0.5);
  const cabins: THREE.Group[] = [];
  const cm = litMat();
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    const g = new THREE.Group();
    g.position.set(0, Math.cos(a) * R, Math.sin(a) * R);
    g.add(new THREE.Mesh(variants[k % 4], cm));
    g.add(cabinGlow.clone());
    wheel.add(g);
    cabins.push(g);
  }
  return {
    group, post: [[0, -6, 1.2], [0, 6, 1.2], [0, 0, 1.6]], light: [0, 4, 0, '#ffb060'],
    update: (t, dt) => {
      wheel.rotation.x += dt * 0.22;
      for (const c of cabins) c.rotation.x = -wheel.rotation.x;
    },
  };
}

/** Columbus boat: a big pendulum with a painted boat full of benches. Swings in the y-z plane. */
function columbus(): Ride {
  const group = new THREE.Group(), PIV = 8.8, L = 7.4;
  const frame = new Geo();
  for (const sx of [-3.4, 3.4]) {
    for (const sz of [-5.2, 5.2]) frame.rod(new THREE.Vector3(sx, 0, sz), new THREE.Vector3(sx, PIV, 0), 0.22, '#e8c84a');
    frame.rod(new THREE.Vector3(sx, 2.5, -2.7), new THREE.Vector3(sx, 2.5, 2.7), 0.1, '#c9a93a');
  }
  frame.rod(new THREE.Vector3(-3.6, PIV, 0), new THREE.Vector3(3.6, PIV, 0), 0.28, '#777777');
  frame.box(0, 0.1, 0, 8, 0.2, 12, '#4a463f');
  group.add(new THREE.Mesh(frame.build(), litMat()));
  const fb = new Bulbs();
  for (let i = 0; i <= 10; i++) { fb.add(-3.4, 0.4 + i * 0.85, 0.0 + (5.2 - i * 0.52) * 1, BULB[i % 6], i / 10); fb.add(3.4, 0.4 + i * 0.85, (5.2 - i * 0.52), BULB[(i + 2) % 6], i / 10); }
  group.add(fb.object(0.7));

  const pend = new THREE.Group();
  pend.position.y = PIV;
  const arm = new Geo();
  for (const sx of [-2.4, 2.4]) arm.rod(new THREE.Vector3(sx, 0, 0), new THREE.Vector3(sx, -L, 0), 0.1, '#cccccc');
  arm.rod(new THREE.Vector3(-2.4, -L * 0.5, 0), new THREE.Vector3(2.4, -L * 0.5, 0), 0.06, '#cccccc');
  // boat
  const y0 = -L - 0.4;
  arm.box(0, y0, 0, 3.4, 0.5, 8.4, '#b3261e');
  arm.box(0, y0 + 0.5, 0, 3.0, 0.5, 8.0, '#f2c21b');
  for (const sz of [-1, 1]) {
    arm.box(0, y0 + 0.55, sz * 4.5, 2.4, 0.9, 1.6, '#b3261e', 0);
    arm.box(0, y0 + 1.2, sz * 5.1, 1.8, 0.8, 0.9, '#f2c21b', 0);
  }
  for (const sx of [-1.75, 1.75]) arm.box(sx, y0 + 1.0, 0, 0.12, 0.9, 8.6, '#ffffff');
  for (let r = -3; r <= 3; r++) arm.box(0, y0 + 0.9, r * 1.05, 2.6, 0.1, 0.5, '#7a4a22');
  for (const sx of [-1.7, 1.7]) arm.rod(new THREE.Vector3(sx, y0 + 0.9, -4), new THREE.Vector3(sx, y0 + 2.0, -4), 0.05, '#ffffff');
  arm.cyl(0, y0 + 1.0, -5.4, 0.08, 2.6, '#dddddd');                      // bow pole with a flag
  arm.box(0.45, y0 + 3.2, -5.4, 0.9, 0.5, 0.04, '#ff6a00');
  pend.add(new THREE.Mesh(arm.build(), litMat()));
  const bb = new Bulbs();
  for (let i = 0; i < 20; i++) { const z = -4.2 + i * 0.44; bb.add(-1.78, y0 + 1.5, z, BULB[i % 6], (i % 6) / 6, 1.1); bb.add(1.78, y0 + 1.5, z, BULB[(i + 1) % 6], (i % 6) / 6, 1.1); }
  for (let i = 0; i < 10; i++) bb.add(0, y0 + 0.18, -3.2 + i * 0.7, '#ffd68a', -1, 1.0);
  pend.add(bb.object(0.7));
  group.add(pend);
  return {
    group, post: [[-3.4, -5.2, 0.9], [3.4, -5.2, 0.9], [-3.4, 5.2, 0.9], [3.4, 5.2, 0.9], [0, 0, 1.5]], light: [0, 3, 0, '#ffc870'],
    update: (t) => { pend.rotation.x = 0.95 * Math.sin(t * 0.85) * (0.75 + 0.25 * Math.sin(t * 0.13)); },
  };
}

/** Chair swing (chakri): a tower with a spinning umbrella; 16 chairs on chains fly outwards as it speeds up. */
function chairSwing(): Ride {
  const group = new THREE.Group(), H = 10.5, N = 16;
  const base = new Geo();
  base.cyl(0, 0, 0, 5.4, 0.35, '#3a3633', 20);
  base.cyl(0, 0.35, 0, 0.45, H - 0.35, '#e8e0d0', 12, 0.6);
  base.cyl(0, 0.35, 0, 0.9, 1.4, '#b3261e', 12, 1.2);
  group.add(new THREE.Mesh(base.build(), litMat()));
  const head = new THREE.Group();
  head.position.y = H;
  const top = new Geo();
  const cone = new THREE.ConeGeometry(5.3, 1.9, 24, 1, true).toNonIndexed();
  const pos = cone.getAttribute('position');
  const cols: number[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    const a = Math.atan2(pos.getZ(i), pos.getX(i)) + Math.PI;
    const c = C(Math.floor((a / (Math.PI * 2)) * 24) % 2 ? '#d62828' : '#f2c21b');
    for (let k = 0; k < 3; k++) cols.push(c.r, c.g, c.b);
  }
  cone.deleteAttribute('uv');
  cone.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const coneMesh = new THREE.Mesh(cone, litMat({ side: THREE.DoubleSide }));
  coneMesh.position.y = 0.6;
  head.add(coneMesh);
  top.cyl(0, -0.4, 0, 0.7, 0.8, '#b3261e', 12);
  top.cyl(0, 1.5, 0, 0.12, 1.0, '#ffd24a', 6);
  top.add(new THREE.SphereGeometry(0.3, 10, 8), '#ffd24a', new THREE.Matrix4().makeTranslation(0, 2.6, 0));
  const hb = new Bulbs();
  for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2; hb.add(Math.cos(a) * 5.35, -0.32, Math.sin(a) * 5.35, BULB[i % 6], (i % 8) / 8, 1.3); }
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; hb.add(Math.cos(a) * 2.6, 0.75, Math.sin(a) * 2.6, BULB[(i + 3) % 6], (i % 8) / 8, 1.0); }
  head.add(new THREE.Mesh(top.build(), litMat()), hb.object(0.8));
  const chairGeo = (c: string) => {
    const g = new Geo();
    g.rod(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -4.4, 0), 0.025, '#cfcfcf', 4);
    g.box(0, -4.75, 0, 0.5, 0.07, 0.5, c);
    g.box(0, -4.5, 0.25, 0.5, 0.45, 0.06, c);
    g.rod(new THREE.Vector3(-0.22, -4.72, -0.2), new THREE.Vector3(0.22, -4.72, -0.2), 0.02, '#dddddd', 4);
    g.box(0, -5.05, -0.16, 0.4, 0.05, 0.12, '#444');
    return g.build();
  };
  const chairs: THREE.Group[] = [];
  const cmat = litMat();
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    const g = new THREE.Group();
    g.position.set(Math.cos(a) * 4.5, -0.25, Math.sin(a) * 4.5);
    g.rotation.y = -a;
    g.userData.a = a;
    g.add(new THREE.Mesh(chairGeo(FEST[k % FEST.length]), cmat));
    head.add(g);
    chairs.push(g);
  }
  group.add(head);
  let spin = 0;
  return {
    group, post: [[0, 0, 1.4]], light: [0, 6, 0, '#ffc060'],
    update: (t, dt) => {
      const speed = 0.2 + 1.3 * (0.5 - 0.5 * Math.cos(t * 0.17));  // winds up and down
      spin += speed * dt;
      head.rotation.y = spin;
      const tilt = 0.62 * Math.min(1, (speed - 0.2) / 1.0);
      for (const c of chairs) { c.rotation.z = tilt; c.rotation.x = 0; }
    },
  };
}

/** Carousel (ghoda jhoola): striped canopy, brass poles and 8 horses that rise and fall. */
function carousel(): Ride {
  const group = new THREE.Group();
  const base = new Geo();
  base.cyl(0, 0, 0, 4.9, 0.4, '#2e2a27', 24);
  group.add(new THREE.Mesh(base.build(), litMat()));
  const spin = new THREE.Group();
  spin.position.y = 0.4;
  const g = new Geo();
  g.cyl(0, 0, 0, 4.5, 0.12, '#c9a34a', 24);
  g.cyl(0, 0.1, 0, 0.55, 5.0, '#c0392b', 12);
  g.cyl(0, 3.0, 0, 0.5, 0.3, '#ffd24a', 12);
  const cone = new THREE.ConeGeometry(5.5, 1.9, 24, 1, true).toNonIndexed();
  const pos = cone.getAttribute('position');
  const cols: number[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    const a = Math.atan2(pos.getZ(i), pos.getX(i)) + Math.PI;
    const c = C(Math.floor((a / (Math.PI * 2)) * 16) % 2 ? '#fff4d6' : '#b3261e');
    for (let k = 0; k < 3; k++) cols.push(c.r, c.g, c.b);
  }
  cone.deleteAttribute('uv');
  cone.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const coneMesh = new THREE.Mesh(cone, litMat({ side: THREE.DoubleSide }));
  coneMesh.position.y = 6.15;
  spin.add(coneMesh);
  g.cyl(0, 4.95, 0, 5.6, 0.25, '#ffd24a', 24);
  g.add(new THREE.SphereGeometry(0.28, 8, 6), '#ffd24a', new THREE.Matrix4().makeTranslation(0, 7.15, 0));
  const bulbs = new Bulbs();
  for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; bulbs.add(Math.cos(a) * 5.6, 5.1, Math.sin(a) * 5.6, BULB[i % 6], (i % 8) / 8, 1.3); }
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; bulbs.add(Math.cos(a) * 4.5, 0.3, Math.sin(a) * 4.5, BULB[(i + 2) % 6], (i % 8) / 8, 1.0); }
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; bulbs.add(Math.cos(a) * 0.62, 1.0 + i * 0.5, Math.sin(a) * 0.62, '#ffe6a0', -1, 1.0); }
  spin.add(new THREE.Mesh(g.build(), litMat()), bulbs.object(0.8));
  const horse = (color: string) => {
    const h = new Geo();
    h.box(0, 1.0, 0, 0.42, 0.5, 1.15, color);
    h.add(new THREE.BoxGeometry(0.22, 0.7, 0.3), color, new THREE.Matrix4().makeRotationX(0.5).setPosition(0, 1.45, -0.62));
    h.add(new THREE.BoxGeometry(0.2, 0.28, 0.5), color, new THREE.Matrix4().makeRotationX(-0.25).setPosition(0, 1.78, -0.88));
    h.box(0, 1.42, -0.62, 0.06, 0.65, 0.34, '#2a1a10');                      // mane
    h.box(0, 1.0, 0.7, 0.07, 0.5, 0.07, '#2a1a10');                           // tail
    for (const sx of [-0.14, 0.14]) for (const sz of [-0.4, 0.4]) h.box(sx, 0.55, sz, 0.12, 0.5, 0.12, color);
    h.box(0, 1.28, -0.1, 0.46, 0.08, 0.5, '#b3261e');                         // saddle
    h.cyl(0, -0.2, -0.05, 0.035, 3.0, '#e0b040', 6);                           // brass pole
    return h.build();
  };
  const horses: THREE.Group[] = [];
  const hm = litMat();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const hg = new THREE.Group();
    hg.position.set(Math.cos(a) * 3.3, 0.5, Math.sin(a) * 3.3);
    hg.rotation.y = -a;
    hg.userData.k = k;
    hg.add(new THREE.Mesh(horse(['#f4f0e6', '#7a4a22', '#2a2522', '#c9a06a'][k % 4]), hm));
    spin.add(hg);
    horses.push(hg);
  }
  group.add(spin);
  return {
    group, post: [[0, 0, 5.0]], light: [0, 5, 0, '#ffb870'],
    update: (t, dt) => {
      spin.rotation.y += dt * 0.55;
      for (const h of horses) h.position.y = 0.55 + 0.35 * Math.sin(t * 2.0 + h.userData.k * 1.7);
    },
  };
}

/** Hindola: the old wooden, hand-turned wheel with six cradles. */
function hindola(): Ride {
  const group = new THREE.Group(), HUB = 4.6, R = 3.3, N = 6;
  const frame = new Geo();
  for (const sx of [-1.4, 1.4]) for (const sz of [-2.6, 2.6]) frame.rod(new THREE.Vector3(sx, 0, sz), new THREE.Vector3(sx, HUB, 0), 0.12, '#7a4a22');
  frame.rod(new THREE.Vector3(-1.6, HUB, 0), new THREE.Vector3(1.6, HUB, 0), 0.14, '#5b3a1c');
  frame.box(0, 0.05, 0, 3.6, 0.1, 6.4, '#5a4a38');
  group.add(new THREE.Mesh(frame.build(), litMat({ metalness: 0.05 })));
  const wheel = new THREE.Group();
  wheel.position.y = HUB;
  const w = new Geo(), bulbs = new Bulbs();
  for (const x of [-0.9, 0.9]) for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2, b = ((k + 1) / N) * Math.PI * 2;
    w.rod(new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, Math.cos(a) * R, Math.sin(a) * R), 0.06, '#8a5a2a');
    w.rod(new THREE.Vector3(x, Math.cos(a) * R, Math.sin(a) * R), new THREE.Vector3(x, Math.cos(b) * R, Math.sin(b) * R), 0.06, '#8a5a2a');
    bulbs.add(x, Math.cos(a) * R, Math.sin(a) * R, BULB[k % 6], (k % 6) / 6, 1.0);
  }
  wheel.add(new THREE.Mesh(w.build(), litMat({ metalness: 0.05 })), bulbs.object(0.6));
  const cradle = (c: string) => {
    const g = new Geo();
    g.box(0, -0.75, 0, 1.3, 0.08, 0.8, '#7a4a22');
    g.box(0, -0.45, -0.38, 1.3, 0.6, 0.05, c);
    g.box(-0.63, -0.45, 0, 0.05, 0.6, 0.8, c);
    g.box(0.63, -0.45, 0, 0.05, 0.6, 0.8, c);
    g.box(0, 0.05, 0, 1.5, 0.05, 1.0, c);
    for (const sx of [-0.62, 0.62]) for (const sz of [-0.35, 0.35]) g.rod(new THREE.Vector3(sx, -0.7, sz), new THREE.Vector3(sx, 0, sz), 0.02, '#ddd', 4);
    return g.build();
  };
  const cm = litMat({ metalness: 0.05 }), cabins: THREE.Group[] = [];
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    const g = new THREE.Group();
    g.position.set(0, Math.cos(a) * R, Math.sin(a) * R);
    g.add(new THREE.Mesh(cradle(FEST[(k * 3) % FEST.length]), cm));
    wheel.add(g);
    cabins.push(g);
  }
  group.add(wheel);
  return {
    group, post: [[0, 0, 2.1]], light: [0, 3, 0, '#ffc070'],
    update: (t, dt) => {
      wheel.rotation.x += dt * (0.3 + 0.25 * Math.sin(t * 0.4));
      for (const c of cabins) c.rotation.x = -wheel.rotation.x;
    },
  };
}

// ---- people ---------------------------------------------------------------------------------------

type PersonStyle = { top: string; bottom: string; skin: string; hair: string; woman: boolean; pose: 'sit' | 'stand'; wave?: boolean };

/** A person as one merged, vertex-coloured geometry (position, normal, uv, colour): cross-legged on the floor or standing. */
function person(st: PersonStyle): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const put = (g: THREE.BufferGeometry, color: string, m: THREE.Matrix4, face = false) => {
    const x = g.index ? g.toNonIndexed() : g.clone();
    if (!face) flatUv(x, 0.02, 0.98);
    x.applyMatrix4(m);
    const c = new THREE.Color(color), n = x.getAttribute('position').count;
    x.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]), 3));
    for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) x.deleteAttribute(k);
    parts.push(x);
  };
  const sit = st.pose === 'sit';
  const down = sit ? -(BODY.hipY - 0.07) : 0;
  const T = (x = 0, y = 0, z = 0) => new THREE.Matrix4().makeTranslation(x, y + down, z);
  put(torsoGeo(10), st.top, T());
  put(headGeo(10), st.skin, T(), true);
  put(st.woman ? longHairGeo() : shortHairGeo(), st.hair, T());
  if (st.woman) put(drapeGeo(), st.pose === 'sit' ? st.top : st.bottom, T());
  for (const s of [-1, 1]) {
    // arms
    const sh = new THREE.Vector3(s * BODY.shoulderX, BODY.shoulderY + down, 0);
    const raised = !sit && st.wave && s === 1;
    const upRot = new THREE.Matrix4().makeRotationX(raised ? -2.3 : sit ? -0.25 : 0.0);
    put(upperArmGeo(6), st.top, new THREE.Matrix4().makeTranslation(sh.x, sh.y, sh.z).multiply(upRot));
    const el = new THREE.Vector3(0, -BODY.upperArm, 0).applyMatrix4(upRot).add(sh);
    const foreRot = new THREE.Matrix4().makeRotationX(raised ? -2.5 : sit ? 1.3 : 0.15);
    const fm = new THREE.Matrix4().makeTranslation(el.x, el.y, el.z).multiply(foreRot);
    put(forearmGeo(6), st.top, fm);
    put(handGeo(), st.skin, fm);
    // legs
    if (sit) {
      const a = -s * 0.5;
      const hip = new THREE.Vector3(s * BODY.hipX, 0.07, 0);
      const tm = new THREE.Matrix4().makeTranslation(hip.x, hip.y, hip.z).multiply(new THREE.Matrix4().makeRotationY(a)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
      put(thighGeo(6), st.bottom, tm);
      const knee = new THREE.Vector3(0, 0, -BODY.thigh).applyMatrix4(new THREE.Matrix4().makeRotationY(a)).add(hip);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(-s * 0.9, -0.05, 0.5).normalize());
      const sm = new THREE.Matrix4().compose(knee, q, new THREE.Vector3(1, 1, 1));
      put(shinGeo(6), st.bottom, sm);
      put(footGeo(), st.skin, sm);
    } else {
      const hm = T(s * BODY.hipX, BODY.hipY);
      put(thighGeo(6), st.bottom, hm);
      const km = hm.clone().multiply(new THREE.Matrix4().makeTranslation(0, -BODY.thigh, 0));
      put(shinGeo(6), st.bottom, km);
      put(footGeo(), st.skin, km);
    }
  }
  const g = mergeGeometries(parts)!;
  return g;
}

/** Woven cloth for the boundary: 0 maroon-and-gold shamiana stripes, 1 faded blue tarpaulin, 2 old printed blanket. */
function clothTexture(kind: number): THREE.CanvasTexture {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  if (kind === 0) {
    const cols = ['#7e1a1d', '#e0a93a', '#17406f', '#e0a93a', '#7e1a1d', '#f1e6c8'];
    for (let i = 0; i < 8; i++) { g.fillStyle = cols[i % cols.length]; g.fillRect(i * 32, 0, 32, S); }
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 8; i++) g.fillRect(i * 32 + 14, 0, 4, S);
  } else if (kind === 1) {
    g.fillStyle = '#2f5f97';
    g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillRect(0, 0, S, 3); g.fillRect(0, S / 2, S, 2); g.fillRect(0, S - 3, S, 3);
    g.fillStyle = '#c9ced4';
    for (const x of [8, 128, 248]) for (const y of [8, S - 8]) { g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); }
  } else {
    g.fillStyle = '#f0e4c0';
    g.fillRect(0, 0, S, S);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      g.fillStyle = (x + y) % 2 ? '#a3342b' : '#2e6b4f';
      g.fillRect(x * 64 + 4, y * 64 + 4, 56, 56);
      g.fillStyle = '#f2c14e';
      g.beginPath(); g.arc(x * 64 + 32, y * 64 + 32, 9, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f0e4c0';
      g.beginPath(); g.arc(x * 64 + 32, y * 64 + 32, 4, 0, Math.PI * 2); g.fill();
    }
  }
  // weave, dirt and old creases
  for (let y = 0; y < S; y += 2) { g.fillStyle = `rgba(0,0,0,${0.04 + (y % 8) * 0.004})`; g.fillRect(0, y, S, 1); }
  for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(60,45,30,${0.03 + rnd(i) * 0.07})`; g.fillRect(rnd(i + 3) * S, rnd(i + 9) * S, 3 + rnd(i + 1) * 30, 1 + rnd(i + 5) * 3); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// ---- the mela -------------------------------------------------------------------------------------

export class Mela {
  readonly group = new THREE.Group();
  /** solid circles for collision: [x, z, r] */
  readonly posts: [number, number, number][] = [];
  /** collision rings for the boundary cloth (thin quads; none across the tear) */
  readonly walls: [number, number][][] = [];
  readonly crowd: Pedestrians;
  private rides: Ride[] = [];
  private t = 0;

  constructor(map: MapData, lights: LightPool | null, desktop: boolean) {
    this.buildGround();
    this.addRide(giantWheel(), 6, 172, Math.PI / 2, lights);
    this.addRide(columbus(), 92, 146, 0, lights);
    this.addRide(chairSwing(), 90, 184, 0, lights);
    this.addRide(carousel(), 14, 208, 0, lights);
    this.addRide(hindola(), 82, 208, 0, lights);
    this.buildStage(lights, desktop);
    this.buildStalls(lights);
    this.buildGate(lights);
    this.buildMasts(lights);
    this.buildWalls(lights);

    this.crowd = new Pedestrians(this.aisles(map), desktop ? 90 : 45, true);
    this.crowd.setCount(desktop ? 90 : 45);
    this.group.add(this.crowd.group);
  }

  private addRide(r: Ride, x: number, z: number, ry: number, lights: LightPool | null): void {
    r.group.position.set(x, 0, z);
    r.group.rotation.y = ry;
    this.group.add(r.group);
    this.rides.push(r);
    const c = Math.cos(ry), s = Math.sin(ry);
    for (const [px, pz, pr] of r.post) this.posts.push([x + px * c + pz * s, z - px * s + pz * c, pr]);
    lights?.add(x, r.light[1], z, r.light[3], 230, 34);
  }

  update(dt: number, fx: number, fz: number, dirX: number, dirZ: number, px: number, pz: number): void {
    this.t += dt;
    const far = Math.hypot(fx - 50, fz - 170) > 260;
    if (far) return;
    for (const r of this.rides) r.update(this.t, dt);
    this.crowd.update(dt, fx, fz, dirX, dirZ, px, pz);
  }

  // ground: trodden dirt over the park grass, a darker packed aisle, and white dari sheets under the audience
  private buildGround(): void {
    const g = new Geo();
    const sh = new THREE.Shape([[MELA.x0, MELA.z0], [MELA.x1, MELA.z0], [MELA.x1, MELA.z1 - 4], [MELA.x0 + 10, MELA.z1 - 4], [MELA.x0, MELA.z1 - 12]].map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2);   // shape y = -z; after the turn it lies flat, facing up
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setY(i, 0.05);
    g.add(geo.index ? geo.toNonIndexed() : geo, '#6f624d');
    g.box(MELA.cx, 0.07, 170, 7, 0.02, 100, '#7b6d56');
    const m = new THREE.Mesh(g.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
    m.receiveShadow = true;
    this.group.add(m);
    // audience dari
    const d = new Geo();
    d.box(MELA.cx, 0.09, 142, 34, 0.04, 22, '#c9c5b6');
    for (let i = 0; i < 12; i++) d.box(MELA.cx - 17 + i * 3.1, 0.115, 142, 0.05, 0.01, 22, '#cfc9b8');
    const dm = new THREE.Mesh(d.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    dm.receiveShadow = true;
    this.group.add(dm);
  }

  private buildStage(lights: LightPool | null, desktop: boolean): void {
    const cx = MELA.cx, cz = 120, W = 17, D = 8, SH = 1.3;
    const g = new Geo(), bulbs = new Bulbs();
    g.box(cx, SH / 2, cz, W, SH, D, '#6b4a2a');
    g.box(cx, SH + 0.04, cz, W - 0.4, 0.08, D - 0.4, '#e9e6dc');                                     // white gaddi
    g.box(cx, SH + 0.04, cz + 1.5, 10, 0.1, 2.8, '#d8d3c4');                                          // second sheet
    for (let i = 0; i < 9; i++) g.cyl(cx - 6 + i * 1.5, SH + 0.1, cz - 2.6, 0.2, 1.2, i % 2 ? '#b3261e' : '#e9c46a', 8, 0.2); // takiya
    for (const sx of [-1, 1]) {
      g.box(cx + sx * 6, 0.5, cz + D / 2 + 1.0, 1.4, 1.0, 0.5, '#8a5a2a');                          // steps
      for (let k = 0; k < 3; k++) g.box(cx + sx * 9.5, 0.5 + k * 1.0, cz + 2.4, 1.2, 0.95, 1.2, '#161616');   // speaker stacks
    }
    g.box(cx - 3.6, SH + 0.45, cz + 3.0, 0.9, 0.9, 0.7, '#6b3d1f');                                     // podium
    g.box(cx - 3.6, SH + 1.0, cz + 2.8, 0.04, 0.5, 0.04, '#222');
    // truss, pillars, roof
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.rod(new THREE.Vector3(cx + sx * (W / 2 - 0.2), SH, cz + sz * (D / 2 - 0.2)), new THREE.Vector3(cx + sx * (W / 2 - 0.2), 7.4, cz + sz * (D / 2 - 0.2)), 0.16, '#8f8f94');
    g.box(cx, 7.5, cz + D / 2 - 0.2, W, 0.5, 0.5, '#9a9aa0');
    g.box(cx, 7.5, cz - D / 2 + 0.2, W, 0.5, 0.5, '#9a9aa0');
    for (const sx of [-1, 1]) g.box(cx + sx * (W / 2 - 0.2), 7.5, cz, 0.5, 0.5, D, '#9a9aa0');
    g.add(new THREE.ConeGeometry(W * 0.64, 2.4, 4, 1).rotateY(Math.PI / 4), '#f2e6c9', new THREE.Matrix4().makeScale(1, 1, D / W * 1.05).setPosition(cx, 8.95, cz));
    for (let i = 0; i < 12; i++) g.box(cx - W / 2 + 0.7 + i * (W - 1.4) / 11, 7.15, cz + D / 2, 0.5, 0.4, 0.04, FEST[i % FEST.length]);   // valance
    // marigold garlands: strings of orange and yellow along the front of the truss and down the pillars
    const marigold = (a: THREE.Vector3, b: THREE.Vector3, sag: number, n: number) => {
      for (let i = 0; i <= n; i++) {
        const t = i / n, p = a.clone().lerp(b, t);
        p.y -= Math.sin(t * Math.PI) * sag;
        g.sphere(p.x, p.y, p.z, 0.11, i % 3 === 0 ? '#f9a825' : '#ef6c00', 1, 1, 1);
      }
    };
    marigold(new THREE.Vector3(cx - W / 2, 7.2, cz + D / 2), new THREE.Vector3(cx, 7.2, cz + D / 2), 0.7, 20);
    marigold(new THREE.Vector3(cx, 7.2, cz + D / 2), new THREE.Vector3(cx + W / 2, 7.2, cz + D / 2), 0.7, 20);
    for (let i = 0; i < 4; i++) marigold(new THREE.Vector3(cx - W / 2 + i * 2.2, SH + 0.15, cz + D / 2 - 0.05), new THREE.Vector3(cx - W / 2 + (i + 1) * 2.2, SH + 0.15, cz + D / 2 - 0.05), 0.35, 8);
    for (let i = 0; i < 4; i++) marigold(new THREE.Vector3(cx + W / 2 - (i + 1) * 2.2, SH + 0.15, cz + D / 2 - 0.05), new THREE.Vector3(cx + W / 2 - i * 2.2, SH + 0.15, cz + D / 2 - 0.05), 0.35, 8);
    // stage lights on the truss
    for (let i = 0; i < 9; i++) {
      const x = cx - W / 2 + 1 + i * (W - 2) / 8;
      g.box(x, 7.1, cz + D / 2 - 0.5, 0.45, 0.45, 0.45, '#1b1b1e');
      const c = ['#ff8a3d', '#ffd29a', '#6ab7ff', '#ff6fa8', '#ffd29a'][i % 5];
      bulbs.add(x, 6.85, cz + D / 2 - 0.5, c, -1, 3.2);
    }
    this.group.add(new THREE.Mesh(g.build(), litMat()));
    // banner backdrop + side flex
    const tex = banner(1024, 300, '#7b1113', '#f2c21b', [
      { text: 'अखिल भारतीय कवि सम्मेलन', size: 120, color: '#ffe9a8', y: 105 },
      { text: 'मोतीझील महोत्सव  •  कानपुर', size: 64, color: '#ffffff', y: 215 },
    ]);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W - 1, 5.0), bannerMat(tex, 0.55));
    back.position.set(cx, SH + 3.1, cz - D / 2 + 0.15);
    this.group.add(back);
    const side = banner(256, 512, '#0d3b66', '#fcbf49', [
      { text: 'कवि', size: 130, color: '#fcbf49', y: 130 }, { text: 'सम्मेलन', size: 90, color: '#ffffff', y: 260 }, { text: '7 PM', size: 90, color: '#ffffff', y: 390 },
    ]);
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.8), bannerMat(side, 0.5));
      m.position.set(cx + sx * (W / 2 + 3.2), 3.6, cz + D / 2 - 0.6);
      this.group.add(m);
      const pole = new Geo().rod(new THREE.Vector3(cx + sx * (W / 2 + 3.2), 0, cz + D / 2 - 0.7), new THREE.Vector3(cx + sx * (W / 2 + 3.2), 6.2, cz + D / 2 - 0.7), 0.07, '#888');
      this.group.add(new THREE.Mesh(pole.build(), litMat()));
    }
    this.group.add(bulbs.object(0.9));
    lights?.add(cx, 5.5, cz + 4.5, '#ffb877', 300, 30);
    lights?.add(cx - 8, 5, cz + 3, '#ffd29a', 200, 26);
    lights?.add(cx + 8, 5, cz + 3, '#ffd29a', 200, 26);
    lights?.add(cx, 4, cz + 16, '#ffcf9a', 160, 28);
    for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) this.posts.push([cx + sx * 9.5, cz + 2.4, 0.9]);
    for (let i = -3; i <= 3; i++) this.posts.push([cx + i * 2.4, cz, 1.5]);
    this.posts.push([cx - W / 2, cz + D / 2 - 0.5, 0.5], [cx + W / 2, cz + D / 2 - 0.5, 0.5]);

    // people: poets on the gaddi, one at the mic, audience on the floor and on chairs
    const poetColours = [['#f4f0e6', '#f4f0e6'], ['#e9d8a6', '#f4f0e6'], ['#3a5a40', '#f4f0e6'], ['#8a5a2a', '#e9e6dc'], ['#f4f0e6', '#2a2a30'], ['#c98b2b', '#f4f0e6'], ['#b3261e', '#f4f0e6'], ['#f4f0e6', '#f4f0e6']];
    const skins = ['#8a5a3c', '#a9714b', '#b98058', '#7a4e34', '#c08d66', '#96633f'];
    const hairs = ['#0d0c0f', '#15110f', '#0d0c0f', '#5c5a58', '#b9b6b0'];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: faceTexture(), roughness: 0.85 });
    const place = (geo: THREE.BufferGeometry, x: number, y: number, z: number, ry: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      this.group.add(m);
    };
    poetColours.forEach(([top, bot], i) => {
      const woman = i === 3;
      const x = cx - 6 + i * 1.7, z = cz - 1.1 + (i % 2) * 0.4;
      place(person({ top: woman ? '#c2185b' : top, bottom: woman ? '#c2185b' : bot, skin: skins[i % 6], hair: hairs[i % 5], woman, pose: 'sit' }), x, SH + 0.09, z, Math.PI);
    });
    place(person({ top: '#f4f0e6', bottom: '#f4f0e6', skin: skins[1], hair: '#15110f', woman: false, pose: 'stand', wave: true }), cx - 3.6, SH + 0.08, cz + 3.6, Math.PI);

    // audience: instanced per outfit
    const outfits: PersonStyle[] = [
      { top: '#f4f0e6', bottom: '#f4f0e6', woman: false }, { top: '#e9d8a6', bottom: '#d9d4c4', woman: false }, { top: '#8aa4c8', bottom: '#2c3646', woman: false },
      { top: '#e07b39', bottom: '#f4f0e6', woman: false }, { top: '#c2185b', bottom: '#c2185b', woman: true }, { top: '#2a8a7a', bottom: '#2a8a7a', woman: true },
      { top: '#7b3fa0', bottom: '#7b3fa0', woman: true },
    ].map((o, i) => ({ ...o, skin: skins[i % 6], hair: o.woman ? '#0d0c0f' : hairs[i % 5], pose: 'sit' as const }));
    const spots: { x: number; z: number; v: number; s: number }[] = [];
    const cols = desktop ? 34 : 22, rowsN = desktop ? 17 : 11;
    for (let r = 0; r < rowsN; r++) for (let c = 0; c < cols; c++) {
      if (rnd(r * 97 + c * 13 + 5) < 0.4) continue;
      const x = cx - (cols - 1) * 0.43 + c * 0.86 + (rnd(r * 7 + c) - 0.5) * 0.15, z = 133.2 + r * 0.95 + (rnd(c * 5 + r) - 0.5) * 0.12;
      spots.push({ x, z, v: Math.floor(rnd(r * 31 + c * 17) * outfits.length), s: 0.9 + rnd(r + c * 3) * 0.14 });
    }
    outfits.forEach((o, v) => {
      const mine = spots.filter((s) => s.v === v);
      if (!mine.length) return;
      const im = new THREE.InstancedMesh(person(o), mat, mine.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
      mine.forEach((s, i) => {
        q.setFromAxisAngle(UP, (rnd(i * 3 + v) - 0.5) * 0.5);   // facing the stage (-z) with a little turn
        im.setMatrixAt(i, m.compose(new THREE.Vector3(s.x, 0.09, s.z), q, new THREE.Vector3(s.s, s.s, s.s)));
        im.setColorAt(i, new THREE.Color().setScalar(0.85 + rnd(i * 11 + v) * 0.25));
      });
      im.frustumCulled = false;
      this.group.add(im);
    });
  }

  private buildStalls(lights: LightPool | null): void {
    const g = new Geo(), bulbs = new Bulbs();
    const types = 4;
    const stall = (x: number, z: number, ry: number, seed: number) => {
      const type = Math.floor(rnd(seed) * types), col = FEST[Math.floor(rnd(seed + 1) * FEST.length)], col2 = FEST[Math.floor(rnd(seed + 2) * FEST.length)];
      const c = Math.cos(ry), s = Math.sin(ry);
      const P = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
      const bx = (lx: number, y: number, lz: number, sx: number, sy: number, sz: number, color: string) => {
        const [px, pz] = P(lx, lz);
        g.box(px, y, pz, sx, sy, sz, color, ry);
      };
      bx(0, 0.5, 0.15, 2.5, 1.0, 0.9, col);                         // counter
      bx(0, 0.52, 0.15, 2.56, 0.06, 0.96, '#e8d8b0');
      bx(0, 1.3, -0.95, 2.8, 2.6, 0.06, col2);                       // back cloth
      for (const sx of [-1.35, 1.35]) { const [px, pz] = P(sx, 0.8); g.rod(new THREE.Vector3(px, 0, pz), new THREE.Vector3(px, 3.0, pz), 0.04, '#b08a55'); const [qx, qz] = P(sx, -0.95); g.rod(new THREE.Vector3(qx, 0, qz), new THREE.Vector3(qx, 3.1, qz), 0.04, '#b08a55'); }
      // sloping striped canopy
      for (let k = 0; k < 8; k++) {
        const lx = -1.4 + (k + 0.5) * 0.35;
        const [px, pz] = P(lx, -0.1);
        g.add(new THREE.BoxGeometry(0.35, 0.05, 2.1), k % 2 ? '#fff4d6' : col, new THREE.Matrix4().makeRotationY(ry).multiply(new THREE.Matrix4().makeRotationX(0.14)).setPosition(px, 3.0, pz));
        bx(lx, 2.75, 0.97, 0.3, 0.3, 0.03, k % 2 ? col2 : '#fff4d6');   // scalloped valance
      }
      // lights: tube light + bulbs along the front edge
      const [tx, tz] = P(0, 0.75);
      bulbs.add(tx, 2.85, tz, '#fff6e0', -1, 3.0);
      for (let k = 0; k < 7; k++) { const [px, pz] = P(-1.2 + k * 0.4, 1.0); bulbs.add(px, 2.7, pz, BULB[(k + Math.floor(seed)) % 6], (k % 4) / 4, 1.0); }
      // goods
      if (type === 0) {         // toys + balloons
        for (let k = 0; k < 26; k++) { const [px, pz] = P((rnd(seed + k) - 0.5) * 2.4, -0.55 + rnd(seed + k + 40) * 0.5); g.sphere(px, 1.7 + rnd(seed + k + 80) * 0.9, pz, 0.22, FEST[k % FEST.length], 1, 1.2, 1); }
        for (let k = 0; k < 8; k++) bx(-1.0 + k * 0.28, 0.7, 0.1, 0.18, 0.25, 0.2, FEST[(k + 3) % FEST.length]);
      } else if (type === 1) {  // chaat / jalebi: a big kadhai with a glowing fire
        const [kx, kz] = P(-0.5, 0.2);
        g.cyl(kx, 1.03, kz, 0.5, 0.18, '#1c1c1c', 12, 0.4);
        g.cyl(kx, 1.2, kz, 0.42, 0.02, '#e07a10', 12);
        bulbs.add(kx, 1.3, kz, '#ff7a1a', -1, 3.4);
        for (let k = 0; k < 5; k++) bx(0.5 + (k % 2) * 0.3, 1.1 + k * 0.1, 0.1, 0.45, 0.07, 0.45, k % 2 ? '#e8d8b0' : '#f2c21b');
      } else if (type === 2) {  // bangles + accessories hung on the back cloth
        for (let r = 0; r < 4; r++) for (let k = 0; k < 11; k++) bx(-1.2 + k * 0.24, 1.2 + r * 0.38, -0.88, 0.16, 0.26, 0.04, FEST[(r * 3 + k) % FEST.length]);
      } else {                   // cotton candy: pink clouds on sticks
        for (let k = 0; k < 9; k++) { const [px, pz] = P(-1.0 + k * 0.25, 0.15); g.sphere(px, 1.5 + (k % 3) * 0.08, pz, 0.24, k % 2 ? '#ff9ec7' : '#ffd1e3', 1, 1.1, 1); g.rod(new THREE.Vector3(px, 1.05, pz), new THREE.Vector3(px, 1.3, pz), 0.012, '#eee', 4); }
        const [mx, mz] = P(0.9, 0.15);
        g.cyl(mx, 1.0, mz, 0.4, 0.3, '#d8d8de', 12);
      }
      this.posts.push([x, z, 1.35]);
    };
    // two columns facing the main aisle, a few near the gate and the rides
    let n = 0;
    for (let z = 164; z <= 212; z += 7.0) {
      stall(MELA.cx - 13, z, Math.PI / 2, 10 + n++);
      stall(MELA.cx + 13, z, -Math.PI / 2, 10 + n++);
    }
    for (let x = 12; x <= 100; x += 11) if (Math.abs(x - 50) > 18 && x > 24 && x < 78) stall(x, 128, Math.PI, 70 + x);   // row behind the audience
    // strings of bulbs and bunting across the aisle and along it
    const bunting = new Geo();
    const string = (a: THREE.Vector3, b: THREE.Vector3, sag: number, step: number, ph: number) => {
      const len = a.distanceTo(b), nb = Math.max(2, Math.round(len / step));
      for (let i = 0; i <= nb; i++) {
        const t = i / nb, p = a.clone().lerp(b, t);
        p.y -= Math.sin(t * Math.PI) * sag;
        bulbs.add(p.x, p.y, p.z, BULB[(i + ph) % BULB.length], ((i + ph) % 6) / 6, 1.0);
        if (i % 2 === 1) bunting.add(new THREE.BoxGeometry(0.28, 0.34, 0.012), FEST[(i + ph) % FEST.length], new THREE.Matrix4().makeRotationZ(Math.PI / 4).setPosition(p.x, p.y - 0.18, p.z));
      }
    };
    for (let z = 164; z <= 212; z += 7.0) {
      string(new THREE.Vector3(MELA.cx - 13, 3.2, z - 0.8), new THREE.Vector3(MELA.cx + 13, 3.2, z - 0.8), 0.9, 0.85, Math.floor(z));
      string(new THREE.Vector3(MELA.cx - 13, 3.2, z + 0.8), new THREE.Vector3(MELA.cx + 13, 3.2, z + 0.8), 0.9, 0.85, Math.floor(z) + 2);
    }
    for (const x of [MELA.cx - 13, MELA.cx + 13]) string(new THREE.Vector3(x, 3.1, 160), new THREE.Vector3(x, 3.1, 214), 0.5, 0.8, 1);
    for (const [x, z] of [[MELA.cx, 128]]) string(new THREE.Vector3(x - 30, 4.8, z), new THREE.Vector3(x + 30, 4.8, z), 1.4, 0.9, 3);
    this.group.add(new THREE.Mesh(g.build(), litMat({ metalness: 0.05, roughness: 0.8 })));
    this.group.add(new THREE.Mesh(bunting.build(), litMat({ metalness: 0, roughness: 0.9, side: THREE.DoubleSide })));
    this.group.add(bulbs.object(0.7));
    for (let z = 168; z <= 212; z += 11) { lights?.add(MELA.cx, 4.2, z, '#ffc98a', 150, 26); }
  }

  private buildGate(lights: LightPool | null): void {
    const cx = MELA.cx, cz = MELA.gateZ, W = 15;
    const g = new Geo(), bulbs = new Bulbs();
    for (const sx of [-1, 1]) {
      g.box(cx + sx * W / 2, 3.2, cz, 1.2, 6.4, 1.2, '#f2e6c9');
      g.box(cx + sx * W / 2, 6.6, cz, 1.7, 0.4, 1.7, '#b3261e');
      g.add(new THREE.ConeGeometry(0.8, 1.6, 4).rotateY(Math.PI / 4), '#f2c21b', new THREE.Matrix4().makeTranslation(cx + sx * W / 2, 7.6, cz));
      for (let i = 0; i < 12; i++) bulbs.add(cx + sx * W / 2 + sx * 0.64, 0.4 + i * 0.5, cz + 0.62, BULB[i % 6], (i % 6) / 6, 1.1);
    }
    g.box(cx, 6.2, cz, W, 1.2, 1.0, '#8b1a1a');
    for (let i = 0; i < 16; i++) g.box(cx - W / 2 + 0.5 + i * (W - 1) / 15, 7.0, cz, 0.4, 0.5, 0.5, FEST[i % FEST.length]);
    for (let i = 0; i < 28; i++) { const x = cx - W / 2 + i * W / 27; bulbs.add(x, 5.55, cz + 0.55, BULB[i % 6], (i % 8) / 8, 1.2); bulbs.add(x, 6.85, cz + 0.55, BULB[(i + 2) % 6], (i % 8) / 8, 1.2); }
    this.group.add(new THREE.Mesh(g.build(), litMat({ metalness: 0.05 })));
    const tex = banner(1024, 200, '#8b1a1a', '#f2c21b', [{ text: 'मोतीझील मेला — स्वागतम्', size: 100, color: '#ffe9a8', y: 100 }]);
    for (const dz of [0.52, -0.52]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(W - 1.4, 1.1), bannerMat(tex, 0.7));
      m.position.set(cx, 6.2, cz + dz);
      if (dz < 0) m.rotation.y = Math.PI;
      this.group.add(m);
    }
    this.group.add(bulbs.object(0.85));
    lights?.add(cx, 5, cz - 2, '#ffbf80', 260, 30);
    this.posts.push([cx - W / 2, cz, 0.9], [cx + W / 2, cz, 0.9]);
  }

  // tall floodlight masts on the edges: the white glare that makes a mela visible from far away
  private buildMasts(lights: LightPool | null): void {
    const g = new Geo(), bulbs = new Bulbs();
    for (const [x, z] of [[MELA.x0 + 4, 130], [MELA.x1 - 4, 130], [MELA.x0 + 4, 195], [MELA.x1 - 4, 195], [MELA.cx - 26, 156], [MELA.cx + 26, 156]]) {
      g.rod(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 11, z), 0.12, '#7a7d82');
      g.box(x, 11.2, z, 1.7, 0.5, 0.3, '#2a2a2e');
      for (let k = 0; k < 4; k++) bulbs.add(x - 0.6 + k * 0.4, 11.0, z - 0.2, '#fff7e0', -1, 3.2);
      this.posts.push([x, z, 0.3]);
      lights?.add(x, 10, z, '#fff0d0', 320, 40);
    }
    this.group.add(new THREE.Mesh(g.build(), litMat()), bulbs.object(1.0));
  }

  // ---- boundary: long cloth walls on bamboo poles, with one torn place to slip in through -------------

  private buildWalls(lights: LightPool | null): void {
    const H = 3.4, SPAN = 3.0;
    const kinds: THREE.BufferGeometry[][] = [[], [], []];
    const poles = new Geo();
    const jag = (i: number) => rnd(i * 12.9898 + 4.1);

    /** Cloth between two poles; `strips` gives the lowest y of the cloth for each 0.25 m strip (torn edges), else a full panel. */
    const cloth = (ax: number, az: number, dx: number, dz: number, len: number, kind: number, seed: number,
                   bottom?: (xl: number) => number): void => {
      const rot = Math.atan2(-dz, dx);
      const M = new THREE.Matrix4().makeRotationY(rot).setPosition(ax, 0, az);
      const strips = Math.max(4, Math.round(len / 0.25)), rows = 6;
      const pos: number[] = [], uv: number[] = [], idx: number[] = [];
      for (let i = 0; i <= strips; i++) {
        const xl = (i / strips) * len;
        const tt = xl / len;
        const b = bottom ? bottom(xl) : 0.15 + jag(seed + i) * 0.06;
        const sag = Math.sin(tt * Math.PI) * 0.16;                  // top edge hangs between the poles
        const top = H - sag;
        for (let r = 0; r <= rows; r++) {
          const f = r / rows, y = b + (top - b) * f;
          const billow = 0.09 * Math.sin(xl * 1.7 + seed) * (0.4 + 0.6 * f) + 0.07 * Math.sin(xl * 0.6 + y * 1.3 + seed * 2.0);
          pos.push(xl, y, billow);
          uv.push(xl / 1.5, y / 1.5);
        }
      }
      for (let i = 0; i < strips; i++) for (let r = 0; r < rows; r++) {
        const a = i * (rows + 1) + r, bq = a + 1, c = a + rows + 1, d = c + 1;
        idx.push(a, c, bq, bq, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      g.applyMatrix4(M);
      kinds[kind].push(g);
    };

    const L = WALL_LOOP;
    let seed = 0;
    for (let e = 0; e < L.length; e++) {
      const a = L[e], b = L[(e + 1) % L.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
      // does the torn place lie on this edge? (distance along the edge to the tear)
      const onEdge = Math.abs((TEAR.x - a[0]) * dz - (TEAR.z - a[1]) * dx) < 0.5 && (TEAR.x - a[0]) * dx + (TEAR.z - a[1]) * dz > 0 &&
        (TEAR.x - a[0]) * dx + (TEAR.z - a[1]) * dz < len;
      const st = onEdge ? (TEAR.x - a[0]) * dx + (TEAR.z - a[1]) * dz : -1;
      const spans: { s0: number; s1: number; torn: boolean }[] = onEdge
        ? [{ s0: 0, s1: st - 3, torn: false }, { s0: st - 3, s1: st + 3, torn: true }, { s0: st + 3, s1: len, torn: false }]
        : [{ s0: 0, s1: len, torn: false }];
      for (const sp of spans) {
        const n = Math.max(1, Math.round((sp.s1 - sp.s0) / SPAN)), w = (sp.s1 - sp.s0) / n;
        const P = (s: number): [number, number] => [a[0] + dx * s, a[1] + dz * s];
        if (sp.torn) {
          // one 6 m piece of cloth with a ragged opening in the middle: the lower edge climbs to a ragged lip, a few strips dangle
          const c = 3;
          const bottom = (xl: number) => {
            const d = Math.abs(xl - c), j = jag(Math.round(xl * 4) + 77);
            if (d < 1.05) return 2.55 + j * 0.45;
            if (d < 2.1) return 0.15 + (2.6 - 0.15) * (1 - (d - 1.05) / 1.05) + (j - 0.5) * 0.5;
            return 0.15 + jag(Math.round(xl * 4)) * 0.06;
          };
          const [px, pz] = P(sp.s0);
          cloth(px, pz, dx, dz, 6, 2, 900 + e, bottom);
          for (let k = 0; k < 7; k++) {                       // torn threads hanging into the opening
            const xl = c - 1.0 + (k / 6) * 2.0 + (jag(k + 5) - 0.5) * 0.2;
            const low = 1.5 + jag(k + 31) * 0.8;
            const [tx, tz] = P(sp.s0 + xl);
            const g = new THREE.PlaneGeometry(0.09 + jag(k) * 0.07, 2.65 - low, 1, 3);
            g.translate(0, low + (2.65 - low) / 2, 0.03);
            g.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.atan2(-dz, dx)).setPosition(tx, 0, tz));
            kinds[2].push(g);
          }
          // collision: the two solid stretches either side of the 2 m gap
          this.wallQuad([P(sp.s0), P(sp.s0 + c - 1.0)], dx, dz);
          this.wallQuad([P(sp.s0 + c + 1.0), P(sp.s1)], dx, dz);
          for (const s of [sp.s0, sp.s1]) { const [qx, qz] = P(s); poles.rod(new THREE.Vector3(qx, 0, qz), new THREE.Vector3(qx, H + 0.4, qz), 0.055, '#8a6a3a'); }
          // two poles bracing the opening
          for (const off of [-1.45, 1.45]) { const [qx, qz] = P(sp.s0 + c + off); poles.rod(new THREE.Vector3(qx, 0, qz), new THREE.Vector3(qx + dz * 0.15, H - 0.2, qz - dx * 0.15), 0.045, '#8a6a3a'); }
          continue;
        }
        for (let k = 0; k < n; k++) {
          const [px, pz] = P(sp.s0 + k * w);
          cloth(px, pz, dx, dz, w + 0.04, (seed++ * 7 + e) % 3, seed * 3.7);
          poles.rod(new THREE.Vector3(px, 0, pz), new THREE.Vector3(px, H + 0.4, pz), 0.055, '#8a6a3a');
        }
        const [ex, ez] = P(sp.s1);
        poles.rod(new THREE.Vector3(ex, 0, ez), new THREE.Vector3(ex, H + 0.4, ez), 0.055, '#8a6a3a');
        this.wallQuad([P(sp.s0), P(sp.s1)], dx, dz);
      }
    }
    const mats = [clothTexture(0), clothTexture(1), clothTexture(2)].map((map) =>
      new THREE.MeshStandardMaterial({ map, roughness: 0.95, side: THREE.DoubleSide, emissive: new THREE.Color('#ffffff'), emissiveMap: map, emissiveIntensity: 0.16 }));
    kinds.forEach((list, i) => {
      if (!list.length) return;
      const merged = mergeGeometries(list.map((g) => { const x = g.index ? g.toNonIndexed() : g; x.deleteAttribute('normal'); x.computeVertexNormals(); return x; }))!;
      const m = new THREE.Mesh(merged, mats[i]);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    });
    this.group.add(new THREE.Mesh(poles.build(), litMat({ metalness: 0, roughness: 0.9 })));
    // the torn place: a warm glow leaks out through it, a trodden path leads to it from the park
    lights?.add(TEAR.x + 4, 2.2, TEAR.z, '#ffbf7a', 150, 20);
    const path = new Geo();
    path.box(TEAR.x - 6, 0.06, TEAR.z, 12, 0.02, 3.2, '#8a7a60');
    this.group.add(new THREE.Mesh(path.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })));
  }

  /** Thin collision slab along a wall stretch (ends given as map points). */
  private wallQuad(ends: [number, number][], dx: number, dz: number): void {
    const [a, b] = ends;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.3) return;
    const nx = -dz * 0.12, nz = dx * 0.12;
    this.walls.push([[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]]);
  }

  /** aisles of the mela as a street graph for the strolling crowd */
  private aisles(map: MapData): MapData {
    const road = (pts: [number, number][]) => ({ id: 0, pts, w: 3.0, cls: 'service', name: '', oneway: false, lanes: 1, bridge: false, layer: 0, divider: false, sidewalk: 'no', surface: '' });
    const roads = [
      road([[50, 216], [50, 160]]),                           // main aisle (the audience sits beyond it)
      road([[10, 162], [90, 162]]), road([[10, 196], [90, 196]]),
      road([[24, 162], [24, 214]]), road([[76, 162], [76, 214]]), road([[10, 162], [10, 214]]), road([[92, 162], [92, 214]]),
      road([[10, 214], [90, 214]]),
    ];
    return { ...map, roads };
  }
}
