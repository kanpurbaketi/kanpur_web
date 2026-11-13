import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { walkAlong } from './city';
import { hash2, MapData, P2 } from './types';
import { beamMaterial, NIGHT } from './night';
import { loadPBR, PBRPart } from './vehicleModels';

/*
 Street props modelled in Blender (tools/blender/build_models.py -> public/models/*.glb):
   Traffic: city buses, CNG autos and e-rickshaws driving the road network around the player.
   Stalls:  panipuri stalls standing at the roadside.
 Every model is vertex-coloured, so each kind is one InstancedMesh for its body and one for its glass.
*/

const MAJOR = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'secondary_link', 'trunk_link', 'primary_link']);

interface Parts { body: THREE.BufferGeometry; glass?: THREE.BufferGeometry; pbr?: PBRPart[] }

async function loadModel(name: string): Promise<Parts> {
  const gltf = await new GLTFLoader().loadAsync(`models/${name}.glb`);
  gltf.scene.updateMatrixWorld(true);
  const out: Partial<Parts> = {};
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    if (/glass/i.test(mesh.name) || /glass/i.test(mesh.parent?.name ?? '')) out.glass = g;
    else out.body = g;
  });
  if (!out.body) throw new Error(`model ${name} has no body mesh`);
  return out as Parts;
}

const paint = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15 });
const glass = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.06, metalness: 0.3 });

// ---------------------------------------------------------------------------------------------
// Traffic

interface Kind { name: string; count: number; speed: number; halfL: number; halfW: number; majorOnly: boolean }
interface Link { to: number; off: number; bus: boolean }
interface Node { x: number; z: number; links: Link[] }
interface Vehicle {
  kind: number; slot: number;
  vmax: number; v: number;
  a: number; b: number; link: Link; t: number; len: number;
  x: number; z: number; heading: number; fresh: boolean;
}

const SPAWN_MIN = 90, SPAWN_MAX = 230, DESPAWN = 265;
const CAR_COLOURS = ['#e9e7e0', '#e9e7e0', '#a72a2a', '#8d9196', '#2b4c8c', '#d8d3c4', '#5a1f1f', '#e9e7e0'];

/** headlamps in model space (x, y, z), and the pool of light each throws on the road ahead (width, length) */
const LAMPS: Record<string, { at: [number, number, number][]; pool: [number, number] }> = {
  bus: { at: [[-0.95, 0.85, 4.78], [0.95, 0.85, 4.78]], pool: [3.2, 13] },
  auto: { at: [[0, 0.78, 1.5]], pool: [2.6, 8] },
  maruti: { at: [[-0.5, 0.68, 1.68], [0.5, 0.68, 1.68]], pool: [3.0, 11] },
  tirri: { at: [[0, 0.95, 1.6]], pool: [2.4, 7] },
};

export class Traffic {
  readonly group = new THREE.Group();
  private nodes: Node[] = [];
  private cars: Vehicle[] = [];
  private meshes: { body: THREE.InstancedMesh; glass?: THREE.InstancedMesh; extra?: THREE.InstancedMesh[] }[] = [];
  /** night only: the lamp lenses and the pools of light they throw on the road */
  private lenses: THREE.InstancedMesh | null = null;
  private pools: THREE.InstancedMesh | null = null;

  static async create(map: MapData, desktop: boolean): Promise<Traffic> {
    const kinds: Kind[] = [
      { name: 'bus', count: desktop ? 5 : 3, speed: 7.5, halfL: 4.8, halfW: 1.3, majorOnly: true },
      { name: 'auto', count: desktop ? 16 : 9, speed: 6.5, halfL: 1.45, halfW: 0.7, majorOnly: false },
      { name: 'tirri', count: desktop ? 16 : 9, speed: 4.5, halfL: 1.55, halfW: 0.62, majorOnly: false },
      { name: 'maruti', count: desktop ? 6 : 3, speed: 6.2, halfL: 1.75, halfW: 0.78, majorOnly: false },
    ];
    const parts: Parts[] = await Promise.all(kinds.map(async (k) => (k.name === 'maruti' ? { body: new THREE.BufferGeometry(), pbr: await loadPBR('maruti') } : loadModel(k.name))));
    return new Traffic(map, kinds, parts);
  }

