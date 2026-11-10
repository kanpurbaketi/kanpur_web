import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { leafTexture } from './textures';

/** Shared wind clock; main.ts advances it every frame. */
export const treeUniforms = { time: { value: 0 } };

export type TreeSpot = [number, number, number]; // x, z, 0..1 hash (variant, size, rotation, tint)

interface Variant {
  trunkH: number;
  crownY: number;
  radius: [number, number, number]; // crown ellipsoid
  cards: number;
  cardSize: number;
  branches: number;
}

// Roadside trees around Moti Jheel: broad neem / peepal, and the tall narrow ashoka seen along colony lanes.
const VARIANTS: Variant[] = [
  { trunkH: 2.6, crownY: 4.8, radius: [3.0, 2.3, 3.0], cards: 110, cardSize: 2.4, branches: 4 },
  { trunkH: 2.2, crownY: 4.1, radius: [2.3, 2.0, 2.3], cards: 80, cardSize: 2.1, branches: 3 },
  { trunkH: 1.2, crownY: 4.3, radius: [1.15, 3.6, 1.15], cards: 70, cardSize: 1.7, branches: 0 },
];

/**
 * Instanced trees: tapered trunk with branches + a crown of alpha-cut leaf cards.
 * Card normals point out of the crown ellipsoid (soft, volumetric shading instead of flat facets),
 * inner cards are darkened as cheap self-occlusion, and the crown sways a little in the wind.
 */
export function makeTrees(spots: TreeSpot[]): THREE.Object3D[] {
  if (!spots.length) return [];
  const out: THREE.Object3D[] = [];
  const leafMat = leafMaterial();
  const barkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const byVariant: TreeSpot[][] = VARIANTS.map(() => []);
  for (const s of spots) byVariant[s[2] < 0.45 ? 0 : s[2] < 0.8 ? 1 : 2].push(s);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
  const tint = new THREE.Color(), base = new THREE.Color();
  byVariant.forEach((list, vi) => {
    if (!list.length) return;
    const v = VARIANTS[vi];
    const crown = new THREE.InstancedMesh(crownGeometry(v, vi), leafMat, list.length);
    const trunk = new THREE.InstancedMesh(trunkGeometry(v, vi), barkMat, list.length);
    list.forEach(([x, z, h], i) => {
      const k = (h * 7.31) % 1;
      const s = 0.8 + k * 0.55;
      q.setFromAxisAngle(UP, h * 40);
      m.compose(pos.set(x, 0, z), q, sc.set(s, s * (0.9 + ((h * 13.7) % 1) * 0.25), s));
      crown.setMatrixAt(i, m);
      trunk.setMatrixAt(i, m);
      // hue / dryness variation per tree (dusty, sun-bleached leaves are common before the monsoon)
      base.setHSL(0.24 + ((h * 3.3) % 1) * 0.06, 0.35 + ((h * 5.1) % 1) * 0.2, 0.5);
      tint.setRGB(1, 1, 1).lerp(base, 0.35).multiplyScalar(0.95 + ((h * 9.7) % 1) * 0.15);
      crown.setColorAt(i, tint);
    });
    for (const im of [trunk, crown]) {
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      out.push(im);
    }
    crown.userData.noAO = true; // leaf cards would occlude as solid quads in the AO normal pass
  });
  return out;
}

const UP = new THREE.Vector3(0, 1, 0);
/** Touch devices get about half the leaf cards (crowns stay full, just slightly more see-through). */
const CARD_SCALE = typeof matchMedia !== 'undefined' && !matchMedia('(pointer: fine)').matches ? 0.55 : 1;

