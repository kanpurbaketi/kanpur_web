import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { walkAlong } from './city';
import { hash2, MapData, P2 } from './types';
import { beamMaterial, NIGHT } from './night';
import { loadPBR, loadWheels, PBRPart, Wheel } from './vehicleModels';
import { FigureKind, Pose, riderParts } from './figures';
import { inMela } from './melaSite';
import { Body, newBody, SPECS, step } from './vehicleSim';

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

/** Models with real materials (photo-textured ones from tools/triposr, the scripted Maruti) keep them; the old vertex-coloured ones get the shared paint. */
async function loadAny(name: string): Promise<Parts> {
  const pbr = (await loadPBR(name)).filter((p) => !p.wheel);     // the wheels are drawn on their own, turning
  if (pbr.some((p) => p.mat.map || p.mat.name === 'paint')) return { body: new THREE.BufferGeometry(), pbr };
  return loadModel(name);
}

const paint = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15 });
const glass = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.06, metalness: 0.3 });

// ---------------------------------------------------------------------------------------------
// Traffic

/** somebody on a vehicle: the pose, where they sit (x, y, z in the vehicle's frame), who, and whether the seat is sometimes empty */
interface Seat { pose: Pose; at: [number, number, number]; who?: FigureKind[]; scale?: number; maybe?: boolean }
/** `edge`: how far toward the kerb of its lane it keeps (cycles and bikes ride at the edge, and are overtaken) */
interface Kind { name: string; count: number; speed: number; halfL: number; halfW: number; majorOnly: boolean; edge?: number; seats?: Seat[] }
const RIDER_LOOKS = 3;      // different people per seat of each kind of vehicle
interface Link { to: number; off: number; bus: boolean }
interface Node { x: number; z: number; links: Link[] }
export interface Vehicle {
  kind: number; slot: number;
  vmax: number; v: number;
  a: number; b: number; link: Link; t: number; len: number;
  x: number; z: number; heading: number; fresh: boolean;
  /** close to the player: drawn with the full model and casting a shadow (else the far, cut-down model) */
  near: boolean;
  /** Ramu has it: driven by the player, not the traffic */
  player: boolean;
  /** left where Ramu got off: it rolls to a stop and stands there until it is out of the way (recycled) */
  parked: boolean;
  /** its people were thrown out: no riders drawn on it until it is recycled */
  empty: boolean;
  /** metres rolled (the wheels turn by dist / radius), and the front wheels' steer angle (radians, to the left) */
  dist: number; steer: number;
  /** the physics of one Ramu drives or left parked (vehicleSim.ts); null for the traffic's own */
  sim: Body | null;
  /** lamps lit: BRAKE | REVERSE | LEFT / RIGHT (indicating) */
  lamps: number;
  /** its headlamps off (Ramu switched them off: L) */
  dark: boolean;
  /** the traffic's own: the link it takes at the end of this one (chosen ahead, so it can indicate), and how long it
   * goes on indicating after the turn */
  next: Link | null; blinkT: number;
}

export const BRAKE = 1, REVERSE = 2, LEFT = 4, RIGHT = 8;

/**
 * Ramu on a vehicle: how he sits (pose, and the seat in the vehicle's frame: x to its left, y up, z forward; the cars are
 * right-hand drive) and the chase camera (distance and height of the point it looks at). How it goes: SPECS
 * (vehicleSim.ts).
 */
export interface DriverSeat { pose: 'ride' | 'drive'; at: [number, number, number]; cam: number; camH: number }
const car = (at: [number, number, number]): DriverSeat => ({ pose: 'drive', at, cam: 6.2, camH: 1.7 });
export const DRIVER: Record<string, DriverSeat> = {
  bus: { pose: 'drive', at: [-0.82, 1.05, 3.95], cam: 10, camH: 2.6 },
  bus_green: { pose: 'drive', at: [-0.82, 1.05, 3.95], cam: 10, camH: 2.6 },
  truck: { pose: 'drive', at: [-0.55, 1.15, 1.95], cam: 9.5, camH: 2.6 },
  autorickshaw: { pose: 'drive', at: [0, 0.42, 0.28], cam: 5.2, camH: 1.6 },
  tirri: { pose: 'drive', at: [0, 0.56, 0.42], cam: 5.2, camH: 1.6 },
  maruti: car([-0.32, 0.16, -0.05]),
  maruti_red: car([-0.32, 0.16, -0.05]),
  maruti_green: car([-0.32, 0.16, -0.05]),
  swift: car([-0.36, 0.2, -0.1]),
  ambassador: car([-0.4, 0.24, -0.1]),
  bolero: car([-0.42, 0.42, 0.0]),
  pulsar: { pose: 'ride', at: [0, 0.13, -0.3], cam: 4.6, camH: 1.5 },
  cycle: { pose: 'ride', at: [0, 0.35, -0.24], cam: 4.2, camH: 1.5 },
  rickshaw: { pose: 'ride', at: [0, 0.36, -0.02], cam: 5.6, camH: 1.7 },
};

/** a person thrown off a vehicle Ramu takes: where they land from, and how they fly (m/s) */
export interface Thrown { x: number; z: number; vx: number; vz: number; driver: boolean }

