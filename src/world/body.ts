import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/*
 Human body parts shared by Ramu and the pedestrians.
 Each part is a smooth "loft": elliptical cross-sections stacked along the height, so shoulders slope,
 the chest and waist have shape and limbs taper, at a few dozen triangles a part.
 Model space: metres, a 1.8 m adult, facing -Z. Limb parts hang down from their joint at the origin.
*/

/** Joint positions. Thigh and upper arm hang from hip / shoulder; shin and forearm from knee / elbow. */
export const BODY = { hipY: 0.92, hipX: 0.092, thigh: 0.42, shoulderY: 1.44, shoulderX: 0.215, upperArm: 0.28 };

export interface Ring { y: number; rx: number; rz: number; cx?: number; cz?: number }

/** Smooth tube through elliptical rings (any y order). u runs round the body (front, -Z, is u = 0.75), v up it. */
export function loft(rings: Ring[], segs: number, capTop = true, capBottom = true): THREE.BufferGeometry {
  const R = [...rings].sort((a, b) => a.y - b.y);
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const y0 = R[0].y, y1 = R[R.length - 1].y;
  R.forEach((r) => {
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      pos.push((r.cx ?? 0) + Math.cos(a) * r.rx, r.y, (r.cz ?? 0) + Math.sin(a) * r.rz);
      uv.push(j / segs, (r.y - y0) / (y1 - y0));
    }
  });
  const W = segs + 1;
  for (let i = 0; i < R.length - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * W + j, up = a + W;
      idx.push(a, up, a + 1, a + 1, up, up + 1);
    }
  }
  const cap = (ring: number, top: boolean) => {
    const r = R[ring], c = pos.length / 3;
    pos.push(r.cx ?? 0, r.y + (top ? 1 : -1) * Math.min(r.rx, r.rz) * 0.35, r.cz ?? 0);
    uv.push(0.25, top ? 1 : 0);
    for (let j = 0; j < segs; j++) {
      const a = ring * W + j;
      if (top) idx.push(c, a + 1, a);
      else idx.push(c, a, a + 1);
    }
  };
  if (capTop) cap(R.length - 1, true);
  if (capBottom) cap(0, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // the first and last vertex of each ring are the same point: share their normal so no seam shows
  const n = g.getAttribute('normal');
  for (let i = 0; i < R.length; i++) {
    const a = i * W, b = a + segs;
    const v = new THREE.Vector3(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
    n.setXYZ(a, v.x, v.y, v.z);
    n.setXYZ(b, v.x, v.y, v.z);
  }
  return g;
}

/** Merge parts into one geometry (position, normal, uv). */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(parts.map((g) => {
    const out = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k);
    return out;
  }))!;
}

/** Point every uv at one spot (for parts that must not pick up a texture detail). */
export function flatUv(g: THREE.BufferGeometry, u: number, v: number): THREE.BufferGeometry {
  const a = g.getAttribute('uv');
  for (let i = 0; i < a.count; i++) a.setXY(i, u, v);
  return g;
}

