import * as THREE from 'three';
import { walkAlong } from './city';
import { makeGroundMaterial, SURF } from './ground';
import { MeshBuilder, offsetLines } from './meshBuilder';
import { makeTrees } from './trees';
import { DRIVABLE, hash2, MapData, P2, pointInPoly } from './types';

const MAJOR = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'secondary_link', 'trunk_link', 'primary_link']);
const POLE_H = 8.0;
const C = (h: string) => new THREE.Color(h);

/**
 * Street furniture and road detail:
 *  - raised footpaths with kerbs on roads with sidewalks
 *  - median kerb on one-way halves of dual carriageways (metro pillars stand on it)
 *  - electric poles with sagging wires, street lamps, street trees
 * Real OSM / Mapillary points are used where they exist; streets without data get evenly spaced items.
 */
export class StreetDetail {
  readonly group = new THREE.Group();
  /** extra solid obstacles for collision: [x, z, radius] */
  readonly obstacles: [number, number, number][] = [];
  drawCalls = 0;

  constructor(map: MapData, occupied: (x: number, z: number) => boolean) {
    const kerb = new MeshBuilder();
    const poles: [number, number, number][] = [];   // x, z, rot
    const lamps: [number, number, number][] = [];
    const trees: [number, number, number][] = [];
    const wires: number[] = [];

    const real = { pole: 0, lamp: 0, tree: 0 };
    for (const f of map.furniture) {
      if (f.t === 'pole') (poles.push([f.p[0], f.p[1], 0]), real.pole++);
      else if (f.t === 'lamp') (lamps.push([f.p[0], f.p[1], 0]), real.lamp++);
      else if (f.t === 'tree') real.tree++; // trees from data are planted by City
    }
    const nearReal = (list: [number, number, number][], x: number, z: number, r: number) =>
      list.some(([px, pz]) => Math.abs(px - x) < r && Math.abs(pz - z) < r);

    for (const r of map.roads) {
      if (!DRIVABLE.has(r.cls) || r.bridge) continue;
      const hw = r.w / 2;
      const major = MAJOR.has(r.cls);
      const hasWalk = !!r.sidewalk && r.sidewalk !== 'no' && r.sidewalk !== 'none';
      const style = major ? map.styles.main_road : map.styles.colony_lane;

      if (hasWalk) {
        const [L, R] = offsetLines(r.pts, hw + 1.1);
        kerb.surf = SURF.paving;
        if (r.sidewalk !== 'right') kerb.slab(L, 2.2, 0, 0.16, C('#a39d92'));
        if (r.sidewalk !== 'left') kerb.slab(R, 2.2, 0, 0.16, C('#a39d92'));
        kerb.surf = SURF.concrete;
      }
      // Dual carriageway: median on the right edge (India drives on the left).
      if (r.oneway && major) {
        const R = offsetLines(r.pts, hw + 0.6)[1];
        kerb.slab(R, 1.2, 0, 0.3, C('#c6c0b3'));
        walkAlong(R, 4.5, (x, z) => kerb.box(x, 0.3, z, 0.12, 0.25, 0.12, C('#e8e3d6')), 1.5); // painted kerb blocks
      }

      // Poles + wires: one side of the street; colony lanes get them too (they are everywhere in Kanpur).
      if (r.cls !== 'service' || hash2(r.id, 1) < 0.4) {
        const side = hash2(r.id, 7) < 0.5 ? 0 : 1;
        const line = offsetLines(r.pts, hw + (hasWalk ? 1.6 : 0.6))[side];
        let prev: [number, number] | null = null;
        walkAlong(line, major ? 38 : 32, (x, z) => {
          if (occupied(x, z) || nearReal(poles, x, z, 12)) {
            prev = null;
            return;
          }
          poles.push([x, z, hash2(x, z) * 0.3]);
          if (prev) addWires(wires, prev[0], prev[1], x, z, hash2(x, z));
          prev = [x, z];
        }, 6 + hash2(r.id, 3) * 10);
      }

      // Lamps on main roads (on the median for dual carriageways).
      if (major) {
        const line = r.oneway ? offsetLines(r.pts, hw + 0.6)[1] : offsetLines(r.pts, hw + 1.4)[1 - (r.id % 2)];
        walkAlong(line, 32, (x, z) => {
          if (!occupied(x, z) && !nearReal(lamps, x, z, 10)) lamps.push([x, z, 0]);
        }, 12);
      }

      // Street trees from the style table (borrowed where the street is not covered by photos).
      const every = style?.tree_every_m ?? 25;
      for (const s of [0, 1] as const) {
        const line = offsetLines(r.pts, hw + (hasWalk ? 1.6 : 1.2))[s];
        walkAlong(line, every, (x, z) => {
          if (hash2(x * 3.1, z) < 0.55 && !occupied(x, z) && !occupiedNear(occupied, x, z, 1.8)) {
            trees.push([x, z, hash2(x, z)]);
          }
        }, every * hash2(r.id, s + 11));
      }
    }

    this.addMesh(kerb.build(), makeGroundMaterial(), true);
    this.addPoles(poles);
    this.addLamps(lamps);
    this.addTrees(trees);
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
    const wl = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: '#1b1b1b' }));
    this.group.add(wl);
    this.drawCalls++;
    for (const [x, z] of poles) this.obstacles.push([x, z, 0.2]);
    for (const [x, z] of lamps) this.obstacles.push([x, z, 0.15]);
    for (const [x, z] of trees) this.obstacles.push([x, z, 0.3]);
    console.log('street detail', { poles: poles.length, lamps: lamps.length, trees: trees.length, real });
  }

  private addMesh(g: THREE.BufferGeometry, m: THREE.Material, receive: boolean): void {
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = receive;
    mesh.castShadow = true;
    this.group.add(mesh);
    this.drawCalls++;
  }

  private instanced(g: THREE.BufferGeometry, m: THREE.Material, list: [number, number, number][], scale = false): void {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(g, m, list.length);
    const mat = new THREE.Matrix4();
    list.forEach(([x, z, r], i) => {
      const s = scale ? 0.8 + r * 0.6 : 1;
      mat.makeRotationY(r * 6.28).scale(new THREE.Vector3(s, s, s)).setPosition(x, 0, z);
      im.setMatrixAt(i, mat);
    });
    im.castShadow = true;
    this.group.add(im);
    this.drawCalls++;
  }

  private addPoles(list: [number, number, number][]): void {
    // Concrete pole with a cross-arm and a transformer-ish box on some.
    const mb = new MeshBuilder();
    const grey = C('#8d8a84');
    mb.box(0, 0, 0, 0.22, POLE_H, 0.22, grey);
    mb.box(0, POLE_H - 0.6, 0, 1.6, 0.1, 0.1, C('#5a5a5a'));
    mb.box(0, POLE_H - 1.3, 0, 1.1, 0.08, 0.08, C('#5a5a5a'));
    this.instanced(mb.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), list);
  }

  private addLamps(list: [number, number, number][]): void {
    const mb = new MeshBuilder();
    mb.box(0, 0, 0, 0.16, 9, 0.16, C('#9aa0a4'));
    mb.box(0.9, 8.8, 0, 1.8, 0.1, 0.1, C('#9aa0a4'));
    mb.box(1.7, 8.6, 0, 0.6, 0.18, 0.3, C('#e9e4c8'));
    mb.box(-0.9, 8.8, 0, 1.8, 0.1, 0.1, C('#9aa0a4'));
    mb.box(-1.7, 8.6, 0, 0.6, 0.18, 0.3, C('#e9e4c8'));
    this.instanced(mb.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 }), list);
  }

  private addTrees(list: [number, number, number][]): void {
    for (const im of makeTrees(list)) {
      this.group.add(im);
      this.drawCalls++;
    }
  }
}