/** within NEAR_IN m of the player a vehicle is drawn in full; it goes back to the far model past NEAR_OUT m */
const NEAR_IN = 45, NEAR_OUT = 52;
/** triangle budget of each kind's far model (tools/blender/make_lod.py -> <name>_lod.glb) */
export const LOD_TRIS: Record<string, number> = {
  bus: 2500, bus_green: 2500, autorickshaw: 1800, tirri: 1800, maruti: 1800, maruti_red: 1800, maruti_green: 1800,
  swift: 2500, ambassador: 2200, bolero: 2500, truck: 2500, pulsar: 1200, cycle: 600, rickshaw: 2000,
};

/** one way of drawing a kind: an InstancedMesh per part, plus the riders, packed so only the vehicles in use are drawn */
interface Draw {
  parts: THREE.InstancedMesh[]; riders: THREE.InstancedMesh[]; n: number; rn: number[];
  /** per wheel of the kind, its parts (none in the far draw for a model's own wheels: they are in the far body, still) */
  wheels: { mesh: THREE.InstancedMesh; colours: THREE.Color[] | null }[][];
}

const SPAWN_MIN = 90, SPAWN_MAX = 230, DESPAWN = 265;
const CAR_COLOURS = ['#e9e7e0', '#e9e7e0', '#a72a2a', '#8d9196', '#2b4c8c', '#d8d3c4', '#5a1f1f', '#e9e7e0'];

/** headlamps in model space (x, y, z), and the pool of light each throws on the road ahead (width, length) */
const LAMPS: Record<string, { at: [number, number, number][]; pool: [number, number] }> = {
  bus: { at: [[-0.85, 0.8, 4.7], [0.85, 0.8, 4.7]], pool: [3.2, 13] },
  bus_green: { at: [[-0.85, 0.8, 4.7], [0.85, 0.8, 4.7]], pool: [3.2, 13] },
  autorickshaw: { at: [[0, 0.6, 1.3]], pool: [2.6, 8] },
  tirri: { at: [[0, 0.98, 1.36]], pool: [2.4, 7] },
  swift: { at: [[-0.62, 0.72, 1.6], [0.62, 0.72, 1.6]], pool: [3.0, 11] },
  ambassador: { at: [[-0.62, 0.8, 2.1], [0.62, 0.8, 2.1]], pool: [3.0, 11] },
  bolero: { at: [[-0.7, 0.98, 1.93], [0.7, 0.98, 1.93]], pool: [3.2, 12] },
  truck: { at: [[-0.8, 0.9, 2.76], [0.8, 0.9, 2.76]], pool: [3.4, 13] },
  pulsar: { at: [[0, 0.95, 0.6]], pool: [2.2, 8] },
  cycle: { at: [], pool: [0, 0] },
  rickshaw: { at: [], pool: [0, 0] },
};
for (const n of ['maruti', 'maruti_red', 'maruti_green']) LAMPS[n] = { at: [[-0.48, 0.52, 1.52], [0.48, 0.52, 1.52]], pool: [3.0, 11] };

/**
 * Rear lamps in model space (measured on rear renders): the tail / brake lamp's centre (x: one each side at ±x, 0 a
 * single one in the middle; y), and its size (w × h); they sit on the back of the body (z = -halfL). The indicators
 * go just outside them (a single tail lamp: either side of it), the reversing lamps just inside them.
 */
const REAR: Record<string, { x: number; y: number; w: number; h: number } | null> = {
  bus: { x: 1.05, y: 0.8, w: 0.22, h: 0.2 }, bus_green: { x: 1.05, y: 0.8, w: 0.22, h: 0.2 },
  autorickshaw: { x: 0.39, y: 0.68, w: 0.09, h: 0.08 }, tirri: { x: 0.39, y: 0.6, w: 0.1, h: 0.08 },
  maruti: { x: 0.56, y: 0.6, w: 0.14, h: 0.12 }, maruti_red: { x: 0.56, y: 0.6, w: 0.14, h: 0.12 }, maruti_green: { x: 0.56, y: 0.6, w: 0.14, h: 0.12 },
  swift: { x: 0.66, y: 0.85, w: 0.2, h: 0.13 }, ambassador: { x: 0.71, y: 0.89, w: 0.12, h: 0.12 },
  bolero: { x: 0.73, y: 0.92, w: 0.13, h: 0.12 }, truck: { x: 0.97, y: 0.84, w: 0.2, h: 0.14 },
  pulsar: { x: 0, y: 0.82, w: 0.12, h: 0.06 }, cycle: null, rickshaw: null,
};
const BLINK_HZ = 1.5;
const C_TAIL = new THREE.Color(0.55, 0.02, 0.01), C_BRAKE = new THREE.Color(4, 0.12, 0.05);
const C_REV = new THREE.Color(2.4, 2.4, 2.2), C_IND = new THREE.Color(3.2, 1.3, 0.05);

export class Traffic {
  readonly group = new THREE.Group();
  private nodes: Node[] = [];
  private cars: Vehicle[] = [];
  /** per kind: the near and far draws, and each part's colour per vehicle slot (null: untinted) */
  private meshes: { near: Draw; far: Draw; colours: (THREE.Color[] | null)[] }[] = [];
  /** night only: the lamp lenses and the pools of light they throw on the road */
  private lenses: THREE.InstancedMesh | null = null;
  /** per kind, per rider look: which vehicle slots it sits on */
  private seated: boolean[][][] = [];
  /** per kind, per rider look: which seat it is */
  private riderSeat: number[][] = [];
  /** the walls and posts of the world, for a vehicle Ramu drives: the corrected [x, z] for a circle of radius r */
  resolve: ((x: number, z: number, r: number) => [number, number]) | null = null;
  private pools: THREE.InstancedMesh | null = null;
  /** the small lamps: tail, brake, reversing and indicators (glowing quads, only the lit ones drawn) */
  private lamps: THREE.InstancedMesh;
  private clock = 0;
  /** every road's segments in 24 m cells: [x0, z0, x1, z1, half width] (onRoad) */
  private roadCells = new Map<string, [number, number, number, number, number][]>();