/** Keep only the triangles whose centre passes the test. */
export function keepTris(g: THREE.BufferGeometry, keep: (x: number, y: number, z: number) => boolean): THREE.BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g;
  const P = src.getAttribute('position'), N = src.getAttribute('normal'), U = src.getAttribute('uv');
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  for (let i = 0; i < P.count; i += 3) {
    const cx = (P.getX(i) + P.getX(i + 1) + P.getX(i + 2)) / 3;
    const cy = (P.getY(i) + P.getY(i + 1) + P.getY(i + 2)) / 3;
    const cz = (P.getZ(i) + P.getZ(i + 1) + P.getZ(i + 2)) / 3;
    if (!keep(cx, cy, cz)) continue;
    for (let k = i; k < i + 3; k++) {
      pos.push(P.getX(k), P.getY(k), P.getZ(k));
      nor.push(N.getX(k), N.getY(k), N.getZ(k));
      uv.push(U.getX(k), U.getY(k));
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}

// ---- torso --------------------------------------------------------------------------------------

const TORSO: Ring[] = [
  { y: 0.9, rx: 0.165, rz: 0.108 },             // hips
  { y: 1.0, rx: 0.16, rz: 0.106 },
  { y: 1.1, rx: 0.15, rz: 0.1 },                // waist
  { y: 1.3, rx: 0.186, rz: 0.118, cz: -0.004 }, // chest
  { y: 1.42, rx: 0.2, rz: 0.104 },              // shoulders
  { y: 1.475, rx: 0.155, rz: 0.088 },           // shoulder slope
  { y: 1.51, rx: 0.062, rz: 0.062 },            // neck base
];

/** Half-width and half-depth of the torso at height y. */
export function torsoSize(y: number): { rx: number; rz: number } {
  const R = TORSO;
  if (y <= R[0].y) return R[0];
  for (let i = 0; i < R.length - 1; i++) {
    if (y <= R[i + 1].y) {
      const t = (y - R[i].y) / (R[i + 1].y - R[i].y);
      return { rx: R[i].rx + (R[i + 1].rx - R[i].rx) * t, rz: R[i].rz + (R[i + 1].rz - R[i].rz) * t };
    }
  }
  return R[R.length - 1];
}

/** z of the chest surface at (x, y), pushed out by `gap`; front is negative z. */
export function chestZ(x: number, y: number, gap = 0): number {
  const { rx, rz } = torsoSize(y);
  return -(rz * Math.sqrt(Math.max(0, 1 - (x / rx) ** 2)) + gap);
}

export const torsoGeo = (segs = 12) => loft(TORSO, segs);

// ---- limbs --------------------------------------------------------------------------------------

export const thighGeo = (segs = 8) => loft([
  { y: 0.04, rx: 0.086, rz: 0.094 }, { y: -0.05, rx: 0.09, rz: 0.098 }, { y: -0.22, rx: 0.075, rz: 0.082 },
  { y: -0.42, rx: 0.056, rz: 0.06 }, { y: -0.45, rx: 0.048, rz: 0.05 },
], segs);

export const shinGeo = (segs = 8) => loft([
  { y: 0.03, rx: 0.054, rz: 0.058 }, { y: -0.02, rx: 0.057, rz: 0.06 }, { y: -0.14, rx: 0.054, rz: 0.062, cz: 0.008 }, // calf
  { y: -0.34, rx: 0.039, rz: 0.042 }, { y: -0.42, rx: 0.037, rz: 0.04 },
], segs);

/** Foot / sandal, in the shin's space (the ankle is 0.42 below the knee). */
export const footGeo = () => new THREE.SphereGeometry(0.5, 8, 6).scale(0.095, 0.075, 0.26).translate(0, -0.462, -0.05);

export const upperArmGeo = (segs = 7) => loft([
  { y: 0.035, rx: 0.046, rz: 0.05 }, { y: -0.02, rx: 0.053, rz: 0.055 }, { y: -0.15, rx: 0.046, rz: 0.048 },
  { y: -0.28, rx: 0.039, rz: 0.04 }, { y: -0.3, rx: 0.032, rz: 0.033 },
], segs);

export const forearmGeo = (segs = 7) => loft([
  { y: 0.02, rx: 0.038, rz: 0.039 }, { y: -0.03, rx: 0.041, rz: 0.042 }, { y: -0.12, rx: 0.037, rz: 0.038 },
  { y: -0.25, rx: 0.027, rz: 0.028 },
], segs);

/** Hand, in the forearm's space. */
export const handGeo = () => new THREE.SphereGeometry(0.5, 7, 5).scale(0.05, 0.105, 0.036).translate(0, -0.3, 0);

/** Kurta / sari below the waist: unit height hanging from y = 0, open at both ends. Scale y for the length. */
export const skirtGeo = (segs = 12) => loft([
  { y: 0.03, rx: 0.168, rz: 0.11 }, { y: -0.35, rx: 0.19, rz: 0.14 }, { y: -1, rx: 0.215, rz: 0.17 },
], segs, false, false);

// ---- head ---------------------------------------------------------------------------------------

/** Head height range, for placing features on a face texture: v = (y - HEAD.y0) / (HEAD.y1 - HEAD.y0). */
export const HEAD = { y0: 1.535, y1: 1.812 };

const HEAD_RINGS: Ring[] = [
  { y: 1.535, rx: 0.034, rz: 0.04, cz: -0.03 },   // chin
  { y: 1.56, rx: 0.058, rz: 0.07, cz: -0.014 },   // jaw
  { y: 1.595, rx: 0.069, rz: 0.084, cz: -0.004 }, // mouth
  { y: 1.635, rx: 0.076, rz: 0.092 },             // cheeks
  { y: 1.68, rx: 0.079, rz: 0.096 },              // eyes
  { y: 1.735, rx: 0.077, rz: 0.095 },             // forehead
  { y: 1.785, rx: 0.058, rz: 0.074 },
  { y: 1.812, rx: 0.022, rz: 0.03 },              // crown
];

/** Head with neck, nose and ears. The face is at u = 0.75; everything else samples the texture's blank corner. */
export function headGeo(segs = 12): THREE.BufferGeometry {
  const blank = (g: THREE.BufferGeometry) => flatUv(g, 0.02, 0.98);
  const nose = new THREE.ConeGeometry(0.017, 0.05, 5).rotateX(-0.35).scale(1, 1, 1.2).translate(0, 1.652, -0.1);
  const ear = (s: number) => new THREE.SphereGeometry(0.5, 6, 5).scale(0.016, 0.045, 0.03).translate(s * 0.079, 1.665, 0.008);
  const neck = loft([{ y: 1.46, rx: 0.05, rz: 0.052 }, { y: 1.57, rx: 0.044, rz: 0.048, cz: 0.006 }], 8, false, false);
  return merge([loft(HEAD_RINGS, segs), blank(nose), blank(ear(-1)), blank(ear(1)), blank(neck)]);
}

/** Shell just outside the scalp, cut along a hairline: hair is kept where y > line(z). */
function scalp(line: (z: number) => number, grow = 1.07): THREE.BufferGeometry {
  const rings = HEAD_RINGS.map((r) => ({ ...r, rx: r.rx * grow + 0.004, rz: r.rz * grow + 0.004 }));
  rings[rings.length - 1].y += 0.012;
  return keepTris(loft(rings, 14), (_x, y, z) => y > line(z));
}

/** Short hair: off the forehead, down to the nape. */
export const shortHairGeo = () => scalp((z) => 1.672 - z * 0.72);

/** Long hair tied back: fuller, lower at the back, with a plait down to the waist. */
export function longHairGeo(): THREE.BufferGeometry {
  const plait = loft([
    { y: 1.56, rx: 0.05, rz: 0.03, cz: 0.085 }, { y: 1.42, rx: 0.036, rz: 0.026, cz: 0.108 },
    { y: 1.22, rx: 0.026, rz: 0.022, cz: 0.118 }, { y: 1.1, rx: 0.014, rz: 0.014, cz: 0.115 },
  ], 6);
  const bun = new THREE.SphereGeometry(0.5, 7, 5).scale(0.1, 0.1, 0.07).translate(0, 1.63, 0.1);
  return merge([scalp((z) => 1.655 - z * 1.3, 1.09), plait, bun]);
}

// ---- drape (sari pallu / dupatta) ---------------------------------------------------------------

/** Cloth running from the right hip over the left shoulder, front and back, with a tail down the back. */
export function drapeGeo(): THREE.BufferGeometry {
  const pos: number[] = [];
  const N = 7, GAP = 0.012;
  const low = (x: number) => 1.02 + (x + 0.2) * 1.1;
  for (const s of [-1, 1]) { // front, back
    for (let i = 0; i < N; i++) {
      const xa = -0.2 + (i / N) * 0.4, xb = -0.2 + ((i + 1) / N) * 0.4;
      const pt = (x: number, top: boolean): [number, number, number] => {
        const y = Math.min(1.5, low(x) + (top ? 0.27 : 0));
        const { rx } = torsoSize(y);
        const xx = Math.max(-rx, Math.min(rx, x));
        return [xx, y, s * -chestZ(xx, y, GAP) * -1];
      };
      const a = pt(xa, false), b = pt(xb, false), c = pt(xb, true), d = pt(xa, true);
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  const strip = new THREE.BufferGeometry();
  strip.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  strip.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  strip.computeVertexNormals();
  // tail hanging from the left shoulder down the back
  const tail = new THREE.BoxGeometry(0.15, 0.72, 0.012).translate(0.115, 1.12, 0.118);
  return merge([strip, tail]);
}
