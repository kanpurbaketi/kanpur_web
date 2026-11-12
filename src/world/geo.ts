import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { glowUniforms, halos } from './night';

/*
 Procedural-geometry helpers shared by the mela and the street vendors:
   Geo       merge vertex-coloured boxes / cylinders / spheres / rods into one geometry
   Bulbs     emissive bulbs (octahedra) with optional chase pattern + glow sprites
   banner    canvas text banner texture
*/

export const C = (h: string) => new THREE.Color(h);
export const FEST = ['#d62828', '#f77f00', '#fcbf49', '#2a9d8f', '#3a86ff', '#e63946', '#9b5de5', '#00bbf9', '#ef476f', '#06d6a0'];
export const BULB = ['#ffb347', '#ff5a4f', '#ffe14d', '#59e36b', '#4fa9ff', '#ff6fd0'];
export const rnd = (seed: number) => { const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

// ---- geometry helpers -----------------------------------------------------------------------------

/** Collects vertex-coloured parts (position, normal, colour) and merges them into one geometry. */
export class Geo {
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
  get empty(): boolean {
    return this.parts.length === 0;
  }
  build(): THREE.BufferGeometry {
    return mergeGeometries(this.parts)!;
  }
}

export const litMat = (extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.25, ...extra });

/** Emissive bulbs: octahedra that can chase (phase 0..1) + glow sprites. Add `.object` to the scene or a moving group. */
export class Bulbs {
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
export function banner(w: number, h: number, bg: string, border: string,
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

export const bannerMat = (tex: THREE.Texture, glow = 0.7) =>
  new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color(glow, glow, glow), roughness: 0.8, side: THREE.DoubleSide });

