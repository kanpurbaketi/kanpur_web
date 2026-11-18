import { FOOTPATHS } from './footpaths';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { walkAlong } from './city';
import { hash2, MapData, P2 } from './types';
import { beamMaterial, NIGHT } from './night';
import { loadPBR, loadWheels, PBRPart, Wheel } from './vehicleModels';
import { FigureKind, Pose, riderParts } from './figures';
import { inMela } from './melaSite';
import { inCorridor } from './stage1Route';
import { Body, newBody, SPECS, step } from './vehicleSim';
import { Smoke } from './smoke';

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
interface Link { to: number; off: number; bus: boolean; slow?: boolean }
/** most vehicles at a time on the slow (stage 1 corridor) roads */
const SLOW_MAX = 6;
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
  /** body lean (radians, > 0: to the left; a bike into its turn, a car's body out of it) and pitch (> 0: nose up) */
  roll: number; pitch: number;
  /**
   * Damage, 0..100, from the knocks it took while Ramu had it: smoke past 40, black smoke and less power past 75, dead
   * at 100. `broken`: its headlamps knocked out (a bit per lamp of LAMPS). `own`: its body as a mesh of its own (out of
   * the instancing) so it can be dented, from when Ramu takes it until it goes back to the traffic. `hitT`: when it
   * was last knocked (a scrape is one knock, not one a frame).
   */
  damage: number; broken: number; own: THREE.Group | null; hitT: number;
  /** parked at the kerb by its owner (stage 1): stands there for good, costs nothing until Ramu touches it */
  pinned: boolean;
  /** locked: Ramu has to pick the lock to take it (drive.ts) */
  locked: boolean;
}

/** a kerbside spot for a parked vehicle: its kind's name, where, which way it faces */
export interface ParkSpot { kind: string; x: number; z: number; heading: number }

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
/** where a damaged engine smokes from: x, z as a share of the half length (+ front), height */
const ENGINE_AT: Record<string, [number, number, number] | null> = {
  swift: [0, 0.75, 0.95], maruti: [0, 0.7, 0.85], maruti_red: [0, 0.7, 0.85], maruti_green: [0, 0.7, 0.85],
  ambassador: [0, 0.75, 1.0], bolero: [0, 0.75, 1.15], truck: [0, 0.8, 1.5], bus: [0, -0.85, 1.2], bus_green: [0, -0.85, 1.2],
  autorickshaw: [0, -0.6, 0.6], tirri: [0, -0.5, 0.7], pulsar: [0.12, 0.1, 0.5], cycle: null, rickshaw: null,
};
const C_TAIL = new THREE.Color(0.55, 0.02, 0.01), C_BRAKE = new THREE.Color(4, 0.12, 0.05);
const C_REV = new THREE.Color(2.4, 2.4, 2.2), C_IND = new THREE.Color(3.2, 1.3, 0.05);

/**
 * Where a rear lamp's lens really is: the body's surface at the lamp's centre (r.x: its side), found by a ray from behind (the lamps are
 * painted into the models' textures, and on a hatchback they sit well forward of the bumper, z = -halfL, where the glow
 * used to float), and which way the surface faces there.
 */
function rearLens(geos: THREE.BufferGeometry[], r: { x: number; y: number }, halfL: number): { z: number; n: THREE.Vector3 } | null {
  const ray = new THREE.Raycaster(new THREE.Vector3(r.x, r.y, -halfL - 3), new THREE.Vector3(0, 0, 1), 0, 6);
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  let best: THREE.Intersection | null = null;
  for (const g of geos) {
    if (!g.getAttribute('position')) continue;
    const hit = ray.intersectObject(new THREE.Mesh(g, mat), false)[0];
    if (hit && (!best || hit.distance < best.distance)) best = hit;
  }
  mat.dispose();
  // nothing there, or a hit deep inside (the ray went past the body into the cabin): keep it on the back
  if (!best || !best.face || best.point.z > -halfL + 0.45) return null;
  const n = best.face.normal.clone();
  if (n.z > 0) n.negate();                                   // it faces back
  if (n.z > -0.35) n.set(0, 0, -1);                          // a glancing hit: keep it square to the back
  return { z: best.point.z, n: n.normalize() };
}