function rng(seed: number): () => number {
  let s = Math.floor(seed * 2147483646) + 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function crownGeometry(v: Variant, vi: number): THREE.BufferGeometry {
  const rnd = rng(0.137 + vi * 0.21);
  const parts: THREE.BufferGeometry[] = [];
  const [rx, ry, rz] = v.radius;
  const c = new THREE.Vector3(0, v.crownY, 0);
  const e = new THREE.Euler(), mtx = new THREE.Matrix4(), p = new THREE.Vector3(), n = new THREE.Vector3();
  const cards = Math.round(v.cards * CARD_SCALE);
  for (let i = 0; i < cards; i++) {
    // points biased to the outer shell, where leaves actually are
    let x, y, z;
    do {
      x = rnd() * 2 - 1;
      y = rnd() * 2 - 1;
      z = rnd() * 2 - 1;
    } while (x * x + y * y + z * z > 1);
    const r = 0.35 + 0.6 * Math.cbrt(rnd());
    const len = Math.hypot(x, y, z) || 1;
    p.set((x / len) * r * rx, (y / len) * r * ry * (y < 0 ? 0.75 : 1), (z / len) * r * rz).add(c);
    const g = new THREE.PlaneGeometry(v.cardSize, v.cardSize);
    e.set(rnd() * Math.PI, rnd() * Math.PI * 2, rnd() * Math.PI);
    g.applyMatrix4(mtx.makeRotationFromEuler(e).setPosition(p));
    const P = g.getAttribute('position'), N = g.getAttribute('normal');
    const cols: number[] = [];
    for (let j = 0; j < P.count; j++) {
      n.set((P.getX(j) - c.x) / rx, (P.getY(j) - c.y) / ry, (P.getZ(j) - c.z) / rz);
      const d = Math.min(1, n.length());
      n.normalize().lerp(UP, 0.25).normalize();
      N.setXYZ(j, n.x, n.y, n.z);
      // fake occlusion: inner and lower leaves are darker
      const ao = 0.45 + 0.4 * d + 0.15 * Math.max(0, (P.getY(j) - c.y) / ry);
      cols.push(ao, ao, ao);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    parts.push(g);
  }
  return mergeGeometries(parts)!;
}

function trunkGeometry(v: Variant, vi: number): THREE.BufferGeometry {
  const rnd = rng(0.71 + vi * 0.13);
  const parts: THREE.BufferGeometry[] = [];
  const main = new THREE.CylinderGeometry(0.13, 0.24, v.trunkH + (v.branches ? 0.6 : v.crownY - v.trunkH), 8, 3);
  const mh = main.parameters.height;
  main.translate(0, mh / 2, 0);
  // slight lean / bend
  const P = main.getAttribute('position');
  for (let i = 0; i < P.count; i++) P.setX(i, P.getX(i) + Math.pow(P.getY(i) / mh, 2) * 0.25);
  parts.push(main);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), dir = new THREE.Vector3();
  for (let b = 0; b < v.branches; b++) {
    const a = (b / v.branches) * Math.PI * 2 + rnd() * 0.8;
    const L = 1.6 + rnd() * 1.2;
    const g = new THREE.CylinderGeometry(0.05, 0.11, L, 5);
    g.translate(0, L / 2, 0);
    dir.set(Math.cos(a) * 0.8, 1, Math.sin(a) * 0.8).normalize();
    q.setFromUnitVectors(UP, dir);
    g.applyMatrix4(mtx.makeRotationFromQuaternion(q).setPosition(0.15, v.trunkH - 0.2 + rnd() * 0.5, 0));
    parts.push(g);
  }
  const geo = mergeGeometries(parts.map((g) => g.toNonIndexed()))!;
  const bark = new THREE.Color('#5c4b3b'), dark = new THREE.Color('#3b2f25');
  const cols: number[] = [];
  const GP = geo.getAttribute('position');
  const c = new THREE.Color();
  for (let i = 0; i < GP.count; i++) {
    c.copy(dark).lerp(bark, Math.min(1, GP.getY(i) / 2)); // darker at the root, dusty
    // whitewashed band at the base — common on roadside trees in UP
    if (vi < 2 && GP.getY(i) < 1.1 && GP.getY(i) > 0.05) c.set('#d8d4c8');
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return geo;
}

function leafMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: leafTexture(), vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.time = treeUniforms.time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform float time;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec3 root = instanceMatrix[3].xyz;
  float ph = root.x * 0.21 + root.z * 0.17;
  float k = max(0.0, transformed.y - 2.5) * 0.035;
  transformed.x += sin(time * 1.3 + ph + transformed.y * 0.4) * k;
  transformed.z += cos(time * 1.1 + ph * 1.3) * k * 0.7;
}
#endif`);
    // Cards are double-sided but share the crown's outward normal on both faces.
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>',
      THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
  };
  return mat;
}
