import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MapData } from './types';

/*
 Random pedestrians.
 A fixed pool of people is kept around the player: they walk the street network (footpath where a road
 has one, otherwise the edge of the carriageway), pick a random turn at each junction, pause now and then,
 and some just stand around. Anyone left far behind is moved to a street ahead / out of sight.
 Rendering: one InstancedMesh per body part (9 draw calls for everybody), per-person colours and height.
*/

const SPAWN_MIN = 60, SPAWN_MAX = 170, DESPAWN = 195; // metres from the player
const SIDEWALK_Y = 0.16;

interface Link { to: number; off: number; y: number }
interface Node { x: number; z: number; links: Link[] }

interface Ped {
  kind: number;       // 0 shirt + trousers, 1 kurta-pyjama, 2 salwar kameez, 3 sari
  scale: number;
  skirt: number;      // length of the kurta / sari below the waist (0 = none)
  speed: number;
  jitter: number;     // personal sideways offset
  a: number; b: number; link: Link; t: number; len: number;
  x: number; y: number; z: number; heading: number;
  phase: number; moving: number; wait: number;
  fresh: boolean;     // not on a street yet
}

const SKIN = ['#8a5a3c', '#a9714b', '#b98058', '#7a4e34', '#c08d66', '#96633f'];
const HAIR = ['#0d0c0f', '#15110f', '#1e1612', '#0d0c0f', '#5c5a58', '#b9b6b0'];
const SHIRTS = ['#e9e6dc', '#b9c7d8', '#6f8fb3', '#c9b48a', '#8a9a6a', '#d8d2c4', '#a34a3a', '#3f5a78', '#e2c36b', '#7b7f86', '#cfd8c0'];
const TROUSERS = ['#2c3646', '#3a3a3c', '#4a4238', '#5b6470', '#2a2a2e', '#6b5d4a'];
const KURTAS = ['#f0ebdd', '#e4dcc6', '#d8c9a3', '#cfd6dc', '#e8a94a', '#c9d2b4'];
const BRIGHT = ['#c2185b', '#e0652a', '#2a8a7a', '#d4a017', '#7b3fa0', '#1f6fb5', '#c0392b', '#2e8b57', '#e84a8a', '#3a4fb0', '#b5651d'];

export class Pedestrians {
  readonly group = new THREE.Group();
  private nodes: Node[] = [];
  private peds: Ped[] = [];
  private active = 0;
  private parts: Record<'leg' | 'torso' | 'skirt' | 'sleeve' | 'forearm' | 'head' | 'hair' | 'longHair' | 'feet', THREE.InstancedMesh>;

  constructor(map: MapData, readonly capacity: number) {
    const count = capacity;
    this.buildGraph(map);
    const mat = (roughness: number) => new THREE.MeshStandardMaterial({ roughness });
    const im = (g: THREE.BufferGeometry, n: number, rough = 0.85) => {
      const m = new THREE.InstancedMesh(g, mat(rough), n);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false; // instances move around the whole map
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
      return m;
    };
    const G = geometries();
    this.parts = {
      leg: im(G.leg, count * 2), torso: im(G.torso, count), skirt: im(G.skirt, count),
      sleeve: im(G.sleeve, count * 2), forearm: im(G.forearm, count * 2, 0.6),
      head: im(G.head, count, 0.6), hair: im(G.hair, count, 0.45), longHair: im(G.longHair, count, 0.45),
      feet: im(G.feet, count * 2, 0.7),
    };
    for (let i = 0; i < count; i++) this.peds.push(this.makePerson(i));
    this.setCount(0);
  }

  /** number of people currently on the streets */
  get count(): number {
    return this.active;
  }

  /** Change the crowd size (0 .. capacity). Takes effect on the next update. */
  setCount(n: number): void {
    n = Math.max(0, Math.min(this.capacity, Math.round(n) || 0));
    for (let i = this.active; i < n; i++) this.peds[i].fresh = true;
    this.active = n;
    const P = this.parts;
    for (const m of [P.torso, P.skirt, P.head, P.hair, P.longHair]) m.count = n;
    for (const m of [P.leg, P.sleeve, P.forearm, P.feet]) m.count = n * 2;
  }