  private constructor(map: MapData, private kinds: Kind[], parts: Parts[]) {
    this.buildGraph(map);
    const im = (g: THREE.BufferGeometry, m: THREE.Material, n: number) => {
      const mesh = new THREE.InstancedMesh(g, m, n);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // instances move around the whole map
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      return mesh;
    };
    kinds.forEach((k, ki) => {
      const p = parts[ki];
      if (p.pbr) {
        const ims = p.pbr.map(({ geo, mat }) => {
          const m = im(geo, mat, k.count);
          if (mat.name === 'glass') m.castShadow = false;
          if (mat.name === 'paint') for (let i = 0; i < k.count; i++) m.setColorAt(i, new THREE.Color(CAR_COLOURS[(i * 7 + 3) % CAR_COLOURS.length]));
          return m;
        });
        this.meshes.push({ body: ims[0], extra: ims.slice(1) });
      } else {
        this.meshes.push({ body: im(p.body, paint(), k.count), glass: p.glass && im(p.glass, glass(), k.count) });
      }
      for (let i = 0; i < k.count; i++) {
        this.cars.push({
          kind: ki, slot: i, vmax: k.speed * (0.85 + Math.random() * 0.3), v: 0,
          a: 0, b: 0, link: { to: 0, off: 0, bus: false }, t: 0, len: 1, x: 0, z: 0, heading: 0, fresh: true,
        });
      }
    });
    if (NIGHT) {
      const n = kinds.reduce((a, k) => a + k.count * LAMPS[k.name].at.length, 0);
      this.lenses = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: '#fff3d6', toneMapped: false }), n);
      this.pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), beamMaterial(0.4), n);
      for (const m of [this.lenses, this.pools]) {
        m.frustumCulled = false;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.userData.noAO = true;
        this.group.add(m);
      }
      this.pools.renderOrder = 2;
    }
  }

  /** A moving vehicle at (x, z) (a walker of radius r), if any: its velocity, so it can knock the walker over. */
  hit(x: number, z: number, r: number): { vx: number; vz: number; speed: number } | null {
    for (const c of this.cars) {
      if (c.fresh || c.v < 0.4) continue;
      const k = this.kinds[c.kind];
      const fxv = Math.sin(c.heading), fzv = Math.cos(c.heading);
      const dx = x - c.x, dz = z - c.z;
      if (Math.abs(dx) > 7 || Math.abs(dz) > 7) continue;
      const along = dx * fxv + dz * fzv, side = dx * fzv - dz * fxv;
      if (Math.abs(along) < k.halfL + r && Math.abs(side) < k.halfW + r) return { vx: fxv * c.v, vz: fzv * c.v, speed: c.v };
    }
    return null;
  }

  /** where the vehicles are (for tests) */
  positions(): { kind: string; x: number; z: number; heading: number }[] {
    return this.cars.filter((c) => !c.fresh).map((c) => ({ kind: this.kinds[c.kind].name, x: c.x, z: c.z, heading: c.heading }));
  }

  /** Road network. Two-way roads get a lane each way (keep left); one-way roads only run forward. */
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
      if (r.bridge || r.w < 3.5) continue;
      const off = r.oneway ? 0 : Math.max(0.9, Math.min(2.2, r.w / 4));
      const bus = MAJOR.has(r.cls) && r.w >= 6.5;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = nodeAt(r.pts[i][0], r.pts[i][1]), b = nodeAt(r.pts[i + 1][0], r.pts[i + 1][1]);
        if (a === b) continue;
        this.nodes[a].links.push({ to: b, off, bus });
        if (!r.oneway) this.nodes[b].links.push({ to: a, off, bus });
      }
    }
  }

  private usable(c: Vehicle, l: Link): boolean {
    return l.bus || !this.kinds[c.kind].majorOnly;
  }

  private place(c: Vehicle, fx: number, fz: number, min: number, max: number, dirX: number, dirZ: number): void {
    const cands: number[] = [];
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const dx = n.x - fx, dz = n.z - fz, d = Math.hypot(dx, dz);
      if (d < min || d > max) continue;
      if (d < 150 && dx * dirX + dz * dirZ > 0.2 * d) continue; // not where the camera is looking
      if (!n.links.some((l) => this.usable(c, l))) continue;
      // keep clear of vehicles already there
      if (this.cars.some((o) => o !== c && !o.fresh && Math.hypot(o.x - n.x, o.z - n.z) < 14)) continue;
      cands.push(i);
    }
    if (!cands.length) return; // try again next frame
    c.a = cands[Math.floor(Math.random() * cands.length)];
    const links = this.nodes[c.a].links.filter((l) => this.usable(c, l));
    this.setLink(c, links[Math.floor(Math.random() * links.length)]);
    c.t = Math.random() * c.len * 0.5;
    const [x, z, h] = this.target(c);
    c.x = x; c.z = z; c.heading = h;
    c.v = c.vmax;
    c.fresh = false;
  }

  private setLink(c: Vehicle, l: Link): void {
    const A = this.nodes[c.a], B = this.nodes[l.to];
    c.b = l.to;
    c.link = l;
    c.len = Math.hypot(B.x - A.x, B.z - A.z) || 0.01;
    c.t = 0;
  }

  private target(c: Vehicle): [number, number, number] {
    const A = this.nodes[c.a], B = this.nodes[c.b];
    const dx = (B.x - A.x) / c.len, dz = (B.z - A.z) / c.len;
    // (dz, -dx) is the left of the direction of travel
    return [A.x + dx * c.t + dz * c.link.off, A.z + dz * c.t - dx * c.link.off, Math.atan2(dx, dz)];
  }

  /** (fx, fz): player / camera; (dirX, dirZ): camera look direction; (px, pz): the player to stop for. */
  update(dt: number, fx: number, fz: number, dirX: number, dirZ: number, px = Infinity, pz = Infinity): void {
    for (const c of this.cars) {
      if (c.fresh) this.place(c, fx, fz, 25, SPAWN_MAX, 0, 0);
      else if (Math.hypot(c.x - fx, c.z - fz) > DESPAWN) {
        c.fresh = true;
        this.place(c, fx, fz, SPAWN_MIN, SPAWN_MAX, dirX, dirZ);
      }
      if (c.fresh) continue;
      const k = this.kinds[c.kind];
      const fxv = Math.sin(c.heading), fzv = Math.cos(c.heading); // forward
      let want = c.vmax;
      // the player in the way: stop
      {
        const dx = px - c.x, dz = pz - c.z;
        const ahead = dx * fxv + dz * fzv, side = Math.abs(dx * fzv - dz * fxv);
        if (ahead > -k.halfL && ahead < k.halfL + 4.5 && side < k.halfW + 0.9) want = 0;
      }
      // a slower vehicle ahead in the same direction: follow it
      for (const o of this.cars) {
        if (o === c || o.fresh) continue;
        const dx = o.x - c.x, dz = o.z - c.z;
        const ahead = dx * fxv + dz * fzv;
        if (ahead <= 0) continue;
        const gap = ahead - k.halfL - this.kinds[o.kind].halfL;
        if (gap > 7 || Math.abs(dx * fzv - dz * fxv) > k.halfW + 0.9) continue;
        if (Math.sin(o.heading) * fxv + Math.cos(o.heading) * fzv < 0.3) continue; // oncoming / crossing
        want = Math.min(want, gap < 1.5 ? 0 : o.v);
      }
      c.v += Math.max(-9 * dt, Math.min(2.5 * dt, want - c.v));
      c.t += c.v * dt;
      if (c.t >= c.len) {
        const here = c.b, from = c.a;
        const all = this.nodes[here].links.filter((l) => this.usable(c, l));
        const opts = all.filter((l) => l.to !== from);
        c.a = here;
        if (opts.length) this.setLink(c, opts[Math.floor(Math.random() * opts.length)]);
        else if (all.length) this.setLink(c, all[0]); // dead end: turn round
        else {
          c.fresh = true; // one-way street with no way on: leave the map here
          continue;
        }
      }
      const [tx, tz, th] = this.target(c);
      const s = Math.min(1, dt * 3.5);
      c.x += (tx - c.x) * s;
      c.z += (tz - c.z) * s;
      c.heading += Math.atan2(Math.sin(th - c.heading), Math.cos(th - c.heading)) * s;
    }
    this.write();
  }

  /** Keep a walker out of the vehicles: returns the corrected [x, z]. */
  pushOut(x: number, z: number, r: number): [number, number] {
    for (const c of this.cars) {
      if (c.fresh) continue;
      const k = this.kinds[c.kind];
      const fxv = Math.sin(c.heading), fzv = Math.cos(c.heading);
      const dx = x - c.x, dz = z - c.z;
      const along = dx * fxv + dz * fzv, side = dx * fzv - dz * fxv;
      const pa = k.halfL + r - Math.abs(along), ps = k.halfW + r - Math.abs(side);
      if (pa <= 0 || ps <= 0) continue;
      if (ps < pa) {
        const d = Math.sign(side || 1) * ps;
        x += fzv * d;
        z -= fxv * d;
      } else {
        const d = Math.sign(along || 1) * pa;
        x += fxv * d;
        z += fzv * d;
      }
    }
    return [x, z];
  }

  private write(): void {
    for (const c of this.cars) {
      if (c.fresh) M.copy(ZERO);
      else M.makeRotationY(c.heading).setPosition(c.x, 0.05, c.z);
      const m = this.meshes[c.kind];
      m.body.setMatrixAt(c.slot, M);
      m.glass?.setMatrixAt(c.slot, M);
      if (m.extra) for (const e of m.extra) e.setMatrixAt(c.slot, M);
    }
    if (this.lenses && this.pools) {
      let n = 0;
      for (const c of this.cars) {
        const L = LAMPS[this.kinds[c.kind].name];
        for (const [lx, ly, lz] of L.at) {
          if (c.fresh) { this.lenses.setMatrixAt(n, ZERO); this.pools.setMatrixAt(n, ZERO); n++; continue; }
          const R = M.makeRotationY(c.heading);
          const s = Math.sin(c.heading), co = Math.cos(c.heading);
          const px = c.x + lx * co + lz * s, pz = c.z - lx * s + lz * co;
          this.lenses.setMatrixAt(n, M2.copy(R).setPosition(px, ly + 0.05, pz));
          // the pool starts at the lamp and runs ahead along the road
          const w = L.pool[0], len = L.pool[1];
          const cx = px + s * len * 0.5, cz = pz + co * len * 0.5;
          this.pools.setMatrixAt(n, M2.copy(R).setPosition(cx, 0.1, cz).scale(V3.set(w, 1, len)));
          n++;
        }
      }
      this.lenses.instanceMatrix.needsUpdate = true;
      this.pools.instanceMatrix.needsUpdate = true;
    }
    for (const m of this.meshes) {
      m.body.instanceMatrix.needsUpdate = true;
      if (m.glass) m.glass.instanceMatrix.needsUpdate = true;
      if (m.extra) for (const e of m.extra) e.instanceMatrix.needsUpdate = true;
    }
  }
}

