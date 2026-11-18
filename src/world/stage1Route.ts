import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BULB, Bulbs, banner, bannerMat, Geo, litMat, rnd } from './geo';
import { LightPool } from './night';
import { DX, DZ, GATE } from './melaSite';
import type { ParkSpot } from './props';
import type { Kind as StallKind, VendorSpot } from './vendors';
import { walkAlong } from './city';
import { offsetLines } from './meshBuilder';
import { Building, centroid, MapData, P2, pointInPoly, Road } from './types';
import { STATUE } from './stage1Site';
import { RoadDirt } from './roadDirt';
import { isNagarNigam, NagarNigam } from './nagarNigam';
export { SHIVAJI_START } from './stage1Site';

/*
 Stage 1 (plans/05-stage1-route.md): the way from the Shivaji Putla gate to the mela, and nowhere else.
   Ramu starts by the Shivaji statue, just off the main road under the metro, and walks (or rides) through the gate down
   the park road, Japani Garden on his right and Tulsi Upvan on his left, to the Nagar Nigam; there the road turns
   right, and the mela is on the right of it.
   CORRIDOR    the ground he can reach: everything outside it is backdrop. Its edge is drawn by real things (park walls,
               the Nagar Nigam's compound wall and gates, police barricades, a tin fence, the mela's cloth) and backed
               by one tall invisible ring, so nothing slips out through a gap or a corner.
   prepareRoute  the map edits (run before the city is built): every road crossing the edge is cut there, so traffic
               and walkers inside stay inside; the park road becomes a proper two-lane road with footpaths; what stands
               on it is cleared; Japani Garden's edge steps round the mela; the Nagar Nigam gets its colours.
*/

const MX0 = DX - 9.5, MX1 = DX + 109.5, MZ0 = DZ + 127, MZ1 = DZ + 203.5;   // the mela's cloth wall

/** the reachable ground, clockwise from the barricade at the main road (x east, z south) */
export const CORRIDOR: P2[] = [
  [-41, 8], [-12, 8], [-21, 19],                 // the barricade across the mouth onto the main road; the start
  [-29, 331],                                    // Tulsi Upvan's wall, on the left going in
  [-29, 353],                                    // barricade across the road east at the bend
  [-52, 350.2], [-141, 344.5], [-224, 338.5],    // the Nagar Nigam's compound wall along the road west
  [-222, 321],                                   // barricade across the road past the mela
  [-221, 294], [-221, 278],                      // the building west of the mela (the alley to the torn place)
  [MX0, 278],                                    // tin fence across the alley's end
  [MX0, MZ0], [MX1, MZ0], [MX1, 322],            // round the mela's cloth
  [-52, 327], [-51, 265], [-41, 18],             // the park wall back to the start, Japani Garden on the right
];

export const inCorridor = (x: number, z: number): boolean => pointInPoly(x, z, CORRIDOR);

/** the road that runs the corridor (OSM way: the park road, on round the Nagar Nigam bend to the west) */
const PARK_ROAD = 44135917;
const ROAD_W = 10;              // two lanes and room for a parked row each side
const WALK = 2.2;               // footpath width

const seg = (a: P2, b: P2, c: P2, d: P2): number | null => {
  // where a→b crosses c→d, as t along a→b
  const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : null;
};

/** cut every road where it crosses the corridor's edge (a small gap: separate traffic / walking graphs; the road ends hide it) */
function cutRoads(roads: Road[]): Road[] {
  const edges = CORRIDOR.map((p, i) => [p, CORRIDOR[(i + 1) % CORRIDOR.length]] as [P2, P2]);
  const out: Road[] = [];
  for (const r of roads) {
    let run: P2[] = [r.pts[0]];
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const ts = edges.map(([c, d]) => seg(a, b, c, d)).filter((t): t is number => t !== null).sort((x, y) => x - y);
      for (const t of ts) {
        const g = 0.25 / L;
        run.push([a[0] + (b[0] - a[0]) * (t - g), a[1] + (b[1] - a[1]) * (t - g)]);
        if (run.length > 1) out.push({ ...r, pts: run });
        run = [[a[0] + (b[0] - a[0]) * (t + g), a[1] + (b[1] - a[1]) * (t + g)]];
      }
      run.push(b);
    }
    if (run.length > 1) out.push({ ...r, pts: run });
  }
  return out;
}

const distToLine = (x: number, z: number, pts: P2[]): number => {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
};

/** the corridor's road (after prepareRoute): the park road's piece inside the corridor */
export function routeLine(map: MapData): P2[] {
  return map.roads.find((r) => r.id === PARK_ROAD && r.pts.some(([x, z]) => inCorridor(x, z)))?.pts ?? [];
}

/** Map edits for stage 1. Moti Jheel only; run after clipRoadsToMela, before anything is built from the map. */
export function prepareRoute(map: MapData): void {
  map.roads = cutRoads(map.roads);
  // the park road: a proper road with footpaths, two-way; tertiary so it is marked and lit like one
  for (const r of map.roads) {
    if (r.id !== PARK_ROAD || !r.pts.some(([x, z]) => inCorridor(x, z))) continue;
    Object.assign(r, { w: ROAD_W, cls: 'tertiary', oneway: false, lanes: 2, sidewalk: 'both' });
  }
  const line = routeLine(map);
  // nothing standing on the road or its footpaths
  map.buildings = map.buildings.filter((b) => !b.pts.some(([x, z]) => distToLine(x, z, line) < ROAD_W / 2 + WALK + 0.4));
  // the two parks are lawns and trees, as in the video: nothing built in them
  const parks = map.parks.filter((p) => p.name === 'Japani Garden' || p.name === 'Tulsi Upvan');
  map.buildings = map.buildings.filter((b) => {
    const [cx, cz] = centroid(b.pts);
    return !parks.some((p) => pointInPoly(cx, cz, p.pts));
  });
  // Japani Garden steps round the mela's north-east corner
  const jg = map.parks.find((p) => p.name === 'Japani Garden');
  if (jg) {
    jg.pts = jg.pts.flatMap(([x, z]): P2[] => {
      if (x > MX0 - 2 && x < MX1 + 2 && z > MZ0 - 2) return [[Math.max(x, MX0 - 2), MZ0 - 2], ...(x > MX1 - 15 ? [[MX1 + 2, MZ0 - 2] as P2] : [])];
      return [[x, z]];
    });
  }
  // the Nagar Nigam: modelled from a photo (nagarNigam.ts), so out of the city's build; main.ts puts the footprints back
  // once the city is built (for the minimap and collision)
  NAGAR_NIGAM.splice(0, NAGAR_NIGAM.length, ...map.buildings.filter(isNagarNigam));
  map.buildings = map.buildings.filter((b) => !isNagarNigam(b));
  // and its forecourt kept clear (a shed stood before the entrance)
  map.buildings = map.buildings.filter((b) => !b.pts.every(([x, z]) => x > -48 && x < -36 && z > 392 && z < 405));
}