  /** Street network: one node per distinct road vertex, links along the roads. */
  private buildGraph(map: MapData): void {
    const index = new Map<string, number>();
    const nodeAt = (x: number, z: number) => {
      const k = `${x.toFixed(1)},${z.toFixed(1)}`;
      let i = index.get(k);
      if (i === undefined) {
        i = this.nodes.length;
        this.nodes.push({ x, z, links: [] });
        index.set(k, i);
      }
      return i;
    };
    for (const r of map.roads) {
      if (r.bridge) continue;
      const walk = r.sidewalk === 'both' || r.sidewalk === 'yes';
      // on the footpath where there is one, otherwise along the edge of the road
      const off = walk ? r.w / 2 + 1.0 : Math.max(0.5, r.w / 2 - 0.7);
      const y = walk ? SIDEWALK_Y : 0.05;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = nodeAt(r.pts[i][0], r.pts[i][1]), b = nodeAt(r.pts[i + 1][0], r.pts[i + 1][1]);
        if (a === b) continue;
        this.nodes[a].links.push({ to: b, off, y });
        this.nodes[b].links.push({ to: a, off, y });
      }
    }
  }

  private makePerson(i: number): Ped {
    const r = Math.random();
    const kind = r < 0.45 ? 0 : r < 0.6 ? 1 : r < 0.82 ? 2 : 3;
    const child = kind === 0 && Math.random() < 0.12;
    const woman = kind >= 2;
    const scale = child ? 0.62 + Math.random() * 0.12 : (woman ? 0.9 : 0.96) + Math.random() * 0.1;
    const p: Ped = {
      kind, scale,
      skirt: kind === 1 ? 0.42 : kind === 2 ? 0.5 : kind === 3 ? 0.84 : 0,
      speed: (child ? 1.5 : kind === 3 ? 1.0 : 1.15) + Math.random() * 0.45,
      jitter: (Math.random() - 0.5) * 0.7,
      a: 0, b: 0, link: { to: 0, off: 0, y: 0 }, t: 0, len: 1,
      x: 0, y: 0, z: 0, heading: 0, phase: Math.random() * 6, moving: 1, wait: 0, fresh: true,
    };
    // colours
    const c = new THREE.Color();
    const pick = (list: string[]) => c.set(list[Math.floor(Math.random() * list.length)]).clone();
    const skin = pick(SKIN), hair = pick(HAIR.slice(0, child || woman ? 4 : 6));
    const top = pick(kind === 0 ? SHIRTS : kind === 1 ? KURTAS : BRIGHT);
    const bottom = kind === 0 ? pick(TROUSERS) : kind === 1 ? pick(['#ece8dc', '#e0dccf', '#d9d4c4'])
      : kind === 2 ? (Math.random() < 0.5 ? top.clone().multiplyScalar(0.7) : pick(['#e8e3d6', '#2f2f35', '#d9b44a'])) : top;
    const longSleeve = kind === 1 || (kind === 0 && Math.random() < 0.35);
    const P = this.parts;
    P.torso.setColorAt(i, top);
    P.skirt.setColorAt(i, top);
    P.head.setColorAt(i, skin);
    P.hair.setColorAt(i, hair);
    P.longHair.setColorAt(i, hair);
    for (const k of [i * 2, i * 2 + 1]) {
      P.leg.setColorAt(k, bottom);
      P.sleeve.setColorAt(k, top);
      P.forearm.setColorAt(k, longSleeve ? top : skin);
      P.feet.setColorAt(k, skin.clone().multiplyScalar(0.55)); // sandals / dusty feet
    }
    return p;
  }

  /** Put a person on a random street segment in the given distance band around (fx, fz). */
  private place(p: Ped, fx: number, fz: number, min: number, max: number, dirX: number, dirZ: number): boolean {
    const cands: number[] = [];
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (!n.links.length) continue;
      const dx = n.x - fx, dz = n.z - fz, d = Math.hypot(dx, dz);
      if (d < min || d > max) continue;
      // close ones only where the camera is not looking, so nobody pops into view
      if (d < 120 && dx * dirX + dz * dirZ > 0.2 * d) continue;
      cands.push(i);
    }
    if (!cands.length) return false;
    p.a = cands[Math.floor(Math.random() * cands.length)];
    const links = this.nodes[p.a].links;
    this.setLink(p, links[Math.floor(Math.random() * links.length)]);
    p.t = Math.random() * p.len;
    p.wait = Math.random() < 0.14 ? 8 + Math.random() * 40 : 0; // some people just stand around
    const [x, y, z, h] = this.target(p);
    p.x = x; p.y = y; p.z = z;
    p.heading = p.wait ? h + Math.PI / 2 + (Math.random() - 0.5) : h;
    p.moving = p.wait ? 0 : 1;
    return true;
  }

  private setLink(p: Ped, l: Link): void {
    const A = this.nodes[p.a], B = this.nodes[l.to];
    p.b = l.to;
    p.link = l;
    p.len = Math.hypot(B.x - A.x, B.z - A.z) || 0.01;
    p.t = 0;
  }

  /** Where the person should be on their current segment: [x, y, z, heading]. */
  private target(p: Ped): [number, number, number, number] {
    const A = this.nodes[p.a], B = this.nodes[p.b];
    const dx = (B.x - A.x) / p.len, dz = (B.z - A.z) / p.len;
    const off = p.link.off + p.jitter;
    return [A.x + dx * p.t + dz * off, p.link.y, A.z + dz * p.t - dx * off, Math.atan2(-dx, -dz)];
  }

  /**
   * (fx, fz): the player (or camera) position; (dirX, dirZ): where the camera looks, on the ground plane;
   * (px, pz): somebody to make way for (the player), if any.
   */
  update(dt: number, fx: number, fz: number, dirX: number, dirZ: number, px = Infinity, pz = Infinity): void {
    for (let i = 0; i < this.active; i++) {
      const p = this.peds[i];
      if (p.fresh) {
        // new arrivals fill the streets all around the player (nobody right on top of them)
        this.place(p, fx, fz, 6, SPAWN_MAX, 0, 0);
        p.fresh = false;
      }
      if (Math.hypot(p.x - fx, p.z - fz) > DESPAWN) this.place(p, fx, fz, SPAWN_MIN, SPAWN_MAX, dirX, dirZ);
      const blocked = Math.hypot(p.x - px, p.z - pz) < 0.9;
      let walking = false;
      if (p.wait > 0) p.wait -= dt;
      else if (!blocked) {
        walking = true;
        p.t += p.speed * dt;
        if (p.t >= p.len) {
          // junction: any street except straight back, unless it is a dead end
          const here = p.b, from = p.a;
          const opts = this.nodes[here].links.filter((l) => l.to !== from);
          p.a = here;
          this.setLink(p, opts.length ? opts[Math.floor(Math.random() * opts.length)] : this.nodes[here].links[0]);
          if (Math.random() < 0.05) p.wait = 2 + Math.random() * 6;
        }
      }
      const [tx, ty, tz, th] = this.target(p);
      const k = Math.min(1, dt * 5);
      p.x += (tx - p.x) * k;
      p.y += (ty - p.y) * k;
      p.z += (tz - p.z) * k;
      if (p.wait <= 0) {
        const d = Math.atan2(Math.sin(th - p.heading), Math.cos(th - p.heading));
        p.heading += d * Math.min(1, dt * 6);
      }
      p.moving += ((walking ? 1 : 0) - p.moving) * Math.min(1, dt * 6);
      p.phase += p.speed * dt * 4.2 * p.moving / p.scale;
    }
    this.write();
  }

  private write(): void {
    const P = this.parts;
    for (let i = 0; i < this.active; i++) {
      const p = this.peds[i];
      const swing = Math.sin(p.phase) * 0.55 * p.moving;
      const bob = Math.abs(Math.cos(p.phase)) * 0.025 * p.moving;
      ROOT.compose(V.set(p.x, p.y + bob * p.scale, p.z), Q.setFromAxisAngle(UP, p.heading), S.setScalar(p.scale));
      P.torso.setMatrixAt(i, ROOT);
      P.head.setMatrixAt(i, ROOT);
      P.hair.setMatrixAt(i, ROOT);
      P.longHair.setMatrixAt(i, p.kind >= 2 ? ROOT : ZERO);
      if (p.skirt) P.skirt.setMatrixAt(i, M.copy(ROOT).multiply(L.makeTranslation(0, 0.94, 0)).scale(V.set(1, p.skirt, 1)));
      else P.skirt.setMatrixAt(i, ZERO);
      const legSwing = p.kind === 3 ? swing * 0.45 : swing; // short steps in a sari
      for (const s of [0, 1]) {
        const sx = s ? 0.1 : -0.1, sign = s ? 1 : -1;
        M.copy(ROOT).multiply(L.makeTranslation(sx, 0.9, 0)).multiply(R.makeRotationX(legSwing * sign));
        P.leg.setMatrixAt(i * 2 + s, M);
        P.feet.setMatrixAt(i * 2 + s, M);
        M.copy(ROOT).multiply(L.makeTranslation(sx * 2.35, 1.49, 0)).multiply(R.makeRotationX(-swing * 0.75 * sign));
        P.sleeve.setMatrixAt(i * 2 + s, M);
        P.forearm.setMatrixAt(i * 2 + s, M);
      }
    }
    for (const m of Object.values(P)) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const V = new THREE.Vector3(), S = new THREE.Vector3(), Q = new THREE.Quaternion();
const ROOT = new THREE.Matrix4(), M = new THREE.Matrix4(), L = new THREE.Matrix4(), R = new THREE.Matrix4();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** Body parts in model space: 1.8 m tall at scale 1, facing -Z, limbs hanging from their pivot at the origin. */
function geometries() {
  const hang = (r: number, len: number, y = 0) => new THREE.CapsuleGeometry(r, len, 2, 6).translate(0, -len / 2 - r + y, 0);
  const merge = (list: THREE.BufferGeometry[]) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)))!;
  const torso = merge([
    new THREE.CylinderGeometry(0.19, 0.22, 0.62, 8).translate(0, 1.21, 0),
    new THREE.SphereGeometry(0.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.06, 0.5, 1).translate(0, 1.5, 0),
  ]).scale(1, 1, 0.68);
  const head = merge([
    new THREE.SphereGeometry(0.115, 10, 8).scale(0.95, 1.12, 1).translate(0, 1.72, 0),
    new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8).translate(0, 1.58, 0),
    new THREE.SphereGeometry(0.02, 6, 4).translate(0, 1.71, -0.113), // nose, so the facing direction reads
  ]);
  const hair = new THREE.SphereGeometry(0.123, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.52).rotateX(0.55)
    .scale(1, 1.12, 1.05).translate(0, 1.735, 0.012);
  const longHair = merge([
    new THREE.CapsuleGeometry(0.05, 0.3, 2, 6).scale(1.5, 1, 0.7).translate(0, 1.5, 0.1), // plait / hair down the back
    new THREE.SphereGeometry(0.06, 8, 6).translate(0, 1.7, 0.1),
  ]);
  // kurta / sari below the waist: unit height hanging from y = 0, flaring slightly
  const skirt = new THREE.CylinderGeometry(0.2, 0.25, 1, 10, 1, true).translate(0, -0.5, 0).scale(1, 1, 0.74);
  const forearm = merge([hang(0.045, 0.26, -0.32), new THREE.SphereGeometry(0.05, 6, 5).scale(0.8, 1.1, 1).translate(0, -0.66, 0)]);
  const feet = new THREE.BoxGeometry(0.1, 0.05, 0.24).translate(0, -0.875, -0.04);
  return { leg: hang(0.075, 0.7), torso, skirt, sleeve: hang(0.056, 0.26), forearm, head, hair, longHair, feet };
}