/** a soft round glow, bright in the middle: the lit lens and the light around it, not a flat patch */
function lampGlow(): THREE.CanvasTexture {
  const S = 64, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}
const BACK = new THREE.Vector3(0, 0, -1), LQ = new THREE.Quaternion(), LS = new THREE.Vector3();

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
  /** whether the straight way between two points crosses a wall (getting off: not onto the far side of one) */
  crosses: ((x0: number, z0: number, x1: number, z1: number) => boolean) | null = null;
  private pools: THREE.InstancedMesh | null = null;
  /** the small lamps: tail, brake, reversing and indicators (glowing quads, only the lit ones drawn) */
  private lamps: THREE.InstancedMesh;
  /** per kind: the rear lamps' lens (from rearLens), or null to keep them on the back of the body */
  private rear: { [side: number]: { z: number; n: THREE.Vector3 } | null }[] = [];
  private clock = 0;
  /** smoke from damaged engines */
  private smoke = new Smoke();
  /** every road's segments in 24 m cells: [x0, z0, x1, z1, half width] (onRoad) */
  private roadCells = new Map<string, [number, number, number, number, number][]>();

  /** `parked`: vehicles to stand at the kerb for good (pin): made on top of the traffic's own of each kind */
  static async create(map: MapData, desktop: boolean, parked: ParkSpot[] = []): Promise<Traffic> {
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
    for (const p of parked) {
      const k = kinds.find((k) => k.name === p.kind);
      if (k) k.count++;
    }
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
          player: false, parked: false, empty: false, dist: 0, steer: 0, sim: null, lamps: 0, dark: false, next: null, blinkT: 0, roll: 0, pitch: 0, damage: 0, broken: 0, own: null, hitT: 0, pinned: false, locked: false,
        });
      }
    });
    this.group.add(this.smoke.points);
    const lampN = kinds.reduce((a, k) => a + k.count * 10, 0);
    this.rear = kinds.map((k, ki) => {
      const r = REAR[k.name], p = parts[ki];
      const geos = p.pbr ? p.pbr.map((q) => q.geo) : [p.body];
      // each side on its own: the models are not quite symmetric
      return r ? Object.fromEntries((r.x ? [1, -1] : [0]).map((sd) => [sd, rearLens(geos, { x: sd * r.x, y: r.y }, k.halfL)])) : {};
    });
    this.lamps = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      toneMapped: false, map: lampGlow(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }), lampN);
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

  /**
   * Stand vehicles at the kerb, locked, nobody on them: they stay there (never recycled, no physics) until Ramu takes
   * one. Each takes a slot of its kind that is not out in the traffic yet.
   */
  pin(spots: ParkSpot[]): void {
    for (const p of spots) {
      const ki = this.kinds.findIndex((k) => k.name === p.kind);
      const c = this.cars.find((c) => c.kind === ki && c.fresh && !c.pinned);
      if (!c) continue;
      Object.assign(c, { x: p.x, z: p.z, heading: p.heading, v: 0, fresh: false, parked: true, empty: true, pinned: true, locked: true, dark: true });
    }
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
      const slow = map.area === 'moti_jheel' && r.pts.some(([x, z]) => inCorridor(x, z));   // stage 1's park road: crowded, slow
      // (its lanes keep in from the parked rows along both kerbs)
      const off = r.oneway ? 0 : slow ? 1.6 : Math.max(0.9, Math.min(2.2, r.w / 4));
      // the stubs left where the corridor's edge cut a lane (to a closed gate, a barricade): nobody drives into those
      if (slow && r.pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - r.pts[i - 1][0], p[1] - r.pts[i - 1][1]) : 0), 0) < 25) continue;
      const bus = MAJOR.has(r.cls) && r.w >= 6.5 && !slow;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = nodeAt(r.pts[i][0], r.pts[i][1]), b = nodeAt(r.pts[i + 1][0], r.pts[i + 1][1]);
        if (a === b) continue;
        // nothing drives through the mela ground
        const [p0, p1] = [r.pts[i], r.pts[i + 1]];
        if (map.area === 'moti_jheel' && [0, 0.25, 0.5, 0.75, 1].some((t) => inMela(p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, 2))) continue;
        this.nodes[a].links.push({ to: b, off, bus, slow });
        if (!r.oneway) this.nodes[b].links.push({ to: a, off, bus, slow });
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
      // stage 1's corridor: a handful at a time (they can't drive out, so they stay till Ramu is far away)
      if (n.links.every((l) => l.slow) && this.cars.filter((o) => !o.fresh && o.link.slow).length >= SLOW_MAX) continue;
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

  /**
   * The body's lean from its sideways acceleration `ay` (> 0: turning left) and its acceleration `ax`: a two-wheeler
   * leans into the turn as far as balances it (atan(ay / g)); a car's body rolls out of the turn on its springs a few
   * degrees and dips its nose under braking.
   */
  private lean(c: Vehicle, ay: number, ax: number, dt: number): void {
    const bike = SPECS[this.kinds[c.kind].name].bike;
    const roll = bike ? Math.max(-0.65, Math.min(0.65, Math.atan(ay / 9.81))) : Math.max(-0.06, Math.min(0.06, -ay * 0.007));
    const pitch = bike ? 0 : Math.max(-0.045, Math.min(0.035, ax * 0.006));
    const k = Math.min(1, dt * (bike ? 5 : 7));
    c.roll += (roll - c.roll) * k;
    c.pitch += (pitch - c.pitch) * k;
  }

  /** the height its wheels stand at: the road, or up on a footpath Ramu has driven it onto (near ones only: cheap enough) */
  groundY(c: Vehicle): number {
    if (!c.near || !(c.player || c.parked || c.pinned)) return 0.05;     // the traffic keeps to the road
    const k = this.kinds[c.kind];
    return Math.max(0.05, FOOTPATHS.under(c.x, c.z, c.heading, k.halfL * 0.8, k.halfW * 0.8));
  }

  /** The body's world matrix (leaning, pitched), as it is drawn: a bike leans about its tyres, a car's body about its springs. */
  bodyMatrix(c: Vehicle, out: THREE.Matrix4): THREE.Matrix4 {
    out.makeRotationY(c.heading).setPosition(c.x, this.groundY(c), c.z);
    if (!c.roll && !c.pitch) return out;
    const h = SPECS[this.kinds[c.kind].name].bike ? 0 : 0.45;
    return out.multiply(WT.makeTranslation(0, h, 0)).multiply(WT.makeRotationZ(-c.roll)).multiply(WT.makeRotationX(-c.pitch)).multiply(WT.makeTranslation(0, -h, 0));
  }

  /** going a -> b -> n: LEFT, RIGHT, or 0 (on ahead) */
  private turnOf(a: number, b: number, n: number): number {
    const A = this.nodes[a], B = this.nodes[b], N = this.nodes[n];
    const h1 = Math.atan2(B.x - A.x, B.z - A.z), h2 = Math.atan2(N.x - B.x, N.z - B.z);
    const d = Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1));
    return d > 0.4 ? LEFT : d < -0.4 ? RIGHT : 0;
  }

  /** where the headlamps that still work are on a vehicle (its frame) */
  headlamps(c: Vehicle): [number, number, number][] {
    return LAMPS[this.kinds[c.kind].name].at.filter((_, i) => !((c.broken >> i) & 1));
  }

  /** The vehicle Ramu takes gets a body of its own (copies of the near model's parts, in its colours), to dent. */
  private takeOwn(c: Vehicle): void {
    if (c.own) return;
    const m = this.meshes[c.kind], g = new THREE.Group();
    g.matrixAutoUpdate = false;
    m.near.parts.forEach((p, pi) => {
      let mat = p.material as THREE.Material;
      const col = m.colours[pi];
      if (col) {
        const cl = (mat as THREE.MeshStandardMaterial).clone();
        cl.color.multiply(col[c.slot]);
        mat = cl;
      }
      const geo = p.geometry.clone();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = p.castShadow;
      mesh.receiveShadow = true;
      mesh.userData.orig = (geo.getAttribute('position').array as Float32Array).slice();
      mesh.userData.ownMat = mat !== p.material;
      g.add(mesh);
    });
    this.group.add(g);
    c.own = g;
  }

  /** back to the instancing (recycled into the traffic): repaired */
  private release(c: Vehicle): void {
    c.damage = 0;
    c.broken = 0;
    if (!c.own) return;
    for (const o of c.own.children) {
      const mesh = o as THREE.Mesh;
      mesh.geometry.dispose();
      if (mesh.userData.ownMat) (mesh.material as THREE.Material).dispose();
    }
    this.group.remove(c.own);
    c.own = null;
  }

  /**
   * A knock (`hard` ~ m/s of speed lost) at a world point, pushed along (nx, nz) (away from what it hit, into the body):
   * damage, a dent there, and a headlamp broken by a hard one at the front.
   */
  private knocked(c: Vehicle, hard: number, wx: number, wz: number, nx: number, nz: number): void {
    const k = this.kinds[c.kind];
    c.damage = Math.min(100, c.damage + hard * 2.2);
    const inv = M2.copy(this.bodyMatrix(c, M2)).invert();
    const p = V3.set(wx, 0.6, wz).applyMatrix4(inv);
    const n = new THREE.Vector3(nx, 0, nz).transformDirection(inv);
    if (p.z > k.halfL * 0.5 && hard > 3) {
      const at = LAMPS[k.name].at;
      let best = -1, bd = Infinity;
      at.forEach((a, i) => { const d = Math.abs(a[0] - p.x); if (d < bd) { bd = d; best = i; } });
      if (best >= 0 && bd < 0.6) c.broken |= 1 << best;
    }
    if (!c.own) return;
    // the dent: vertices near the point pushed in, the most at the middle, never more than a hand's depth in all
    const R = Math.min(0.85, 0.3 + hard * 0.035), depth = Math.min(0.14, 0.012 * hard + 0.01);
    for (const o of c.own.children) {
      const mesh = o as THREE.Mesh;
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute, a = pos.array as Float32Array;
      const orig = mesh.userData.orig as Float32Array;
      let moved = false;
      for (let i = 0; i < a.length; i += 3) {
        const dx = a[i] - p.x, dy = (a[i + 1] - p.y) * 0.7, dz = a[i + 2] - p.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= R * R) continue;
        const f = (1 - Math.sqrt(d2) / R) ** 2 * depth;
        let x = a[i] + n.x * f, z = a[i + 2] + n.z * f, y = a[i + 1] - f * 0.25;
        // at most 0.22 m from where it was made
        const ox = x - orig[i], oy = y - orig[i + 1], oz = z - orig[i + 2], ol = Math.hypot(ox, oy, oz);
        if (ol > 0.22) { const s = 0.22 / ol; x = orig[i] + ox * s; y = orig[i + 1] + oy * s; z = orig[i + 2] + oz * s; }
        a[i] = x; a[i + 1] = y; a[i + 2] = z;
        moved = true;
      }
      if (moved) pos.needsUpdate = true;
    }
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
      if (c.pinned && !c.sim) continue;       // parked by its owner, untouched: stands where it is
      if (c.fresh) this.place(c, fx, fz, 25, SPAWN_MAX, 0, 0);
      else if (Math.hypot(c.x - fx, c.z - fz) > DESPAWN) {
        c.fresh = true;
        c.parked = c.empty = false;           // back in the traffic, with its people
        c.sim = null;
        c.dark = false;
        c.next = null;
        c.roll = c.pitch = 0;
        this.release(c);                      // repaired: back to the instancing
        this.place(c, fx, fz, SPAWN_MIN, SPAWN_MAX, dirX, dirZ);
      }
      if (c.fresh) continue;
      if (c.parked) {                         // where Ramu left it: rolling to a stop
        this.drive(c, dt, 0, 0, true);
        continue;
      }
      const k = this.kinds[c.kind];
      const fxv = Math.sin(c.heading), fzv = Math.cos(c.heading); // forward
      let want = c.link.slow ? Math.min(c.vmax, 5.5) : c.vmax;
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
      const v0 = c.v;
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
      this.lean(c, c.v * (turn / Math.max(dt, 1e-3)), (c.v - v0) / Math.max(dt, 1e-3), dt);
    }
    // smoke from damaged engines (Ramu's, and ones he left)
    for (const c of this.cars) {
      if (c.fresh || c.damage <= 40) continue;
      const rate = 6 + (c.damage - 40) * 0.45;
      if (Math.random() > rate * dt) continue;
      const k = this.kinds[c.kind], e = ENGINE_AT[k.name];
      if (!e) continue;
      const [x, z] = this.toWorld(c, e[0], e[1] * k.halfL);
      const fxv = Math.sin(c.heading), fzv = Math.cos(c.heading);
      this.smoke.emit(x, e[2], z, c.damage > 75 ? 0.05 : 0.7, -fxv * c.v, -fzv * c.v);
    }
    this.smoke.update(dt);
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
    c.locked = false;
    c.pinned = false;                         // his now: left where he gets off, back to the traffic in time
    this.takeOwn(c);
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
    c.player = false;
    c.parked = true;
    return this.standPoint(c);
  }

  /**
   * Where the lock is that Ramu picks, on the side of the vehicle he is on (world: x, y, z), where he stands to work at
   * it (x, z), and whether he crouches for it. A car: the front door's handle. A two-wheeler: the disc lock on its
   * front brake disc, low on the wheel.
   */
  lockSpot(c: Vehicle, px: number, pz: number): { lock: [number, number, number]; stand: [number, number]; low: boolean } {
    const k = this.kinds[c.kind], seat = DRIVER[k.name];
    const s = Math.sin(c.heading), co = Math.cos(c.heading);
    const side = (px - c.x) * co - (pz - c.z) * s >= 0 ? 1 : -1;      // his side: +1 the vehicle's left
    if (seat.pose === 'ride') {
      const z = k.halfL - 0.3;
      const [lx, lz] = this.toWorld(c, side * 0.1, z), [sx, sz] = this.toWorld(c, side * (k.halfW + 0.5), z - 0.15);
      return { lock: [lx, 0.34, lz], stand: [sx, sz], low: true };
    }
    const z = seat.at[2] - 0.15, y = k.name === 'bolero' ? 1.05 : 0.92;
    const [lx, lz] = this.toWorld(c, side * (k.halfW + 0.02), z), [sx, sz] = this.toWorld(c, side * (k.halfW + 0.48), z);
    return { lock: [lx, y, lz], stand: [sx, sz], low: false };
  }

  /** where one stands beside the driver's seat, to its right (out of the way of walls) */
  standPoint(c: Vehicle): [number, number] {
    const k = this.kinds[c.kind], seat = DRIVER[k.name];
    // the right side if it is open, else the left, behind, in front: never through a wall or into a ride (parked up
    // against one, the right side was inside the carousel)
    const tries: [number, number][] = [[-(k.halfW + 0.55), seat.at[2]], [k.halfW + 0.55, seat.at[2]], [0, -(k.halfL + 0.6)], [0, k.halfL + 0.6]];
    let best: [number, number] | null = null;
    for (const [lx, lz] of tries) {
      let [x, z] = this.toWorld(c, lx, lz);
      if (this.crosses?.(c.x, c.z, x, z)) continue;
      if (this.resolve) [x, z] = this.resolve(x, z, 0.35);
      if (this.crosses?.(c.x, c.z, x, z)) continue;
      best = [x, z];
      break;
    }
    if (!best) {
      best = this.toWorld(c, -(k.halfW + 0.55), seat.at[2]);
      if (this.resolve) best = this.resolve(best[0], best[1], 0.35);
    }
    return best;
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
  drive(c: Vehicle, dt: number, throttle: number, steer: number, handbrake: boolean, hold = false): void {
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
      { throttle, steer, handbrake, hold: hold || c.parked, power: c.damage >= 100 ? 0 : c.damage > 75 ? 0.6 : 1 }, {
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
    this.lean(c, b.vx * b.yaw, b.ax, dt);
    if (b.knock > 3 || (b.knock > 0.9 && this.clock - c.hitT > 0.35)) {
      c.hitT = this.clock;
      this.knocked(c, b.knock, b.knockX, b.knockZ, b.knockNX, b.knockNZ);
    }
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
    if (!ws?.some((w) => w.r > 0)) return this.kinds[kind].halfL * 1.2;
    const zs = ws.filter((w) => w.r > 0).map((w) => w.hub.z);
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
      this.bodyMatrix(c, M);
      const bike = SPECS[this.kinds[c.kind].name].bike;
      // a car's wheels stay on the road as its body rolls; a bike's lean with it
      if (bike) M0.copy(M);
      else M0.makeRotationY(c.heading).setPosition(c.x, this.groundY(c), c.z);
      const i = dr.n++;
      if (c.own) {                            // its own (dented) body is drawn instead; the wheels stay instanced
        c.own.matrix.copy(M);
        c.own.matrixWorldNeedsUpdate = true;
      }
      dr.parts.forEach((p, pi) => {
        p.setMatrixAt(i, c.own ? ZERO : M);
        const col = m.colours[pi];
        if (col) p.setColorAt(i, col[c.slot]);
      });
      // the wheels: at their hubs, the front ones steered, all rolled by the distance gone
      this.wheels[c.kind].forEach((w, wi) => {
        const parts = dr.wheels[wi];
        if (!parts.length) return;
        WM.copy(w.r > 0 ? M0 : M).multiply(WT.makeTranslation(w.hub.x, w.hub.y, w.hub.z));
        if (w.steer && c.steer) WM.multiply(WT.makeRotationY(c.steer));
        if (w.r > 0) WM.multiply(WT.makeRotationX(c.dist / w.r));      // (a handlebar, r 0, only steers)
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
          const li = L.at.findIndex((a) => a[0] === lx && a[2] === lz);
          if (c.fresh || c.dark || (c.broken >> li) & 1) { this.lenses.setMatrixAt(n, ZERO); this.pools.setMatrixAt(n, ZERO); n++; continue; }
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
    // each lamp a soft glow a little larger than the lens, just off the body's surface and turned to it
    const quad = (c: Vehicle, x: number, y: number, z: number, w: number, h: number, back: boolean, col: THREE.Color, nrm?: THREE.Vector3) => {
      if (n >= this.lamps.count) return;
      this.bodyMatrix(c, M);
      M.multiply(WT.makeTranslation(x, y, z));
      if (back) {
        LQ.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm ?? BACK);
        M.multiply(WT.makeRotationFromQuaternion(LQ));
      }
      M.multiply(WT.makeScale(w * 1.6, h * 1.8, 1));
      this.lamps.setMatrixAt(n, M);
      this.lamps.setColorAt(n, col);
      n++;
    };
    for (const c of this.cars) {
      if (c.fresh) continue;
      const k = this.kinds[c.kind], r = REAR[k.name];
      const brake = (c.lamps & BRAKE) !== 0, ind = blink ? c.lamps & (LEFT | RIGHT) : 0;
      if (r) {
        const sides = r.x ? [1, -1] : [0];
        for (const sd of sides) {
          const lens = this.rear[c.kind][sd], x = sd * r.x, nrm = lens ? LS.copy(lens.n) : BACK;
          // just off the lens, along its facing
          const z = lens ? lens.z + nrm.z * 0.02 : -k.halfL - 0.015, px = x + nrm.x * 0.02, py = r.y + nrm.y * 0.02;
          if (brake || NIGHT) quad(c, px, py, z, r.w, r.h, true, brake ? C_BRAKE : C_TAIL, nrm);
          if (c.lamps & REVERSE) quad(c, px - sd * (r.w * 0.5 + 0.04), py, z, 0.06, r.h * 0.8, true, C_REV, nrm);
          const want = sd > 0 ? LEFT : sd < 0 ? RIGHT : 0;
          if (sd && ind & want) quad(c, px + sd * (r.w * 0.5 + 0.06), py, z, 0.09, Math.max(0.07, r.h * 0.8), true, C_IND, nrm);
        }
        if (!r.x && ind) {                 // a bike: indicators either side of the tail lamp
          for (const sd of [1, -1]) if (ind & (sd > 0 ? LEFT : RIGHT)) quad(c, sd * 0.15, r.y, (this.rear[c.kind][0]?.z ?? -k.halfL) - 0.02, 0.07, 0.05, true, C_IND);
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

const M = new THREE.Matrix4(), M0 = new THREE.Matrix4(), M2 = new THREE.Matrix4(), V3 = new THREE.Vector3(), WM = new THREE.Matrix4(), WT = new THREE.Matrix4();
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