function occupiedNear(occ: (x: number, z: number) => boolean, x: number, z: number, r: number): boolean {
  return occ(x + r, z) || occ(x - r, z) || occ(x, z + r) || occ(x, z - r);
}

/** 2–4 sagging wires between two poles, as line segments. */
function addWires(out: number[], ax: number, az: number, bx: number, bz: number, h: number): void {
  const count = 2 + Math.floor(h * 3);
  const L = Math.hypot(bx - ax, bz - az);
  if (L > 60) return;
  const nx = -(bz - az) / L, nz = (bx - ax) / L;
  for (let w = 0; w < count; w++) {
    const off = (w - (count - 1) / 2) * 0.45;
    const y0 = POLE_H - 0.6 - (w % 2) * 0.7;
    const sag = 0.5 + L * 0.02 + ((w * 0.37 + h) % 1) * 0.4;
    const N = 8;
    for (let i = 0; i < N; i++) {
      for (const k of [i, i + 1]) {
        const t = k / N;
        out.push(ax + (bx - ax) * t + nx * off, y0 - sag * 4 * t * (1 - t), az + (bz - az) * t + nz * off);
      }
    }
  }
}

/** Fast point-in-building test on a grid (for keeping furniture off footprints). */
export function makeOccupancy(map: MapData): (x: number, z: number) => boolean {
  const CELL = 10;
  const cells = new Map<string, P2[][]>();
  for (const b of map.buildings) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of b.pts) {
      x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z);
    }
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const k = cx + ',' + cz;
        let l = cells.get(k);
        if (!l) cells.set(k, (l = []));
        l.push(b.pts);
      }
  }
  const water = map.water.map((w) => w.pts);
  return (x, z) => {
    const l = cells.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL));
    if (l) for (const p of l) if (pointInPoly(x, z, p)) return true;
    for (const w of water) if (pointInPoly(x, z, w)) return true;
    return false;
  };
}