  static async create(map: MapData, desktop: boolean): Promise<Traffic> {
    const kinds: Kind[] = [
      { name: 'bus', count: desktop ? 3 : 2, speed: 7.5, halfL: 4.8, halfW: 1.3, majorOnly: true },
      { name: 'bus_green', count: desktop ? 2 : 1, speed: 7.0, halfL: 4.8, halfW: 1.3, majorOnly: true },
      { name: 'autorickshaw', count: desktop ? 16 : 9, speed: 6.5, halfL: 1.35, halfW: 0.75, majorOnly: false },      // tools/blender/import_vehicle.py
      { name: 'tirri', count: desktop ? 12 : 7, speed: 4.5, halfL: 1.42, halfW: 0.55, majorOnly: false },
      { name: 'maruti', count: desktop ? 2 : 1, speed: 6.2, halfL: 1.7, halfW: 0.75, majorOnly: false },
      { name: 'maruti_red', count: 1, speed: 6.6, halfL: 1.7, halfW: 0.75, majorOnly: false },
      { name: 'maruti_green', count: 1, speed: 5.8, halfL: 1.7, halfW: 0.75, majorOnly: false },
      // downloaded models (tools/blender/import_vehicle.py)
      { name: 'swift', count: desktop ? 4 : 2, speed: 7.2, halfL: 1.93, halfW: 0.9, majorOnly: false },
      { name: 'ambassador', count: desktop ? 3 : 1, speed: 6.0, halfL: 2.16, halfW: 0.95, majorOnly: false },
      { name: 'bolero', count: desktop ? 3 : 1, speed: 7.0, halfL: 2.0, halfW: 0.95, majorOnly: false },
      { name: 'truck', count: desktop ? 2 : 1, speed: 5.6, halfL: 2.8, halfW: 1.35, majorOnly: true },
      { name: 'pulsar', count: desktop ? 10 : 5, speed: 8.0, halfL: 1.0, halfW: 0.4, majorOnly: false, edge: 0.5,
        seats: [{ pose: 'ride', at: [0, 0.13, -0.3], who: ['boy', 'uncle', 'boy'] }] },
      { name: 'cycle', count: desktop ? 6 : 3, speed: 3.4, halfL: 0.92, halfW: 0.32, majorOnly: false, edge: 1.2,
        seats: [{ pose: 'ride', at: [0, 0.35, -0.24], who: ['uncle', 'boy'] }] },
      { name: 'rickshaw', count: desktop ? 8 : 4, speed: 2.9, halfL: 1.25, halfW: 0.6, majorOnly: false, edge: 0.9,
        seats: [{ pose: 'ride', at: [0, 0.36, -0.02], who: ['uncle'] },
          { pose: 'chair', at: [-0.24, 0.36, -1.0], scale: 0.95, maybe: true }, { pose: 'chair', at: [0.24, 0.36, -1.0], scale: 0.95, maybe: true }] },
    ];
    const parts: Parts[] = await Promise.all(kinds.map((k) => loadAny(k.name)));
    // the far models: the same parts (matched by material) cut down; a kind without one is drawn in full at any distance
    const far = await Promise.all(kinds.map(async (k, ki) => {
      const near = parts[ki].pbr;
      if (!near) return null;
      try {
        const g = await new GLTFLoader().loadAsync(`models/${k.name}_lod.glb`);
        g.scene.updateMatrixWorld(true);
        const geos = new Map<string, THREE.BufferGeometry>();
        g.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) geos.set((m.material as THREE.Material).name, m.geometry.clone().applyMatrix4(m.matrixWorld));
        });
        return near.map((p) => geos.get(p.mat.name) ?? p.geo);
      } catch {
        return null;
      }
    }));
    // the riders: for every seat a few different people, each drawn on the vehicles that are theirs
    const riders = await Promise.all(kinds.map((k, ki) => Promise.all((k.seats ?? []).flatMap((seat, si) =>
      Array.from({ length: RIDER_LOOKS }, async (_, v) => {
        const { geo, mat } = await riderParts(ki * 31 + si * 7 + v * 3 + 1, seat.pose, seat.who);
        const s = seat.scale ?? 1;
        // a figure faces -z and a vehicle +z: turn it round, then put it on the seat
        return { seat: si, look: v, mat, geo: geo.clone().rotateY(Math.PI).scale(s, s, s).translate(...seat.at) };
      })))));
    const wheels = await Promise.all(kinds.map((k) => loadWheels(k.name)));
    return new Traffic(map, kinds, parts, far, riders, wheels);
  }

  private constructor(map: MapData, private kinds: Kind[], parts: Parts[], far: (THREE.BufferGeometry[] | null)[],
    riders: { seat: number; look: number; mat: THREE.Material; geo: THREE.BufferGeometry }[][], private wheels: Wheel[][]) {
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
      // the parts: geometry and material, and the colour each vehicle slot gives it
      const list: { geo: THREE.BufferGeometry; lod: THREE.BufferGeometry; mat: THREE.Material; shadow: boolean; colours: THREE.Color[] | null }[] = [];
      const colouring = (mat: THREE.Material): THREE.Color[] | null => {
        if (mat.name === 'paint') return Array.from({ length: k.count }, (_, i) => new THREE.Color(CAR_COLOURS[(i * 7 + 3) % CAR_COLOURS.length]));
        // photo-textured models: a little variation in how clean / faded each one is
        if ((mat as THREE.MeshStandardMaterial).map) return Array.from({ length: k.count }, (_, i) => new THREE.Color().setScalar(0.78 + 0.22 * (((i * 37) % 10) / 9)));
        return null;
      };
      if (p.pbr) {
        p.pbr.forEach(({ geo, mat }, pi) => {
          list.push({ geo, lod: far[ki]?.[pi] ?? geo, mat, shadow: mat.name !== 'glass', colours: colouring(mat) });
        });
      } else {
        list.push({ geo: p.body, lod: p.body, mat: paint(), shadow: true, colours: null });
        if (p.glass) list.push({ geo: p.glass, lod: p.glass, mat: glass(), shadow: true, colours: null });
      }
      // each seat of each vehicle has one of the looks; a seat that may be empty is, on some of them.
      // index: vehicle slot -> whether this rider look sits on it, so nothing is drawn that is not there
      const seated = riders[ki].map((r) => {
        const maybe = k.seats![r.seat].maybe ? 2 : 0;
        return Array.from({ length: k.count }, (_, i) => (i * 7 + r.seat * 5) % (RIDER_LOOKS + maybe) === r.look);
      });
      const draw = (lodded: boolean): Draw => {
        const parts = list.map((q) => {
          const m = im(lodded ? q.lod : q.geo, q.mat, k.count);
          m.castShadow = q.shadow && !lodded;
          if (q.colours) m.setColorAt(0, q.colours[0]);
          return m;
        });
        const rs = riders[ki].map((r, ri) => {
          const m = im(r.geo, r.mat, Math.max(1, seated[ri].filter(Boolean).length));
          m.castShadow = !lodded;
          return m;
        });
        const ws = wheels[ki].map((w) => (lodded ? w.far : w.parts).map((q) => {
          const m = im(q.geo, q.mat, k.count);
          m.castShadow = !lodded;
          const colours = colouring(q.mat);
          if (colours) m.setColorAt(0, colours[0]);
          return { mesh: m, colours };
        }));
        return { parts, riders: rs, n: 0, rn: rs.map(() => 0), wheels: ws };
      };
      this.meshes.push({
        near: draw(false), far: draw(true), colours: list.map((q) => q.colours),
      });
      this.seated.push(seated);
      this.riderSeat.push(riders[ki].map((r) => r.seat));
      for (let i = 0; i < k.count; i++) {
        this.cars.push({
          kind: ki, slot: i, vmax: k.speed * (0.85 + Math.random() * 0.3), v: 0,
          a: 0, b: 0, link: { to: 0, off: 0, bus: false }, t: 0, len: 1, x: 0, z: 0, heading: 0, fresh: true, near: false,
          player: false, parked: false, empty: false, dist: 0, steer: 0, sim: null, lamps: 0, dark: false, next: null, blinkT: 0,
        });
      }
    });
    const lampN = kinds.reduce((a, k) => a + k.count * 10, 0);
    this.lamps = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }), lampN);
    this.lamps.setColorAt(0, C_TAIL);
    this.lamps.frustumCulled = false;
    this.lamps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.lamps.userData.noAO = true;
    this.group.add(this.lamps);
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
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [a, b] = [r.pts[i], r.pts[i + 1]], hw = r.w / 2 + 0.6;
        const cs = new Set<string>();
        for (let t = 0; t <= 1.0001; t += 0.1) for (const ox of [-hw, hw]) for (const oz of [-hw, hw]) {
          cs.add(`${Math.floor((a[0] + (b[0] - a[0]) * t + ox) / 24)},${Math.floor((a[1] + (b[1] - a[1]) * t + oz) / 24)}`);
        }
        for (const k of cs) {
          let l = this.roadCells.get(k);
          if (!l) this.roadCells.set(k, (l = []));
          l.push([a[0], a[1], b[0], b[1], hw]);
        }
      }
    }
    for (const r of map.roads) {
      if (r.bridge || r.w < 3.5) continue;
      const off = r.oneway ? 0 : Math.max(0.9, Math.min(2.2, r.w / 4));
      const bus = MAJOR.has(r.cls) && r.w >= 6.5;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = nodeAt(r.pts[i][0], r.pts[i][1]), b = nodeAt(r.pts[i + 1][0], r.pts[i + 1][1]);
        if (a === b) continue;
        // nothing drives through the mela ground
        const [p0, p1] = [r.pts[i], r.pts[i + 1]];
        if (map.area === 'moti_jheel' && [0, 0.25, 0.5, 0.75, 1].some((t) => inMela(p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, 2))) continue;
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
    c.next = null;
    c.lamps = 0;
    c.t = Math.random() * c.len * 0.5;
    const [x, z, h] = this.target(c);
    // never on top of another one: try again next frame
    const L = this.kinds[c.kind].halfL;
    if (this.cars.some((o) => o !== c && !o.fresh && Math.hypot(o.x - x, o.z - z) < L + this.kinds[o.kind].halfL + 3)) return;
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

  /** going a -> b -> n: LEFT, RIGHT, or 0 (on ahead) */
  private turnOf(a: number, b: number, n: number): number {
    const A = this.nodes[a], B = this.nodes[b], N = this.nodes[n];
    const h1 = Math.atan2(B.x - A.x, B.z - A.z), h2 = Math.atan2(N.x - B.x, N.z - B.z);
    const d = Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1));
    return d > 0.4 ? LEFT : d < -0.4 ? RIGHT : 0;
  }

  /** where the headlamps are on a vehicle (its frame) */
  headlamps(c: Vehicle): [number, number, number][] {
    return LAMPS[this.kinds[c.kind].name].at;
  }

  private target(c: Vehicle): [number, number, number] {
    const A = this.nodes[c.a], B = this.nodes[c.b];
    const dx = (B.x - A.x) / c.len, dz = (B.z - A.z) / c.len;
    // (dz, -dx) is the left of the direction of travel; bikes and cycles keep to the kerb side of their lane
    const off = c.link.off + Math.min(this.kinds[c.kind].edge ?? 0, c.link.off * 0.75);
    return [A.x + dx * c.t + dz * off, A.z + dz * c.t - dx * off, Math.atan2(dx, dz)];
  }

  /** (fx, fz): player / camera; (dirX, dirZ): camera look direction; (px, pz): the player to stop for. */
  update(dt: number, fx: number, fz: number, dirX: number, dirZ: number, px = Infinity, pz = Infinity): void {
    this.clock += dt;
    for (const c of this.cars) {
      if (c.player) continue;                 // Ramu drives it (drive())
      if (c.fresh) this.place(c, fx, fz, 25, SPAWN_MAX, 0, 0);
      else if (Math.hypot(c.x - fx, c.z - fz) > DESPAWN) {
        c.fresh = true;
        c.parked = c.empty = false;           // back in the traffic, with its people
        c.sim = null;
        c.dark = false;
        c.next = null;
        this.place(c, fx, fz, SPAWN_MIN, SPAWN_MAX, dirX, dirZ);
      }
      if (c.fresh) continue;
      if (c.parked) {                         // where Ramu left it: rolling to a stop
        this.drive(c, dt, 0, 0, true);
        continue;
      }
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
        if (gap > 7 || Math.abs(dx * fzv - dz * fxv) > k.halfW + this.kinds[o.kind].halfW + 0.12) continue;      // room to pass (a cycle at the kerb)
        if (Math.sin(o.heading) * fxv + Math.cos(o.heading) * fzv < 0.3) continue; // oncoming / crossing
        want = Math.min(want, gap < 1.5 ? 0 : o.v);
      }
      // anything in its way (a vehicle crossing or merging at a junction, one stopped or parked, the one Ramu drives):
      // wait for it. Two that are each in the other's way: the one first in the list goes.
      if (want > 0) {
        for (let oi = 0; oi < this.cars.length; oi++) {
          const o = this.cars[oi];
          if (o === c || o.fresh || Math.abs(o.x - c.x) > 14 || Math.abs(o.z - c.z) > 14) continue;
          const dot = Math.sin(o.heading) * fxv + Math.cos(o.heading) * fzv;
          if (dot < -0.7 && Math.abs(o.v) > 0.3 && !o.player && !o.parked) continue;   // oncoming in its own lane
          if ((o.x - c.x) * fxv + (o.z - c.z) * fzv <= 0) continue;     // behind it: it moves away from that one
          if (!this.inWay(c, o)) continue;
          // each in the other's way (two meeting at a junction): the one first in the list goes, the other waits
          if (!o.player && !o.parked && this.inWay(o, c) && oi > this.cars.indexOf(c)) continue;
          want = 0;
          break;
        }
      }
      const slowing = want < c.v - 0.3 || c.v < 0.3;
      c.v += Math.max(-9 * dt, Math.min(2.5 * dt, want - c.v));
      c.t += c.v * dt;
      // the way on is chosen ~30 m before the junction: indicating from there if it is a turn
      if (!c.next && c.t > c.len - 30) {
        const all = this.nodes[c.b].links.filter((l) => this.usable(c, l));
        const opts = all.filter((l) => l.to !== c.a);
        c.next = opts.length ? opts[Math.floor(Math.random() * opts.length)] : all[0] ?? null;
        if (!c.next) c.next = { to: -1, off: 0, bus: false };
      }
      c.blinkT -= dt;
      let side = 0;
      if (c.next && c.next.to >= 0) side = this.turnOf(c.a, c.b, c.next.to);
      else if (c.blinkT > 0) side = c.lamps & (LEFT | RIGHT);
      if (c.t >= c.len) {
        const here = c.b, l = c.next;
        c.next = null;
        if (!l || l.to < 0) {
          c.fresh = true; // one-way street with no way on: leave the map here
          continue;
        }
        if (side) c.blinkT = 1.2;      // on through the turn
        c.a = here;
        this.setLink(c, l);
      }
      c.lamps = (slowing ? BRAKE : 0) | side;
      const [tx, tz, th] = this.target(c);
      const s = Math.min(1, dt * 3.5);
      c.x += (tx - c.x) * s;
      c.z += (tz - c.z) * s;
      const turn = Math.atan2(Math.sin(th - c.heading), Math.cos(th - c.heading)) * s;
      c.heading += turn;
      c.dist += c.v * dt;
      // the front wheels point the way it is turning: steer = atan(turn rate × wheelbase / speed)
      const lock = Math.max(-0.55, Math.min(0.55, Math.atan((turn / Math.max(dt, 1e-3)) * this.wheelbase(c.kind) / Math.max(1, c.v))));
      c.steer += (lock - c.steer) * Math.min(1, dt * 6);
    }
    this.separate();
    this.write(fx, fz);
  }

  /** The vehicle nearest a point, if its body is within `reach` m of it (not one already taken). */
  nearest(x: number, z: number, reach: number): Vehicle | null {
    let best: Vehicle | null = null, bd = reach;
    for (const c of this.cars) {
      if (c.fresh || c.player) continue;
      const k = this.kinds[c.kind];
      const fxv = Math.sin(c.heading), fzv = Math.cos(c.heading), dx = x - c.x, dz = z - c.z;
      const along = Math.abs(dx * fxv + dz * fzv) - k.halfL, side = Math.abs(dx * fzv - dz * fxv) - k.halfW;
      const d = Math.hypot(Math.max(0, along), Math.max(0, side));
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  kindOf(c: Vehicle): string {
    return this.kinds[c.kind].name;
  }

  /** how Ramu sits on it and how it goes */
  seatOf(c: Vehicle): DriverSeat {
    return DRIVER[this.kinds[c.kind].name];
  }

  /** a point in the vehicle's frame (x to its left, z forward) in the world */
  toWorld(c: Vehicle, x: number, z: number): [number, number] {
    const s = Math.sin(c.heading), co = Math.cos(c.heading);
    return [c.x + x * co + z * s, c.z - x * s + z * co];
  }

  /**
   * Ramu takes the vehicle: from now on drive() moves it. Whoever was on it is thrown off: the driver (every vehicle has
   * one, seen or not) out of their side, the passengers out of theirs. Returns them, for the crowd to put on the ground.
   */
  board(c: Vehicle): Thrown[] {
    const k = this.kinds[c.kind], seat = DRIVER[k.name];
    const out: { x: number; z: number; driver: boolean }[] = [];
    if (k.seats) {
      if (!c.empty) {
        const seated = this.seated[c.kind];
        k.seats.forEach((st, si) => {
          if (seated.some((on, ri) => on[c.slot] && this.riderSeat[c.kind][ri] === si)) out.push({ x: st.at[0], z: st.at[2], driver: si === 0 });
        });
      }
    } else if (!c.empty) out.push({ x: seat.at[0], z: seat.at[2], driver: true });
    c.player = true;
    c.parked = false;
    c.empty = true;
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading), lx = fz, lz = -fx;
    return out.map((o) => {
      const side = o.x > 0.05 ? 1 : -1;         // out of their own side (a rider in the middle: to the right, the kerb is left)
      const [x, z] = this.toWorld(c, side * (k.halfW + 0.35), o.z);
      const push = 3.2 + Math.random() * 1.2;
      return { x, z, vx: lx * side * push + fx * c.v * 0.6, vz: lz * side * push + fz * c.v * 0.6, driver: o.driver };
    });
  }

  /** Ramu gets off: the vehicle rolls to a stop and stays. Returns where he steps down (beside his seat, to its right). */
  leave(c: Vehicle): [number, number] {
    const k = this.kinds[c.kind], seat = DRIVER[k.name];
    c.player = false;
    c.parked = true;
    let [x, z] = this.toWorld(c, -(k.halfW + 0.55), seat.at[2]);
    if (this.resolve) [x, z] = this.resolve(x, z, 0.35);
    return [x, z];
  }

  /** on a road (or its verge): full grip; off it (dirt, grass) less */
  onRoad(x: number, z: number): boolean {
    const l = this.roadCells.get(`${Math.floor(x / 24)},${Math.floor(z / 24)}`);
    if (!l) return false;
    for (const [x0, z0, x1, z1, hw] of l) {
      const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz;
      const t = L2 ? Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / L2)) : 0;
      if ((x - x0 - dx * t) ** 2 + (z - z0 - dz * t) ** 2 < hw * hw) return true;
    }
    return false;
  }

  /**
   * Move a vehicle Ramu drives (or left parked) by its physics (vehicleSim.ts): `throttle` -1..1 (back: brake, then
   * reverse), `steer` -1..1 (to the left), `handbrake`. It bounces off walls and posts, and shoves the vehicles it hits.
   */
  drive(c: Vehicle, dt: number, throttle: number, steer: number, handbrake: boolean): void {
    const k = this.kinds[c.kind], spec = SPECS[k.name];
    if (!c.sim) c.sim = newBody(c.x, c.z, c.heading, c.v);
    const b = c.sim;
    b.x = c.x; b.z = c.z; b.heading = c.heading;      // (pushed by someone else since)
    // the others near it, as circles; which vehicle each circle is
    const near: Vehicle[] = [], circles: [number, number, number, number][] = [];
    for (const o of this.cars) {
      if (o === c || o.fresh || Math.abs(o.x - c.x) > 12 || Math.abs(o.z - c.z) > 12) continue;
      const ok = this.kinds[o.kind], m = SPECS[ok.name].mass;
      for (const [x, z] of this.circles(o)) { circles.push([x, z, ok.halfW, m]); near.push(o); }
    }
    step(b, spec, { wb: this.wheelbase(c.kind), halfL: k.halfL, halfW: k.halfW },
      { throttle, steer, handbrake, hold: c.parked }, {
        grip: (x, z) => (this.onRoad(x, z) ? 1 : 0.6),
        resolve: (x, z, r) => (this.resolve ? this.resolve(x, z, r) : [x, z]),
        others: () => circles,
        hit: (i, jx, jz) => {
          const o = near[i], mo = SPECS[this.kinds[o.kind].name].mass;
          if (o.sim) {                          // one left parked: it is shoved
            const fx = Math.sin(o.heading), fz = Math.cos(o.heading);
            o.sim.vx += (jx * fx + jz * fz) / mo;
            o.sim.vy += (jx * fz - jz * fx) / mo;
          } else if (Math.hypot(jx, jz) / mo > 0.3) o.v = 0;     // the traffic's own: stops
        },
      }, dt);
    c.x = b.x; c.z = b.z; c.heading = b.heading;
    c.v = b.vx;
    // lamps: braking (back against the way it rolls, or the hand brake), reversing, and indicating when steering slowly
    // (pulling out, turning a corner)
    if (c.parked) c.lamps = 0;
    else {
      const braking = (throttle < 0 && b.vx > 0.4) || (throttle > 0 && b.vx < -0.4) || handbrake;
      const ind = Math.abs(b.vx) < 6 && Math.abs(steer) > 0.3 ? (steer > 0 ? LEFT : RIGHT) : 0;
      c.lamps = (braking ? BRAKE : 0) | (b.gear < 0 ? REVERSE : 0) | ind;
    }
    c.steer = b.steer;
    c.dist += b.vx * dt;
  }

  /**
   * Last word: no two vehicles inside each other (a long bus swinging its tail round a corner). The traffic's own are
   * pushed apart, half each; one Ramu drives or left parked does not give way (drive() keeps his out of the others).
   */
  private separate(): void {
    const cs = this.cars.filter((c) => !c.fresh);
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i];
      for (let j = i + 1; j < cs.length; j++) {
        const b = cs[j];
        if (Math.abs(a.x - b.x) > 12 || Math.abs(a.z - b.z) > 12) continue;
        const fixedA = a.player || a.parked, fixedB = b.player || b.parked;
        if (fixedA && fixedB) continue;
        const need = this.kinds[a.kind].halfW + this.kinds[b.kind].halfW;
        let px = 0, pz = 0, deep = 0;
        const cb = this.circles(b);
        for (const [ax, az] of this.circles(a)) for (const [bx, bz] of cb) {
          const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
          if (d >= need || need - d <= deep) continue;
          deep = need - d;
          [px, pz] = d > 1e-4 ? [dx / d, dz / d] : [Math.cos(i), Math.sin(i)];
        }
        if (!deep) continue;
        const ka = fixedA ? 0 : fixedB ? 1 : 0.5, kb = 1 - ka;
        a.x -= px * deep * ka; a.z -= pz * deep * ka;
        b.x += px * deep * kb; b.z += pz * deep * kb;
      }
    }
  }

  /** front axle to rear axle, m (from the wheels; for a kind without, most of its length) */
  wheelbase(kind: number): number {
    const ws = this.wheels[kind];
    if (!ws?.length) return this.kinds[kind].halfL * 1.2;
    const zs = ws.map((w) => w.hub.z);
    return Math.max(0.5, Math.max(...zs) - Math.min(...zs));
  }

  /** a vehicle's body as circles of its half-width along its length: [x, z] */
  private circles(o: Vehicle, ahead = 0): [number, number][] {
    const k = this.kinds[o.kind], fx = Math.sin(o.heading), fz = Math.cos(o.heading);
    const m = Math.max(1, Math.round((k.halfL - k.halfW) / k.halfW) + 1), sp = Math.max(0, k.halfL - k.halfW);
    return Array.from({ length: m }, (_, i) => {
      const t = (m === 1 ? 0 : -sp + (2 * sp * i) / (m - 1)) + ahead;
      return [o.x + fx * t, o.z + fz * t];
    });
  }

  /** would `c`, going on straight a little (up to 4.5 m), run into `o`? */
  private inWay(c: Vehicle, o: Vehicle): boolean {
    const rc = this.kinds[c.kind].halfW, ro = this.kinds[o.kind].halfW, need = rc + ro + 0.15;
    const theirs = this.circles(o);
    for (const ahead of [1, 2.5, 4.5]) {
      for (const [ax, az] of this.circles(c, ahead)) for (const [bx, bz] of theirs) {
        if ((ax - bx) ** 2 + (az - bz) ** 2 < need * need) return true;
      }
    }
    return false;
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

  private write(fx: number, fz: number): void {
    for (const m of this.meshes) {
      m.near.n = m.far.n = 0;
      m.near.rn.fill(0);
      m.far.rn.fill(0);
    }
    for (const c of this.cars) {
      if (c.fresh) continue;
      const d = Math.hypot(c.x - fx, c.z - fz);
      c.near = d < (c.near ? NEAR_OUT : NEAR_IN);
      const m = this.meshes[c.kind], dr = c.near ? m.near : m.far;
      M.makeRotationY(c.heading).setPosition(c.x, 0.05, c.z);
      const i = dr.n++;
      dr.parts.forEach((p, pi) => {
        p.setMatrixAt(i, M);
        const col = m.colours[pi];
        if (col) p.setColorAt(i, col[c.slot]);
      });
      // the wheels: at their hubs, the front ones steered, all rolled by the distance gone
      this.wheels[c.kind].forEach((w, wi) => {
        const parts = dr.wheels[wi];
        if (!parts.length) return;
        WM.copy(M).multiply(WT.makeTranslation(w.hub.x, w.hub.y, w.hub.z));
        if (w.steer && c.steer) WM.multiply(WT.makeRotationY(c.steer));
        WM.multiply(WT.makeRotationX(c.dist / w.r));
        for (const q of parts) {
          q.mesh.setMatrixAt(i, WM);
          if (q.colours) q.mesh.setColorAt(i, q.colours[c.slot]);
        }
      });
      const seated = this.seated[c.kind];
      dr.riders.forEach((r, ri) => {
        if (seated[ri][c.slot] && !c.empty) r.setMatrixAt(dr.rn[ri]++, M);
      });
    }
    for (const m of this.meshes) {
      for (const dr of [m.near, m.far]) {
        dr.parts.forEach((p) => {
          p.count = dr.n;
          p.visible = dr.n > 0;
          p.instanceMatrix.needsUpdate = true;
          if (p.instanceColor) p.instanceColor.needsUpdate = true;
        });
        for (const parts of dr.wheels) for (const q of parts) {
          q.mesh.count = dr.n;
          q.mesh.visible = dr.n > 0;
          q.mesh.instanceMatrix.needsUpdate = true;
          if (q.mesh.instanceColor) q.mesh.instanceColor.needsUpdate = true;
        }
        dr.riders.forEach((r, ri) => {
          r.count = dr.rn[ri];
          r.visible = dr.rn[ri] > 0;
          r.instanceMatrix.needsUpdate = true;
        });
      }
    }
    this.writeLamps();
    if (this.lenses && this.pools) {
      let n = 0;
      for (const c of this.cars) {
        const L = LAMPS[this.kinds[c.kind].name];
        for (const [lx, ly, lz] of L.at) {
          if (c.fresh || c.dark) { this.lenses.setMatrixAt(n, ZERO); this.pools.setMatrixAt(n, ZERO); n++; continue; }
          const R = M.makeRotationY(c.heading);
          const s = Math.sin(c.heading), co = Math.cos(c.heading);
          const px = c.x + lx * co + lz * s, pz = c.z - lx * s + lz * co;
          this.lenses.setMatrixAt(n, M2.copy(R).setPosition(px, ly + 0.05, pz));
          // the pool starts at the lamp and runs ahead along the road
          const w = L.pool[0], len = L.pool[1];
          const cx = px + s * len * 0.5, cz = pz + co * len * 0.5;
          // (Ramu's has real beams instead: Driving)
          this.pools.setMatrixAt(n, c.player ? ZERO : M2.copy(R).setPosition(cx, 0.1, cz).scale(V3.set(w, 1, len)));
          n++;
        }
      }
      this.lenses.instanceMatrix.needsUpdate = true;
      this.pools.instanceMatrix.needsUpdate = true;
    }
  }

  /** the lit small lamps of every vehicle in sight, packed into one InstancedMesh */
  private writeLamps(): void {
    const blink = (this.clock * BLINK_HZ) % 1 < 0.55;
    let n = 0;
    const quad = (c: Vehicle, x: number, y: number, z: number, w: number, h: number, back: boolean, col: THREE.Color) => {
      if (n >= this.lamps.count) return;
      M.makeRotationY(c.heading).setPosition(c.x, 0.05, c.z);
      M.multiply(WT.makeTranslation(x, y, z));
      if (back) M.multiply(WT.makeRotationY(Math.PI));
      M.multiply(WT.makeScale(w, h, 1));
      this.lamps.setMatrixAt(n, M);
      this.lamps.setColorAt(n, col);
      n++;
    };
    for (const c of this.cars) {
      if (c.fresh) continue;
      const k = this.kinds[c.kind], r = REAR[k.name];
      const brake = (c.lamps & BRAKE) !== 0, ind = blink ? c.lamps & (LEFT | RIGHT) : 0;
      if (r) {
        const z = -k.halfL - 0.015, sides = r.x ? [1, -1] : [0];
        for (const sd of sides) {
          const x = sd * r.x;
          if (brake || NIGHT) quad(c, x, r.y, z, r.w, r.h, true, brake ? C_BRAKE : C_TAIL);
          if (c.lamps & REVERSE) quad(c, x - sd * (r.w * 0.5 + 0.04), r.y, z, 0.06, r.h * 0.8, true, C_REV);
          const want = sd > 0 ? LEFT : sd < 0 ? RIGHT : 0;
          if (sd && ind & want) quad(c, x + sd * (r.w * 0.5 + 0.06), r.y, z, 0.09, Math.max(0.07, r.h * 0.8), true, C_IND);
        }
        if (!r.x && ind) {                 // a bike: indicators either side of the tail lamp
          for (const sd of [1, -1]) if (ind & (sd > 0 ? LEFT : RIGHT)) quad(c, sd * 0.15, r.y, z, 0.07, 0.05, true, C_IND);
        }
      }
      // front indicators, beside the headlamps
      if (ind && c.near) {
        for (const [lx, ly, lz] of LAMPS[k.name].at) {
          const sd = lx > 0.01 ? 1 : lx < -0.01 ? -1 : 0;
          for (const s2 of sd ? [sd] : [1, -1]) {
            if (!(ind & (s2 > 0 ? LEFT : RIGHT))) continue;
            quad(c, lx + s2 * 0.17, ly, lz + 0.02, 0.08, 0.06, false, C_IND);
          }
        }
      }
    }
    this.lamps.count = n;
    this.lamps.visible = n > 0;
    this.lamps.instanceMatrix.needsUpdate = true;
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }
}

const M = new THREE.Matrix4(), M2 = new THREE.Matrix4(), V3 = new THREE.Vector3(), WM = new THREE.Matrix4(), WT = new THREE.Matrix4();
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