const M = new THREE.Matrix4(), M2 = new THREE.Matrix4(), V3 = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

// ---------------------------------------------------------------------------------------------
// Panipuri stalls

export interface Stalls { mesh: THREE.InstancedMesh; posts: [number, number, number][] }

/**
 * Stalls at the roadside, facing the road: one close to `near` (the spawn), the rest spread over the map.
 * `occupied` keeps them off buildings and water, `avoid` off poles, lamps and trees.
 */
export async function makeStalls(map: MapData, occupied: (x: number, z: number) => boolean,
                                 avoid: [number, number, number][], near: P2, max = 14): Promise<Stalls> {
  const { body } = await loadModel('stall');
  const cands: { x: number; z: number; y: number; rot: number; d: number }[] = [];
  for (const r of map.roads) {
    if (r.bridge || r.w < 5 || r.cls === 'trunk') continue;
    const walk = r.sidewalk === 'both' || r.sidewalk === 'yes';
    const side = r.oneway || hash2(r.id, 5) < 0.5 ? 1 : -1; // one-way halves: the outer (left) edge, not the median
    walkAlong(r.pts, 30, (px, pz, dx, dz) => {
      const nx = dz * side, nz = -dx * side;
      const off = r.w / 2 + (walk ? 1.35 : 1.0);
      const x = px + nx * off, z = pz + nz * off;
      for (const [ox, oz] of [[0, 0], [1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2], [nx * 1.6, nz * 1.6]]) {
        if (occupied(x + ox, z + oz)) return;
      }
      if (avoid.some(([ax, az]) => Math.hypot(ax - x, az - z) < 2)) return;
      cands.push({ x, z, y: walk ? 0.16 : 0.02, rot: Math.atan2(-nx, -nz), d: Math.hypot(x - near[0], z - near[1]) });
    }, 8 + hash2(r.id, 9) * 14);
  }
  cands.sort((a, b) => a.d - b.d);
  const picked: typeof cands = [];
  for (const c of cands) {
    if (picked.length >= max) break;
    if (c.d < 12) continue; // not on top of the spawn point
    if (picked.every((p) => Math.hypot(p.x - c.x, p.z - c.z) > 110)) picked.push(c);
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(body, mat, picked.length);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  picked.forEach((p, i) => mesh.setMatrixAt(i, M.makeRotationY(p.rot).setPosition(p.x, p.y, p.z)));
  return { mesh, posts: picked.map((p) => [p.x, p.z, 0.65]) };
}
