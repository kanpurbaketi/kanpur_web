import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { lookCount, rigMaterial } from './actors';

/*
 Still figures: the people who sit or stand in one place (the kavi sammelan's poets and audience, the gallery of the maut
 ka kuan and the riders on its wall, the children in the inflatable, the stall keepers and their customers, the people on the rides). They are the crowd's own characters (uncle, aunty,
 college girl, college boy; never the security guard, who is there to chase Ramu) in a fixed pose, cut down to a few
 thousand triangles (tools/blender/build_figures.py -> public/models/figures/<name>.glb, one mesh per pose), wearing the
 same looks as the walking crowd (actors.ts). Many of one kind, look and pose are drawn as one InstancedMesh.
 A figure faces -z and stands (or sits) on y = 0 with its hips over the origin.
*/

export type FigureKind = 'uncle' | 'aunty' | 'girl' | 'boy';
export type Pose = 'stand' | 'stand_b' | 'stand_c' | 'talk' | 'talk_b' | 'hop' | 'sit' | 'ride' | 'chair';
const FILES: Record<FigureKind, string> = { uncle: 'uncle', aunty: 'aunty', girl: 'college_girl', boy: 'college_boy' };
const KINDS: FigureKind[] = ['uncle', 'aunty', 'girl', 'boy', 'uncle', 'girl', 'boy', 'aunty', 'uncle'];
/** standing about, for a crowd of onlookers: mostly just standing, some talking, a few with their arms up */
export const ONLOOKER: Pose[] = ['stand', 'stand_b', 'stand_c', 'stand', 'talk', 'stand_b', 'talk_b', 'stand_c', 'talk'];

export interface Spot {
  x: number; y: number; z: number;
  /** turn about the vertical: 0 faces -z */
  ry: number;
  pose: Pose;
  /** scale (a child is about 0.6); default 1 */
  s?: number;
  /** who, and which of their looks: picked from `n` when left out */
  kind?: FigureKind; look?: number;
  /** any number: picks the kind and look of a spot that does not name them */
  n?: number;
}

const cache = new Map<FigureKind, Promise<Map<string, THREE.BufferGeometry>>>();

function poses(kind: FigureKind): Promise<Map<string, THREE.BufferGeometry>> {
  let p = cache.get(kind);
  if (!p) {
    p = new GLTFLoader().loadAsync(`models/figures/${FILES[kind]}.glb`).then((gltf) => {
      const out = new Map<string, THREE.BufferGeometry>();
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) out.set(m.name, m.geometry.rotateY(Math.PI));       // the file faces +z
      });
      return out;
    });
    cache.set(kind, p);
  }
  return p;
}

const hash = (n: number) => { const v = Math.sin(n * 127.1 + 11.7) * 43758.5453; return v - Math.floor(v); };

function resolve(s: Spot, i: number): { kind: FigureKind; look: number } {
  const n = s.n ?? i;
  const kind = s.kind ?? KINDS[Math.floor(hash(n) * KINDS.length)];
  return { kind, look: (s.look ?? Math.floor(hash(n + 0.37) * 97)) % lookCount(kind) };
}

/**
 * The room the figures at `spots` take up, for the collision world: [x, z, half-size, top, foot] in the spots' own frame.
 * Somebody sitting cross-legged takes more floor than somebody standing.
 */
export function figurePosts(spots: Spot[]): [number, number, number, number, number][] {
  return spots.map((s) => {
    const k = s.s ?? 1;
    const r = (s.pose === 'sit' ? 0.36 : s.pose === 'chair' ? 0.32 : 0.24) * k;
    const h = (s.pose === 'sit' || s.pose === 'chair' ? 1.0 : 1.7) * k;
    return [s.x, s.z, r, s.y + h, s.y];
  });
}

/** Put figures at `spots` under `parent`. They appear once their models have loaded. */
export function addFigures(parent: THREE.Object3D, spots: Spot[]): void {
  const groups = new Map<string, { kind: FigureKind; look: number; pose: Pose; spots: Spot[] }>();
  spots.forEach((s, i) => {
    const { kind, look } = resolve(s, i);
    const key = `${kind}/${look}/${s.pose}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { kind, look, pose: s.pose, spots: [] }));
    g.spots.push(s);
  });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3();
  for (const g of groups.values()) {
    Promise.all([poses(g.kind), rigMaterial(g.kind, g.look)]).then(([geo, mat]) => {
      const geometry = geo.get(g.pose);
      if (!geometry) return;
      const im = new THREE.InstancedMesh(geometry, mat, g.spots.length);
      g.spots.forEach((s, i) => {
        q.setFromAxisAngle(UP, s.ry);
        im.setMatrixAt(i, m.compose(v.set(s.x, s.y, s.z), q, sc.setScalar(s.s ?? 1)));
      });
      im.frustumCulled = false;
      parent.add(im);
    }).catch((e) => console.error('figures failed to load', e));
  }
}

/** The posed mesh and material of the figure the number `n` picks, for something that draws its own instances (the riders in the traffic). */
export async function riderParts(n: number, pose: Pose, kinds: FigureKind[] = KINDS): Promise<{ geo: THREE.BufferGeometry; mat: THREE.Material }> {
  const kind = kinds[Math.floor(hash(n) * kinds.length)];
  const [geo, mat] = await Promise.all([poses(kind), rigMaterial(kind, Math.floor(hash(n + 0.37) * 97) % lookCount(kind))]);
  return { geo: geo.get(pose)!, mat };
}

/** A figure of whatever kind and look the number `n` picks (`kinds` narrows the choice): somebody for a seat on a ride. */
export function someone(n: number, pose: Pose, scale = 1, kinds: FigureKind[] = KINDS): THREE.Group {
  const kind = kinds[Math.floor(hash(n) * kinds.length)];
  return figure(kind, Math.floor(hash(n + 0.37) * 97) % lookCount(kind), pose, scale);
}

/** One figure, as an object that can be moved about (it is empty until the model has loaded). */
export function figure(kind: FigureKind, look: number, pose: Pose, scale = 1): THREE.Group {
  const holder = new THREE.Group();
  Promise.all([poses(kind), rigMaterial(kind, look)]).then(([geo, mat]) => {
    const geometry = geo.get(pose);
    if (!geometry) return;
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.scale.setScalar(scale);
    mesh.frustumCulled = false;       // it rides on something that moves
    holder.add(mesh);
  }).catch((e) => console.error('figure failed to load', e));
  return holder;
}