/** the Nagar Nigam: the long main block, and the front block before it (its entrance faces the park road) */
/** the Nagar Nigam's two blocks, taken out of the map by prepareRoute (main.ts puts them back after the city is built) */
export const NAGAR_NIGAM: Building[] = [];

// ---- textures ------------------------------------------------------------------------------------------------------

/** iron grille: vertical bars and two rails, transparent between (u repeats every 0.9 m) */
function grilleTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1c1f1d';
  for (let i = 0; i < 6; i++) g.fillRect(i * 21.3 + 8, 0, 5, 128);
  g.fillRect(0, 10, 128, 7);
  g.fillRect(0, 112, 128, 7);
  for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(i * 21.3 + 6, 10); g.lineTo(i * 21.3 + 10.5, 0); g.lineTo(i * 21.3 + 15, 10); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** a black-and-yellow striped board (police barricades) */
function stripeTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2c21b';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#141414';
  for (let x = -64; x < 256; x += 48) { g.beginPath(); g.moveTo(x, 64); g.lineTo(x + 24, 64); g.lineTo(x + 88, 0); g.lineTo(x + 64, 0); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** a vertical textured strip along a line, from y0 to y1; u runs in metres / uLen */
function strip(line: P2[], y0: number, y1: number, uLen: number): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [];
  let s = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    const u0 = s / uLen, u1 = (s + L) / uLen;
    pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
    uv.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
    s += L;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

const SLOGANS = ['स्वच्छ रहें, स्वस्थ रहें', 'कानपुर ये है मेरा शहर', 'पेड़ लगाओ, जीवन बचाओ', 'स्वच्छ कानपुर, सुंदर कानपुर', 'हरित कानपुर'];

// ---- the stage ------------------------------------------------------------------------------------------------------

export class Stage1Route {
  readonly group = new THREE.Group();
  /** collision posts [x, z, r, h] */
  readonly posts: [number, number, number, number][] = [];
  /** collision rings (thin slabs along walls): [ring, height] */
  readonly walls: [P2[], number][] = [];
  /** the invisible edge of the reachable ground */
  readonly edge = CORRIDOR;

  private solid = new Geo();      // plinths, pillars, piers, statue: vertex coloured
  private bulbs = new Bulbs();

  constructor(private map: MapData, private lights: LightPool | null) {
    // the park walls: Japani Garden on the right, Tulsi Upvan on the left, and on round to the mela's corner
    // (the parks begin at the gate: outside it, the metro's railings on the left and a low stone wall on the right)
    this.parkWall([[-42.7, 59], [-51, 265], [-52, 327], [MX1, 322]]);
    this.parkWall([[-22.0, 59], [-29, 331]]);
    this.railing([[-12, 8], [-21, 19], [-22.0, 55.5]]);
    this.lowStoneWall([[-41, 8], [-41, 18], [-42.6, 55.5]]);
    this.parkWall([[-222, 321], [-221, 294]]);
    this.compoundWall([[-29, 353], [-52, 350.2], [-141, 344.5], [-224, 338.5]]);
    this.barricade([-40.5, 8], [-12.5, 8]);
    this.barricade([-29, 332], [-29, 352.5]);
    this.barricade([-223.8, 338], [-222.1, 321.5]);
    this.tinFence([-221, 278], [MX0, 278]);
    this.shivajiGate();
    this.statue();
    const nn = new NagarNigam(NAGAR_NIGAM, lights);
    this.group.add(nn.group);
    this.melaLights();
    const m = new THREE.Mesh(this.solid.build(), litMat({ metalness: 0.05, roughness: 0.85 }));
    m.castShadow = m.receiveShadow = true;
    this.group.add(m, this.bulbs.object(0.8));
    this.parking = this.parkingSpots();
    this.stalls = this.stallSpots();
    // the dirt: potholes, patches, mud, litter, garbage heaps (not in the gate's opening, not under the carts)
    const dirt = new RoadDirt({
      line: routeLine(map), roadW: ROAD_W, walkW: WALK,
      keep: (x, z) => inCorridor(x, z) && z > 18 && Math.abs(z - 57) > 2 && !this.stalls.some((v) => Math.hypot(v.x - x, v.z - z) < 3),
    });
    this.group.add(dirt.group);
  }

  /** food carts on the strip of ground between the footpath and the mela's cloth, thickest round its gate (main.ts gives them to Vendors) */
  readonly stalls: VendorSpot[];

  private stallSpots(): VendorSpot[] {
    const line = routeLine(this.map);
    if (line.length < 2) return [];
    const KINDS: StallKind[] = ['momos', 'chaat', 'chai', 'juice', 'kulfi', 'fruit', 'momos', 'paan', 'chaat', 'chai'];
    const xs = [GATE.x - 11, GATE.x + 11, GATE.x - 15.5, GATE.x + 15.5, GATE.x - 21, GATE.x + 21, GATE.x - 34, GATE.x + 36, MX0 + 9, MX1 - 12];
    // the carts' row: north of the road, past the footpath
    const rows = offsetLines(line, ROAD_W / 2 + WALK + 2.2);
    const out: VendorSpot[] = [];
    xs.forEach((want, i) => {
      let best: [number, number, number, number] | null = null, bd = 3;
      for (const row of rows) walkAlong(row, 0.5, (x, z, dx, dz) => {
        if (z > 333 || z < MZ1 + 2 || !inCorridor(x, z)) return;       // the mela side of the road only
        if (Math.abs(x - want) < bd) { bd = Math.abs(x - want); best = [x, z, dx, dz]; }
      }, 0);
      if (!best) return;
      const [x, z] = best as [number, number, number, number];   // (set in the callback: TS cannot see it)
      // facing the road (south)
      out.push({ kind: KINDS[i % KINDS.length], x, y: 0.02, z, rot: 0 });
    });
    return out;
  }

  /** where vehicles stand parked, locked (main.ts hands them to the traffic) */
  readonly parking: ParkSpot[];

  private wallRing(a: P2, b: P2, h: number): void {
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, nx = (-dz / L) * 0.2, nz = (dx / L) * 0.2;
    this.walls.push([[[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]], h]);
  }

  /** which side of a→b is the corridor: +1 left normal (-dz, dx), -1 the other */
  private inside(a: P2, b: P2): number {
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    return inCorridor(mx - (dz / L) * 1.5, mz + (dx / L) * 1.5) ? 1 : -1;
  }

  /** a plinth of plastered brick (pink, as in the video), brick pillars every 3 m, an iron grille on top; slogans painted on the road side */
  private parkWall(line: P2[]): void {
    const PH = 1.0, TOP = 2.2;
    walkAlongSegs(line, (a, b, L, ry) => {
      this.solid.box((a[0] + b[0]) / 2, PH / 2, (a[1] + b[1]) / 2, L, PH, 0.32, '#c98c7e', ry);
      this.solid.box((a[0] + b[0]) / 2, PH + 0.04, (a[1] + b[1]) / 2, L, 0.08, 0.4, '#b7aa98', ry);
      this.wallRing(a, b, 6);
    });
    walkAlong(line, 3, (x, z, dx, dz) => {
      const ry = Math.atan2(-dz, dx);
      this.solid.box(x, TOP / 2, z, 0.42, TOP, 0.42, '#9c4f3c', ry);
      this.solid.box(x, TOP + 0.06, z, 0.52, 0.12, 0.52, '#b7aa98', ry);
    }, 0);
    const grille = new THREE.Mesh(strip(line, PH + 0.08, TOP, 0.9), new THREE.MeshStandardMaterial({
      map: grilleTex(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4,
    }));
    grille.castShadow = true;
    this.group.add(grille);
    // slogans, every ~45 m on the side Ramu sees
    let n = 0;
    walkAlongSegs(line, (a, b, L, ry) => {
      if (L < 6) return;
      const side = this.inside(a, b), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
      for (let s = 3 + (n % 3) * 7; s < L - 3; s += 45) {
        const text = SLOGANS[n++ % SLOGANS.length];
        const tex = banner(1024, 160, '#e8dcc4', '#e8dcc4', [{ text, size: 104, color: '#7a2318', y: 86 }]);
        const p = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.72), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
        p.position.set(a[0] + dx * s - dz * side * 0.17, 0.5, a[1] + dz * s + dx * side * 0.17);
        p.rotation.y = ry + (side > 0 ? 0 : Math.PI);
        this.group.add(p);
      }
    });
  }

  /** outside the gate on the left: a raised strip with pink pipe railings on it, as along the metro's side in the video */
  private railing(line: P2[]): void {
    walkAlongSegs(line, (a, b, L, ry) => {
      this.solid.box((a[0] + b[0]) / 2, 0.22, (a[1] + b[1]) / 2, L, 0.44, 1.2, '#b9b2a6', ry);
      for (const h of [0.95, 1.45]) this.solid.box((a[0] + b[0]) / 2, h, (a[1] + b[1]) / 2, L, 0.07, 0.07, '#d97b86', ry);
      this.wallRing(a, b, 6);
    });
    walkAlong(line, 1.8, (x, z) => this.solid.cyl(x, 0.44, z, 0.04, 1.05, '#d97b86', 6), 0);
  }

  /** outside the gate on the right: a low wall of the gate's stone, crenellated */
  private lowStoneWall(line: P2[]): void {
    const geo: THREE.BufferGeometry[] = [];
    walkAlongSegs(line, (a, b, L, ry) => {
      geo.push(stoneBox((a[0] + b[0]) / 2, 0.75, (a[1] + b[1]) / 2, L, 1.5, 0.9, ry));
      this.wallRing(a, b, 6);
    });
    walkAlong(line, 1.25, (x, z, dx, dz) => geo.push(stoneBox(x, 1.75, z, 0.6, 0.5, 0.9, Math.atan2(-dz, dx))), 0.6);
    const m = new THREE.Mesh(mergeGeometries(geo), new THREE.MeshStandardMaterial({ map: stoneTex(), roughness: 0.92 }));
    m.castShadow = m.receiveShadow = true;
    this.group.add(m);
  }

  /** the Nagar Nigam's compound: a high cream wall with a terracotta coping; closed iron gates where its lanes meet the road */
  private compoundWall(line: P2[]): void {
    const H = 2.6;
    const gates = [[-45, 351.05], [-141.2, 344.5]] as P2[];   // the lanes into the compound (cut at the wall)
    walkAlongSegs(line, (a, b, L, ry) => {
      const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
      // pieces of wall between the gate openings on this stretch
      const cuts = gates.filter(([gx, gz]) => Math.abs((gx - a[0]) * dz - (gz - a[1]) * dx) < 1)
        .map(([gx, gz]) => (gx - a[0]) * dx + (gz - a[1]) * dz).filter((s) => s > 0 && s < L).sort((p, q) => p - q);
      let s0 = 0;
      for (const s of [...cuts, L + 3.5]) {
        const e = Math.min(L, s - 3.5);
        if (e > s0) {
          const m = s0 + (e - s0) / 2;
          this.solid.box(a[0] + dx * m, H / 2, a[1] + dz * m, e - s0, H, 0.3, '#ddd0b4', ry);
          this.solid.box(a[0] + dx * m, H + 0.08, a[1] + dz * m, e - s0, 0.16, 0.42, '#a5452c', ry);
          this.solid.box(a[0] + dx * m, 0.18, a[1] + dz * m, e - s0, 0.36, 0.34, '#7c6f60', ry);
        }
        if (s < L) this.ironGate(a[0] + dx * s, a[1] + dz * s, ry, side(this.inside(a, b), dx, dz));
        s0 = s + 3.5;
      }
      this.wallRing(a, b, 6);
    });
    walkAlong(line, 4, (x, z, dx, dz) => this.solid.box(x, H / 2 + 0.1, z, 0.45, H + 0.2, 0.45, '#cdbf9f', Math.atan2(-dz, dx)), 2);
  }

  /** two closed gate leaves between tall pillars, a guard hut beside (inside), a light over it */
  private ironGate(x: number, z: number, ry: number, out: P2): void {
    const c = Math.cos(ry), s = -Math.sin(ry);       // along the wall
    for (const k of [-1, 1]) {
      this.solid.box(x + c * k * 3.7, 1.6, z + s * k * 3.7, 0.8, 3.2, 0.8, '#cdbf9f', ry);
      this.solid.box(x + c * k * 3.7, 3.3, z + s * k * 3.7, 1.0, 0.2, 1.0, '#a5452c', ry);
    }
    const leaf = new THREE.Mesh(strip([[x - c * 3.3, z - s * 3.3], [x + c * 3.3, z + s * 3.3]], 0.05, 2.4, 0.9), new THREE.MeshStandardMaterial({
      map: grilleTex(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.5,
    }));
    this.group.add(leaf);
    const hx = x + c * 6 + out[0] * 3.5, hz = z + s * 6 + out[1] * 3.5;   // the hut, inside the compound
    this.solid.box(hx, 1.25, hz, 2.2, 2.5, 2.2, '#c9a882', ry).box(hx, 2.6, hz, 2.6, 0.2, 2.6, '#7d2e1f', ry);
    this.lights?.add(x - out[0] * 2, 4, z - out[1] * 2, '#fff1d6', 90, 16);
    this.bulbs.add(x + c * 3.7, 3.55, z + s * 3.7, '#fff3d0', -1, 2.2);
    this.bulbs.add(x - c * 3.7, 3.55, z - s * 3.7, '#fff3d0', -1, 2.2);
  }

  /** a row of police barricades: steel frames with black-and-yellow boards, a 'road closed' board in the middle */
  private barricade(a: P2, b: P2): void {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ry = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, n = Math.max(1, Math.round(L / 2.1)), w = L / n;
    const board = new THREE.MeshStandardMaterial({ map: stripeTex(), roughness: 0.6, side: THREE.DoubleSide });
    const boards = new THREE.InstancedMesh(new THREE.PlaneGeometry(w - 0.2, 0.36), board, n * 2);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    for (let i = 0; i < n; i++) {
      const cx = a[0] + dx * (i + 0.5) * w, cz = a[1] + dz * (i + 0.5) * w;
      for (const e of [-0.5, 0.5]) {
        const lx = cx + dx * e * (w - 0.15), lz = cz + dz * e * (w - 0.15);
        this.solid.box(lx, 0.55, lz, 0.06, 1.1, 0.06, '#c9c9c9', ry).box(lx, 0.03, lz, 0.06, 0.06, 0.7, '#9a9a9a', ry);
      }
      this.solid.box(cx, 1.08, cz, w - 0.1, 0.05, 0.05, '#c9c9c9', ry);
      boards.setMatrixAt(i * 2, m4.compose(new THREE.Vector3(cx, 0.85, cz), q, new THREE.Vector3(1, 1, 1)));
      boards.setMatrixAt(i * 2 + 1, m4.compose(new THREE.Vector3(cx, 0.4, cz), q, new THREE.Vector3(1, 1, 1)));
    }
    this.group.add(boards);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), bannerMat(banner(512, 288, '#b3261e', '#ffffff', [
      { text: 'रास्ता बंद', size: 96, color: '#ffffff', y: 100 }, { text: 'ROAD CLOSED', size: 64, color: '#ffe14d', y: 205 },
    ]), 0.35));
    sign.position.set((a[0] + b[0]) / 2, 1.65, (a[1] + b[1]) / 2);
    sign.rotation.y = ry;
    this.group.add(sign);
    this.solid.box((a[0] + b[0]) / 2, 0.6, (a[1] + b[1]) / 2, 0.06, 1.2, 0.06, '#c9c9c9', ry);
    this.wallRing(a, b, 6);
  }

  /** corrugated tin sheets across the alley's end, as round a building site */
  private tinFence(a: P2, b: P2): void {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ry = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    this.solid.box((a[0] + b[0]) / 2, 1.2, (a[1] + b[1]) / 2, L, 2.4, 0.06, '#5c7da6', ry);
    walkAlong([a, b], 2.4, (x, z) => this.solid.box(x, 1.25, z, 0.08, 2.5, 0.12, '#3d3d3d', ry), 0);
    this.wallRing(a, b, 6);
  }

  /**
   * The Shivaji Putla gate, as in the video (0:16-0:20): a wall of rough grey-white stone blocks with one wide flat-topped
   * opening the road runs through; a crenellated top, a pink box with a saffron flag over the middle; a lit emblem at the
   * opening's right; a golden lion before the right-hand wall, which steps down and runs on with a chhatri on it. On the
   * left, outside: the raised footpath with pink pipe railings and a yellow-and-black kerb.
   */
  private shivajiGate(): void {
    const line = routeLine(this.map);
    // where the road passes z ≈ 57
    let at: P2 = [-30.2, 57], dir: P2 = [-0.053, 0.9986];
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i], [bx, bz] = line[i + 1];
      if ((az - 57) * (bz - 57) <= 0 && az !== bz) {
        const t = (57 - az) / (bz - az), L = Math.hypot(bx - ax, bz - az);
        at = [ax + (bx - ax) * t, 57];
        dir = [(bx - ax) / L, (bz - az) / L];
      }
    }
    if (dir[1] < 0) dir = [-dir[0], -dir[1]];                      // going in: south (the line may run either way)
    const nx = dir[1], nz = -dir[0], ry = Math.atan2(-nz, nx);   // across the road: +n is the left going in (east)
    // a point in the gate's frame: u across (+: left going in), v along the road (-: outside, toward the start)
    const P = (u: number, v: number): P2 => [at[0] + nx * u + dir[0] * v, at[1] + nz * u + dir[1] * v];
    const half = ROAD_W / 2 + WALK + 0.3, T = 2.2, OPEN_H = 5.0, TOP = 6.7;
    const stone: THREE.BufferGeometry[] = [];
    const block = (u0: number, u1: number, y0: number, y1: number, t = T, v = 0) => {
      const [x, z] = P((u0 + u1) / 2, v);
      stone.push(stoneBox(x, (y0 + y1) / 2, z, u1 - u0, y1 - y0, t, ry));
    };
    // the two sides of the opening, the lintel, and the right-hand wall stepping down and running on
    block(half, half + 4.5, 0, TOP);                 // left
    block(-half - 5.5, -half, 0, TOP);               // right
    block(-half, half, OPEN_H, TOP);                 // over the opening
    block(-half - 9, -half - 5.5, 0, TOP - 1.4);     // the step down
    block(-half - 22, -half - 9, 0, 3.0, 1.2, 0.5);  // the low wall on to the chhatri
    block(half + 4.5, half + 7, 0, 3.4, 1.2, 0.5);   // a stub on the left, to the metro side
    // crenellations along the top, and the raised middle
    for (let u = -half - 5.2; u <= half + 4.2; u += 1.25) {
      const [x, z] = P(u, 0);
      stone.push(stoneBox(x, TOP + 0.3, z, 0.65, 0.6, T, ry));
    }
    for (let u = -half - 8.7; u <= -half - 5.8; u += 1.25) {
      const [x, z] = P(u, 0);
      stone.push(stoneBox(x, TOP - 1.4 + 0.3, z, 0.65, 0.6, T, ry));
    }
    block(-2.6, 2.6, TOP, TOP + 1.1, T + 0.2);
    const sm = new THREE.Mesh(mergeGeometries(stone), new THREE.MeshStandardMaterial({ map: stoneTex(), roughness: 0.92 }));
    sm.castShadow = sm.receiveShadow = true;
    this.group.add(sm);
    for (const k of [-1, 1]) this.posts.push(...colliders(P(k * (half + 2.4), 0), 2.4, T, ry, 8));
    this.posts.push(...colliders(P(-half - 7.2, 0), 1.8, T, ry, 7), ...colliders(P(-half - 15.5, 0.5), 6.5, 1.2, ry, 4));
    // the pink box over the middle, the flag on it
    const [bx, bz] = P(0, 0);
    this.solid.box(bx, TOP + 1.6, bz, 3.2, 1.0, 1.6, '#d98a84', ry).box(bx, TOP + 2.15, bz, 3.4, 0.12, 1.8, '#f0e6dc', ry);
    this.solid.rod(new THREE.Vector3(bx, TOP + 2.2, bz), new THREE.Vector3(bx, TOP + 5.2, bz), 0.04, '#d9d9d9');
    const flag = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(1.3, -0.35, 0), new THREE.Vector3(0, -0.8, 0),
      new THREE.Vector3(0, -0.8, 0), new THREE.Vector3(1.3, -0.35, 0), new THREE.Vector3(0, 0, 0),
    ]).rotateY(ry).translate(bx, TOP + 5.2, bz);
    flag.computeVertexNormals();
    this.solid.add(flag, '#f57c00');
    // the lintel's underside, in shadow
    this.solid.box(bx, OPEN_H - 0.02, bz, half * 2, 0.04, T - 0.05, '#4c4a46', ry);
    // the emblem at the opening's right, on the outside face: a gold ring, green leaves, a red heart; lit
    const [ex, ez] = P(-half - 1.9, -T / 2 - 0.12);
    const em = new THREE.Mesh(new THREE.CircleGeometry(1.35, 40), bannerMat(emblemTex(), 0.9));
    em.position.set(ex, 4.5, ez);
    em.rotation.y = ry + Math.PI;
    this.group.add(em);
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2, [x, z] = P(-half - 1.9 + Math.cos(a) * 1.5, -T / 2 - 0.16);
      this.bulbs.add(x, 4.5 + Math.sin(a) * 1.5, z, BULB[i % 3], (i % 7) / 7, 1.1);
    }
    // the golden lion before the right-hand wall, outside
    const [lx, lz] = P(-half - 6.5, -T / 2 - 1.6);
    this.lion(lx, lz, ry + Math.PI);
    this.posts.push([lx, lz, 1.0, 2.6]);
    // the chhatri on the low wall: four slim pillars, a pink dome
    const [cx, cz] = P(-half - 16, 0.5);
    this.solid.box(cx, 3.15, cz, 2.6, 0.3, 2.0, '#d8d1c4', ry);
    for (const [du, dv] of [[-1, -0.7], [1, -0.7], [-1, 0.7], [1, 0.7]]) {
      const [px, pz] = P(-half - 16 + du, 0.5 + dv);
      this.solid.cyl(px, 3.3, pz, 0.1, 1.4, '#ece6da', 8);
    }
    this.solid.box(cx, 4.8, cz, 2.6, 0.25, 2.0, '#d98a84', ry);
    this.solid.add(new THREE.SphereGeometry(0.95, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#d98a84', new THREE.Matrix4().makeTranslation(cx, 4.92, cz));
    this.solid.add(new THREE.ConeGeometry(0.12, 0.5, 8), '#c9a227', new THREE.Matrix4().makeTranslation(cx, 6.1, cz));
    // the left, outside: pink pipe railings along the raised footpath, its kerb painted yellow and black
    const east = (ls: [P2[], P2[]]) => (ls[0][0][0] + ls[0][ls[0].length - 1][0] > ls[1][0][0] + ls[1][ls[1].length - 1][0] ? ls[0] : ls[1]);
    const fp = east(offsetLines(line, ROAD_W / 2 + WALK - 0.15)).filter(([, z]) => z > 18 && z < at[1] - T);
    if (fp.length > 1) {
      walkAlong(fp, 1.6, (x, z) => this.solid.cyl(x, 0.16, z, 0.035, 0.95, '#d97b86', 6), 0);
      for (const h of [0.6, 1.08]) walkAlongSegs(fp, (a, b, L, r) => this.solid.box((a[0] + b[0]) / 2, h, (a[1] + b[1]) / 2, L, 0.06, 0.06, '#d97b86', r));
    }
    const kerb = east(offsetLines(line, ROAD_W / 2 + 0.06)).filter(([, z]) => z > 18 && z < at[1] + 12);
    let n = 0;
    walkAlong(kerb, 0.6, (x, z, dx, dz) => this.solid.box(x, 0.09, z, 0.58, 0.19, 0.14, n++ % 2 ? '#1d1d1d' : '#f2c21b', Math.atan2(-dz, dx)), 0);
    // lights: the gate is lit from the road, white
    this.lights?.add(P(0, -7)[0], 5, P(0, -7)[1], '#fff1d6', 170, 22);
    this.lights?.add(ex, 2.5, ez - dir[1] * 3, '#ffd27a', 35, 8);
  }

  /** a seated lion, gold, on a low plinth (generic) */
  private lion(x: number, z: number, ry: number): void {
    const g = this.solid, G = '#c8962e', base = 0.9;
    g.box(x, base / 2, z, 1.6, base, 2.2, '#cfc6b6', ry);
    const at = (lx: number, ly: number, lz: number) => new THREE.Vector3(x + lx * Math.cos(ry) + lz * Math.sin(ry), base + ly, z - lx * Math.sin(ry) + lz * Math.cos(ry));
    const put = (geo: THREE.BufferGeometry, p: THREE.Vector3) => g.add(geo.rotateY(ry), G, new THREE.Matrix4().setPosition(p));
    put(new THREE.SphereGeometry(0.5, 12, 10).scale(0.8, 0.75, 1.3).rotateX(0.55), at(0, 0.62, -0.15));     // haunch and chest, sitting up
    put(new THREE.SphereGeometry(0.42, 12, 10).scale(1.1, 1.05, 0.9), at(0, 1.25, 0.32));                    // mane
    put(new THREE.SphereGeometry(0.26, 10, 8).scale(0.9, 0.95, 1.1), at(0, 1.28, 0.62));                     // face
    put(new THREE.BoxGeometry(0.2, 0.16, 0.2), at(0, 1.18, 0.84));                                          // muzzle
    for (const sx of [-0.18, 0.18]) {
      g.rod(at(sx, 0.85, 0.35), at(sx, 0.02, 0.5), 0.09, G);                     // forelegs straight down
      put(new THREE.BoxGeometry(0.2, 0.1, 0.3), at(sx, 0.05, 0.56));
      put(new THREE.SphereGeometry(0.28, 8, 6).scale(0.7, 0.6, 1.4), at(sx * 1.6, 0.2, -0.35));            // back legs folded
      put(new THREE.SphereGeometry(0.06, 6, 4), at(sx * 0.5, 1.36, 0.78));                                 // ears / brow
    }
    g.rod(at(0.3, 0.15, -0.65), at(0.55, 0.1, 0.15), 0.05, G);                   // tail round the side
    this.lights?.add(at(0, 1.2, 1.8).x, 1.5, at(0, 1.2, 1.8).z, '#ffd9a0', 60, 7);
  }

  /** the statue in the island before the gate: a gold figure on horseback atop a tapering white pillar with a red stripe down it (generic, not a likeness) */
  private statue(): void {
    const [x, z] = STATUE, g = this.solid;
    g.box(x, 0.3, z, 2.8, 0.6, 2.8, '#9b9184').box(x, 0.75, z, 2.2, 0.3, 2.2, '#e6e0d4');
    // the pillar: a square frustum, 1.9 m across at the foot, 1.25 at the top, 5.2 m tall
    const H = 5.2, B = 1.9, Tp = 1.25, y0 = 0.9;
    g.add(new THREE.CylinderGeometry(Tp / Math.SQRT2, B / Math.SQRT2, H, 4, 1).rotateY(Math.PI / 4), '#f1ece2', new THREE.Matrix4().makeTranslation(x, y0 + H / 2, z));
    const tilt = Math.atan((B - Tp) / 2 / H);
    for (let f = 0; f < 4; f++) {
      const a = (f * Math.PI) / 2, mid = (B + Tp) / 4 + 0.012;
      const geo = new THREE.BoxGeometry(0.42, H / Math.cos(tilt), 0.02).rotateX(-tilt).rotateY(a);
      g.add(geo, '#b3261e', new THREE.Matrix4().makeTranslation(x + Math.sin(a) * mid, y0 + H / 2, z + Math.cos(a) * mid));
    }
    g.box(x, y0 + H + 0.12, z, 1.5, 0.24, 1.5, '#e6e0d4');
    // the horseman, gold
    const Gd = '#c9962f', base = y0 + H + 0.24, ry = 0.4;
    const at = (lx: number, ly: number, lz: number) => new THREE.Vector3(x + lx * Math.cos(ry) + lz * Math.sin(ry), base + ly, z - lx * Math.sin(ry) + lz * Math.cos(ry));
    g.add(new THREE.SphereGeometry(0.42, 10, 8).scale(0.75, 0.7, 1.45).rotateX(-0.25).rotateY(ry), Gd, new THREE.Matrix4().setPosition(at(0, 0.95, 0)));
    g.rod(at(0, 1.12, 0.45), at(0, 1.62, 0.8), 0.17, Gd);
    g.add(new THREE.BoxGeometry(0.2, 0.22, 0.46).rotateX(0.5).rotateY(ry), Gd, new THREE.Matrix4().setPosition(at(0, 1.66, 0.96)));
    for (const sx of [-0.17, 0.17]) {
      g.rod(at(sx, 0.85, -0.38), at(sx, 0, -0.5), 0.07, Gd);
      g.rod(at(sx, 0.88, 0.38), at(sx, 0.55, 0.8), 0.06, Gd);
      g.rod(at(sx, 0.55, 0.8), at(sx, 0.3, 0.62), 0.05, Gd);
    }
    g.rod(at(0, 0.92, -0.58), at(0, 0.38, -0.84), 0.06, Gd);
    g.rod(at(0, 1.3, -0.04), at(0, 1.98, 0.04), 0.17, Gd);
    const hd = at(0, 2.15, 0.06);
    g.sphere(hd.x, hd.y, hd.z, 0.14, Gd);
    g.add(new THREE.SphereGeometry(0.16, 8, 6).scale(1, 0.7, 1), '#d9a93a', new THREE.Matrix4().setPosition(at(0, 2.27, 0.06)));   // the turban
    g.rod(at(0.19, 1.88, 0.04), at(0.3, 2.3, 0.25), 0.045, Gd);
    g.rod(at(0.3, 2.3, 0.25), at(0.34, 2.95, 0.45), 0.022, '#e3c66a');
    for (const sx of [-0.21, 0.21]) g.rod(at(sx, 1.35, 0), at(sx * 1.2, 0.88, 0.12), 0.06, Gd);
    this.posts.push([x, z, 1.5, 6]);
    // lit from below on two sides (as at night in the video: the pillar glows, the figure catches it)
    this.lights?.add(x + 4, 0.6, z + 4, '#ffe2b0', 45, 12);
    this.lights?.add(x - 4, 0.6, z - 4, '#ffe2b0', 35, 10);
  }

  /** strings of bulbs along the mela's road-side cloth wall (the video's first sight of the numaish) */
  private melaLights(): void {
    for (let x = MX0 + 0.4; x < MX1; x += 0.55) {
      if (Math.abs(x - GATE.x) < GATE.half + 7.8) continue;     // the gate has its own
      const i = Math.round(x / 0.55);
      this.bulbs.add(x, 3.55 - 0.18 * Math.sin(((x - MX0) / 6) * Math.PI) ** 2, MZ1 + 0.25, BULB[i % 6], (i % 10) / 10, 1.05);
    }
    for (let x = MX0 + 12; x < MX1; x += 26) this.lights?.add(x, 3, MZ1 + 4, '#ffc58a', 70, 14);
  }

  /**
   * Cars, bikes and cycles parked along both kerbs, with long gaps (a third of a full row). They are the traffic's own
   * vehicles (Traffic.pin), locked: Ramu can pick a lock and take one (drive.ts).
   */
  private parkingSpots(): ParkSpot[] {
    const line = routeLine(this.map);
    if (line.length < 2) return [];
    const KINDS: { name: string; len: number; w: number }[] = [
      { name: 'swift', len: 3.9, w: 1.8 },
      { name: 'maruti', len: 3.4, w: 1.5 },
      { name: 'bolero', len: 4.0, w: 1.9 },
      { name: 'ambassador', len: 4.3, w: 1.9 },
      { name: 'pulsar', len: 2.0, w: 0.8 },
      { name: 'pulsar', len: 2.0, w: 0.8 },
      { name: 'cycle', len: 1.8, w: 0.6 },
    ];
    const spots: ParkSpot[] = [];
    let n = 0;
    for (const side of [0, 1] as const) {
      const kerb = offsetLines(line, ROAD_W / 2 - 0.95)[side];
      let s = 0, seed = side * 101;
      walkAlong(kerb, 0.5, (x, z, dx, dz) => {
        s -= 0.5;
        if (s > 0) return;
        seed++;
        const r = rnd(seed * 3.3);
        const k = r < 0.12 ? -1 : r < 0.62 ? Math.floor(rnd(seed * 7.1) * 4) : 4 + Math.floor(rnd(seed * 5.7) * 3);
        // keep clear: the gate, the mela gate's front, the bend, the barricades, the start
        const clear = Math.hypot(x - (-30), z - 57) < 14 || Math.hypot(x - GATE.x, z - (MZ1 + 12)) < 18 || Math.hypot(x + 44, z - 340) < 16 ||
          z < 70 || x < -214 || !inCorridor(x, z);
        if (k < 0 || clear) { s = 4 + rnd(seed) * 8; return; }
        const K = KINDS[k], bike = k >= 4;
        s = (bike ? 1.1 : K.len + 0.9) + (rnd(seed * 4.4) < 0.15 ? 6 + rnd(seed) * 10 : 0);
        if (n++ % 3) return;                     // a third of the row: the rest is gaps
        // cars along the kerb; two-wheelers angled in, nose to the footpath
        const heading = Math.atan2(dx, dz) + (bike ? (side === 0 ? 1 : -1) * 1.1 : side === 0 ? 0 : Math.PI) + (rnd(seed * 2.1) - 0.5) * 0.08;
        const off = bike ? 0.15 : 0;
        const nx = side === 0 ? -dz : dz, nz = side === 0 ? dx : -dx;    // toward the kerb
        spots.push({ kind: K.name, x: x + nx * off, z: z + nz * off, heading });
      }, 0);
    }
    return spots;
  }
}

