import * as THREE from 'three';
import { BULB, Bulbs, banner, bannerMat, Geo, litMat, rnd } from './geo';
import { LightPool } from './night';
import { DX, DZ, GATE } from './melaSite';
import { loadPBR, PBRPart } from './vehicleModels';
import { walkAlong } from './city';
import { offsetLines } from './meshBuilder';
import { MapData, P2, pointInPoly, Road } from './types';
import { STATUE } from './stage1Site';
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
  // Japani Garden steps round the mela's north-east corner
  const jg = map.parks.find((p) => p.name === 'Japani Garden');
  if (jg) {
    jg.pts = jg.pts.flatMap(([x, z]): P2[] => {
      if (x > MX0 - 2 && x < MX1 + 2 && z > MZ0 - 2) return [[Math.max(x, MX0 - 2), MZ0 - 2], ...(x > MX1 - 15 ? [[MX1 + 2, MZ0 - 2] as P2] : [])];
      return [[x, z]];
    });
  }
  // the Nagar Nigam: the long building straight ahead at the bend; cream walls, no shop fronts
  for (const b of nagarNigam(map)) Object.assign(b, { color: '#e9dcc0', shop: false });
}

/** the Nagar Nigam: the long main block, and the front block before it (its entrance faces the park road) */
function nagarNigam(map: MapData) {
  return map.buildings.filter((b) => pointInPoly(-70, 415, b.pts) || pointInPoly(-60, 400, b.pts));
}

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
    this.parkWall([[-41, 8], [-41, 18], [-51, 265], [-52, 327], [MX1, 322]]);
    this.parkWall([[-12, 8], [-21, 19], [-29, 331]]);
    this.parkWall([[-222, 321], [-221, 294]]);
    this.compoundWall([[-29, 353], [-52, 350.2], [-141, 344.5], [-224, 338.5]]);
    this.barricade([-40.5, 8], [-12.5, 8]);
    this.barricade([-29, 332], [-29, 352.5]);
    this.barricade([-223.8, 338], [-222.1, 321.5]);
    this.tinFence([-221, 278], [MX0, 278]);
    this.shivajiGate();
    this.statue();
    this.nagarNigamFront();
    this.melaLights();
    const m = new THREE.Mesh(this.solid.build(), litMat({ metalness: 0.05, roughness: 0.85 }));
    m.castShadow = m.receiveShadow = true;
    this.group.add(m, this.bulbs.object(0.8));
    void this.parked();
  }

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

  /** the gate onto the park road (frame 0:16): sandstone piers, a battlemented lintel with little domes, a saffron flag */
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
    const nx = dir[1], nz = -dir[0], ry = Math.atan2(-nz, nx);   // across the road
    const half = ROAD_W / 2 + WALK + 0.8, stone = '#b39a78', dark = '#8a7356';
    for (const k of [-1, 1]) {
      const px = at[0] + nx * k * half, pz = at[1] + nz * k * half;
      this.solid.box(px, 3.4, pz, 1.6, 6.8, 1.6, stone, ry).box(px, 6.95, pz, 2.0, 0.3, 2.0, dark, ry).box(px, 0.25, pz, 2.0, 0.5, 2.0, dark, ry);
      this.solid.add(new THREE.SphereGeometry(0.75, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), stone, new THREE.Matrix4().makeTranslation(px, 7.1, pz));
      this.posts.push([px, pz, 1.0, 8]);
      for (let i = 0; i < 6; i++) this.bulbs.add(px - nx * k * 0.85, 0.8 + i * 1.0, pz - nz * k * 0.85, '#ffd27a', -1, 1.4);
    }
    // lintel and battlements
    this.solid.box(at[0], 6.2, at[1], half * 2, 1.0, 1.1, stone, ry);
    for (let i = -6; i <= 6; i++) this.solid.box(at[0] + nx * i * half / 6.5, 6.95, at[1] + nz * i * half / 6.5, 0.45, 0.5, 0.9, dark, ry);
    this.solid.add(new THREE.SphereGeometry(1.0, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), stone, new THREE.Matrix4().makeTranslation(at[0], 6.7, at[1]));
    this.solid.rod(new THREE.Vector3(at[0], 7.6, at[1]), new THREE.Vector3(at[0], 10.4, at[1]), 0.04, '#d9d9d9');
    const flag = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(1.5, -0.4, 0), new THREE.Vector3(0, -0.9, 0),
    ]).rotateY(ry).translate(at[0], 10.4, at[1]);
    flag.computeVertexNormals();
    this.solid.add(flag, '#f57c00');
    const tex = banner(1024, 180, '#7a2318', '#f2c21b', [{ text: 'मोती झील', size: 110, color: '#ffe9a8', y: 94 }]);
    for (const k of [1, -1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.9), bannerMat(tex, 0.55));
      p.position.set(at[0] + dir[0] * k * 0.57, 6.2, at[1] + dir[1] * k * 0.57);
      p.rotation.y = ry + (k > 0 ? 0 : Math.PI);
      this.group.add(p);
    }
    for (let i = 0; i < 24; i++) this.bulbs.add(at[0] + nx * (i / 23 - 0.5) * half * 2, 5.62, at[1] + nz * (i / 23 - 0.5) * half * 2 - dir[1] * 0.6, BULB[i % 3], (i % 6) / 6, 1.2);
    this.lights?.add(at[0] - dir[0] * 4, 5, at[1] - dir[1] * 4, '#ffcf8a', 160, 22);
  }

  /** a horseman on a tall pillar painted red with white bands, in the island where the way in splits (generic, not a likeness) */
  private statue(): void {
    const [x, z] = STATUE, g = this.solid;
    g.box(x, 0.35, z, 2.6, 0.7, 2.6, '#9b9184').box(x, 0.9, z, 2.0, 0.4, 2.0, '#d9d2c4');
    for (let i = 0; i < 6; i++) g.box(x, 1.1 + i * 0.85 + 0.425, z, 1.25, 0.85, 1.25, i % 2 ? '#f3efe6' : '#b0281c');
    g.box(x, 6.3, z, 1.7, 0.3, 1.7, '#d9d2c4');
    // the horse (rearing a little) and its rider, bronze
    const B = '#6b4a2b', base = 6.45, ry = 0.4;
    const at = (lx: number, ly: number, lz: number) => new THREE.Vector3(x + lx * Math.cos(ry) + lz * Math.sin(ry), base + ly, z - lx * Math.sin(ry) + lz * Math.cos(ry));
    g.add(new THREE.SphereGeometry(0.5, 10, 8).scale(0.75, 0.7, 1.45).rotateX(-0.25).rotateY(ry), B, new THREE.Matrix4().setPosition(at(0, 1.15, 0)));
    g.rod(at(0, 1.35, 0.55), at(0, 1.95, 0.95), 0.2, B);                     // neck
    g.add(new THREE.BoxGeometry(0.24, 0.26, 0.55).rotateX(0.5).rotateY(ry), B, new THREE.Matrix4().setPosition(at(0, 2.0, 1.15)));
    for (const sx of [-0.2, 0.2]) {
      g.rod(at(sx, 1.0, -0.45), at(sx, 0, -0.6), 0.08, B);                   // hind legs on the plinth
      g.rod(at(sx, 1.05, 0.45), at(sx, 0.65, 0.95), 0.07, B);                // forelegs raised
      g.rod(at(sx, 0.65, 0.95), at(sx, 0.35, 0.75), 0.06, B);
    }
    g.rod(at(0, 1.1, -0.7), at(0, 0.45, -1.0), 0.07, B);                     // tail
    g.rod(at(0, 1.55, -0.05), at(0, 2.35, 0.05), 0.2, B);                    // rider
    g.sphere(at(0, 2.55, 0.08).x, at(0, 2.55, 0.08).y, at(0, 2.55, 0.08).z, 0.17, B);
    g.add(new THREE.ConeGeometry(0.16, 0.3, 8), '#8a6a3a', new THREE.Matrix4().setPosition(at(0, 2.78, 0.08)));
    g.rod(at(0.22, 2.25, 0.05), at(0.35, 2.75, 0.3), 0.05, B);               // arm raised
    g.rod(at(0.35, 2.75, 0.3), at(0.4, 3.5, 0.55), 0.025, '#b9a27a');        // sword
    for (const sx of [-0.25, 0.25]) g.rod(at(sx, 1.6, 0), at(sx * 1.2, 1.05, 0.15), 0.07, B);
    this.posts.push([x, z, 1.4, 6]);
    this.lights?.add(x + 3, 2, z + 3, '#ffd9a0', 140, 16);
    this.lights?.add(x - 3, 2, z - 3, '#ffd9a0', 100, 14);
  }

  /** the Nagar Nigam's front: a portico, a parapet, the name board over the door, lit */
  private nagarNigamFront(): void {
    const front = nagarNigam(this.map).find((b) => pointInPoly(-60, 400, b.pts));
    if (!front) return;
    // the front block's north face, seen down the park road
    const x = front.pts.reduce((s, p) => s + p[0], 0) / front.pts.length, z = Math.min(...front.pts.map((p) => p[1])) + 0.2;
    this.solid.box(x, 2.2, z - 3.2, 14, 0.4, 6.4, '#e9dcc0');
    for (const k of [-6, -2, 2, 6]) this.solid.cyl(x + k, 0, z - 6, 0.35, 4.4, '#f2ead8', 12);
    this.solid.box(x, 4.6, z - 6.0, 14.6, 0.6, 0.7, '#a5452c').box(x, 0.12, z - 3.2, 15, 0.24, 7, '#bfb6a4');
    const tex = banner(1024, 256, '#14335c', '#f2c21b', [
      { text: 'कानपुर नगर निगम', size: 100, color: '#ffffff', y: 92 }, { text: 'KANPUR NAGAR NIGAM', size: 62, color: '#ffe14d', y: 196 },
    ]);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25), bannerMat(tex, 0.75));
    p.position.set(x, 7.2, z - 6.45);
    p.rotation.y = Math.PI;
    this.group.add(p);
    this.lights?.add(x, 3.5, z - 9, '#fff1d6', 160, 20);
    for (let i = 0; i < 9; i++) this.bulbs.add(x - 7 + i * 1.75, 4.25, z - 6.4, '#fff3d0', -1, 1.6);
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

  /** cars, autos, bikes and cycles parked nose to tail along both kerbs, with gaps; instanced per model part */
  private async parked(): Promise<void> {
    const line = routeLine(this.map);
    if (line.length < 2) return;
    const KINDS: { name: string; len: number; w: number; paints: string[] }[] = [
      { name: 'swift', len: 3.9, w: 1.8, paints: ['#e8e8e8', '#9a1c1c', '#c9c9c9', '#2a3d66'] },
      { name: 'maruti', len: 3.4, w: 1.5, paints: ['#f2f2f2', '#d8d0c0'] },
      { name: 'bolero', len: 4.0, w: 1.9, paints: ['#f4f4f4', '#3b3b3b'] },
      { name: 'ambassador', len: 4.3, w: 1.9, paints: ['#f4f1e8'] },
      { name: 'pulsar', len: 2.0, w: 0.8, paints: ['#1e1e1e', '#2b4aa0', '#9a1c1c'] },
      { name: 'enfield', len: 2.1, w: 0.85, paints: ['#1e1e1e', '#5b3a22'] },
      { name: 'cycle', len: 1.8, w: 0.6, paints: ['#2b2b2b'] },
    ];
    const spots: { k: number; x: number; z: number; ry: number; paint: string }[] = [];
    for (const side of [0, 1] as const) {
      const kerb = offsetLines(line, ROAD_W / 2 - 1.15)[side];
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
        // cars along the kerb; two-wheelers angled in, nose to the footpath
        const ry = Math.atan2(dx, dz) + (bike ? (side === 0 ? 1 : -1) * 1.1 : side === 0 ? 0 : Math.PI) + (rnd(seed * 2.1) - 0.5) * 0.08;
        const off = bike ? 0.25 : 0;
        const nx = side === 0 ? -dz : dz, nz = side === 0 ? dx : -dx;    // toward the kerb
        spots.push({ k, x: x + nx * off, z: z + nz * off, ry, paint: K.paints[Math.floor(rnd(seed * 9.9) * K.paints.length)] });
        if (bike) this.posts.push([x, z, 0.5, 1.3]);
        else {
          const fx = Math.sin(ry), fz = Math.cos(ry), q = K.len / 2 - K.w / 2;
          this.posts.push([x + fx * q, z + fz * q, K.w / 2, 1.6], [x - fx * q, z - fz * q, K.w / 2, 1.6]);
        }
        s = (bike ? 1.1 : K.len + 0.9) + (rnd(seed * 4.4) < 0.15 ? 6 + rnd(seed) * 10 : 0);
      }, 0);
    }
    this.parkedSpots = spots.length;
    await Promise.all(KINDS.map(async (K, ki) => {
      const mine = spots.filter((p) => p.k === ki);
      if (!mine.length) return;
      let parts: PBRPart[];
      try { parts = await loadPBR(K.name); } catch (e) { console.error('parked', K.name, e); return; }
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
      for (const { geo, mat } of parts) {
        const tint = mat.name === 'paint' || !!mat.map;
        const mm = tint ? mat.clone() : mat;
        if (tint) mm.color.set('#ffffff');
        const im = new THREE.InstancedMesh(geo, mm, mine.length);
        mine.forEach((p, i) => {
          im.setMatrixAt(i, m4.compose(new THREE.Vector3(p.x, 0.02, p.z), q.setFromAxisAngle(up, p.ry), one));
          if (tint) im.setColorAt(i, new THREE.Color(p.paint).lerp(new THREE.Color('#ffffff'), mat.map ? 0.55 : 0));
        });
        im.castShadow = mat.name !== 'glass';
        if (mat.name === 'glass') im.renderOrder = 1;
        im.computeBoundingSphere();
        this.group.add(im);
      }
    }));
  }
  parkedSpots = 0;
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