/** a box with the stone texture laid at its true size on every face (a tile is 1.6 m by 1.0 m of wall), turned ry about y */
function stoneBox(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, ry: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // faces: +x, -x, +y, -y, +z, -z; four corners each
  const dims: [number, number][] = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, uv.getX(i) * dims[f][0] / 1.6 + (cx + cz) * 0.13, uv.getY(i) * dims[f][1] / 1.0 + cy * 0.07);
  }
  return g.rotateY(ry).translate(cx, cy, cz);
}

/** collision posts in a row along a wall piece: centre (x, z), half length `h` along ry, thickness t */
function colliders([x, z]: P2, h: number, t: number, ry: number, height: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [], c = Math.cos(ry), s = -Math.sin(ry), r = t / 2;
  for (let d = -h + r; d <= h - r + 1e-6; d += r) out.push([x + c * d, z + s * d, r, height]);
  return out;
}

/** rough-dressed stone blocks, grey to off-white, in courses, deep dark joints (the gate's wall) */
function stoneTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 320;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4a4744';
  g.fillRect(0, 0, 512, 320);
  let seed = 3;
  const r = () => rnd(seed++ * 1.37);
  for (let row = 0; row < 5; row++) {
    const y = row * 64;
    let x = row % 2 ? -50 : 0;
    while (x < 512) {
      const w = 80 + r() * 60;
      const l = 150 + r() * 70, tint = r() * 14 - 7;
      g.fillStyle = `rgb(${l + tint},${l + tint},${l - 4})`;
      g.fillRect(x + 3, y + 3, w - 6, 58);
      // a rough face: darker blotches and speckle
      for (let k = 0; k < 40; k++) {
        const s = r();
        g.fillStyle = `rgba(${s < 0.5 ? '60,58,55' : '235,232,226'},${0.06 + r() * 0.1})`;
        g.fillRect(x + 3 + r() * (w - 12), y + 3 + r() * 50, 3 + r() * 10, 2 + r() * 7);
      }
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(x + 3, y + 55, w - 6, 6);
      x += w;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** the emblem over the gate's right side: a gold ring, a wreath of green leaves, a saffron and red centre with a gold crown */
function emblemTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e0a520';
  g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#7a1f12';
  g.beginPath(); g.arc(128, 128, 104, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    g.save();
    g.translate(128 + Math.cos(a) * 88, 128 + Math.sin(a) * 88);
    g.rotate(a + Math.PI / 2);
    g.fillStyle = i % 2 ? '#2f8f3a' : '#4cb050';
    g.beginPath(); g.ellipse(0, 0, 8, 17, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  g.fillStyle = '#f57c00';
  g.beginPath(); g.arc(128, 128, 62, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#f2c21b';
  g.beginPath();
  g.moveTo(84, 150); g.lineTo(92, 100); g.lineTo(110, 124); g.lineTo(128, 88); g.lineTo(146, 124); g.lineTo(164, 100); g.lineTo(172, 150);
  g.closePath(); g.fill();
  g.fillStyle = '#b3261e';
  for (const x of [104, 128, 152]) { g.beginPath(); g.arc(x, 140, 6, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** cut a line into pieces no longer than `step` m (walkers spread evenly over a graph made of them) */
function subdivide(pts: P2[], step: number): P2[] {
  const out: P2[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    // along the mela (the road west of the bend) five times as many: that is where the crowd is
    const st = (a[0] + b[0]) / 2 < -55 && (a[1] + b[1]) / 2 > 300 ? step / 5 : step;
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / st));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/**
 * Where the stage 1 crowd walks (a map of its own for a local Pedestrians): both footpaths of the corridor road, its
 * edges among the parked vehicles, the little roads at the start, and a small round in front of each food cart where
 * people stand about eating.
 */
export function corridorWalks(map: MapData, stalls: VendorSpot[]): MapData {
  const line = routeLine(map);
  const road = (pts: P2[], sidewalk: string, w: number): Road => ({
    id: 0, pts, w, cls: 'footway', name: '', oneway: false, lanes: 1, bridge: false, layer: 0, divider: false, sidewalk, surface: '',
  } as unknown as Road);
  const keep = (pts: P2[]) => pts.filter(([x, z]) => inCorridor(x, z));
  const roads: Road[] = [];
  if (line.length > 1) {
    // footpaths: the walker's line is the road's + 1 m out (sidewalk), so these lines run just inside the kerb
    for (const side of offsetLines(line, ROAD_W / 2 + 0.1)) { const p = keep(subdivide(side, 8)); if (p.length > 1) roads.push(road(p, 'yes', 0)); }
    // the road's edges, among the parked cars and bikes
    for (const side of offsetLines(line, ROAD_W / 2 - 1.0)) { const p = keep(subdivide(side, 16)); if (p.length > 1) roads.push(road(p, 'no', 1)); }
  }
  for (const r of map.roads) if (r.id !== PARK_ROAD && !r.bridge && r.pts.every(([x, z]) => inCorridor(x, z))) roads.push({ ...r, pts: subdivide(r.pts, 8) });
  for (const v of stalls) {
    const c = Math.cos(v.rot), s = Math.sin(v.rot), cx = v.x + s * 2.4, cz = v.z + c * 2.4;   // in front of it
    roads.push(road([[cx - 1.4, cz - 0.9], [cx + 1.4, cz - 0.9], [cx + 1.4, cz + 0.9], [cx - 1.4, cz + 0.9], [cx - 1.4, cz - 0.9]], 'no', 1));
  }
  return { ...map, roads };
}

/** each straight stretch of a line: ends, length, the y-rotation that lays a box's x along it */
function walkAlongSegs(line: P2[], fn: (a: P2, b: P2, L: number, ry: number) => void): void {
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > 0.05) fn(a, b, L, Math.atan2(-(b[1] - a[1]), b[0] - a[0]));
  }
}

/** the outward direction (away from the corridor) for a wall stretch, as a unit vector */
function side(inside: number, dx: number, dz: number): P2 {
  return [dz * inside, -dx * inside];
}

