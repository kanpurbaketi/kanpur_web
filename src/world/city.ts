import * as THREE from 'three';
import { makeFacadeMaterial } from './facade';
import { MeshBuilder, offsetLines } from './meshBuilder';
import { centroid, DRIVABLE, hash2, MapData, MARKED, P2, pointInPoly, signedArea } from './types';

const TILE = 250;
const VIADUCT_Y = 9.5;

const C = (hex: string) => new THREE.Color(hex);
const COL = {
  ground: C('#a89a7c'),
  asphalt: C('#3d3e40'),
  asphaltLane: C('#4a4b4d'),
  verge: C('#8e8270'),
  footpath: C('#9d978c'),
  kerb: C('#c9c4b8'),
  mark: C('#e9e6dc'),
  water: C('#2f5f66'),
  park: C('#5f8a3e'),
  rail: C('#6e665c'),
  concrete: C('#b9b5ac'),
  tank: C('#151515'),
  trunk: C('#5a4330'),
  crown: C('#3f6e2c'),
  crown2: C('#4f7d33'),
};

export interface CityStats {
  drawCalls: number;
  triangles: number;
  buildings: number;
}

/** Builds the whole area. Geometry is merged per material per 250 m tile. */
export class City {
  readonly group = new THREE.Group();
  readonly buildingMeshes: THREE.Mesh[] = [];
  /** drivable road vertices (for spawn / snapping) */
  readonly roadPoints: P2[] = [];
  /** metro viaduct pier positions (for collision) */
  readonly pillars: P2[] = [];
  readonly stats: CityStats = { drawCalls: 0, triangles: 0, buildings: 0 };

  private mats = {
    flat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
    water: new THREE.MeshStandardMaterial({ color: COL.water, roughness: 0.1, metalness: 0.35 }),
    facade: null as unknown as THREE.MeshStandardMaterial,
  };

  constructor(readonly map: MapData) {
    this.mats.facade = makeFacadeMaterial(map.floor_h);
    this.buildGround();
    const tiles = new Map<string, { flat: MeshBuilder; water: MeshBuilder; bld: MeshBuilder }>();
    const tileOf = (x: number, z: number) => {
      const k = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
      let t = tiles.get(k);
      if (!t) {
        t = { flat: new MeshBuilder(), water: new MeshBuilder(), bld: new MeshBuilder(true) };
        tiles.set(k, t);
      }
      return t;
    };

    // Roads: split polylines per tile by segment midpoint.
    for (const r of map.roads) {
      const drivable = DRIVABLE.has(r.cls);
      const y = 0; // TODO W4: raise bridges / flyovers by layer
      forEachTilePiece(r.pts, (pts, x, z) => {
        const t = tileOf(x, z).flat;
        if (drivable) {
          const sw = r.sidewalk && r.sidewalk !== 'no' && r.sidewalk !== 'none' ? 2.2 : 1.0;
          t.ribbon(pts, r.w + sw * 2, y + 0.02, sw > 1 ? COL.footpath : COL.verge);
          t.ribbon(pts, r.w, y + 0.05, COL.asphalt);
          if (MARKED.has(r.cls)) dashes(t, pts, y + 0.065);
        } else {
          t.ribbon(pts, r.w, y + 0.035, COL.footpath);
        }
      });
      if (drivable) {
        for (const end of [r.pts[0], r.pts[r.pts.length - 1]]) {
          const t = tileOf(end[0], end[1]).flat;
          t.disc(end[0], end[1], r.w / 2 + 1.0, 0.021, COL.verge, 12);
          t.disc(end[0], end[1], r.w / 2, 0.051, COL.asphalt, 12);
        }
        for (const p of r.pts) this.roadPoints.push(p);
      }
    }

    // Rails: at-grade tracks and the elevated metro viaduct.
    for (const r of map.rails) {
      const elevated = r.bridge || r.layer > 0 || r.kind === 'subway';
      forEachTilePiece(r.pts, (pts, x, z) => {
        const t = tileOf(x, z).flat;
        if (elevated) {
          t.slab(pts, 9.0, VIADUCT_Y - 1.4, VIADUCT_Y, COL.concrete);
          t.slab(offsetLines(pts, 4.3)[0], 0.3, VIADUCT_Y, VIADUCT_Y + 1.1, COL.concrete);
          t.slab(offsetLines(pts, 4.3)[1], 0.3, VIADUCT_Y, VIADUCT_Y + 1.1, COL.concrete);
        } else {
          t.ribbon(pts, 4.0, 0.03, COL.rail);
        }
      });
      if (elevated) {
        walkAlong(r.pts, 28, (x, z, dx, dz) => {
          const t = tileOf(x, z).flat;
          this.pillars.push([x, z]);
          t.box(x, 0, z, 1.8, VIADUCT_Y - 1.4, 1.8, COL.concrete);
          // pier cap, rotated roughly by picking the dominant axis
          if (Math.abs(dx) > Math.abs(dz)) t.box(x, VIADUCT_Y - 2.4, z, 2.2, 1.0, 6.5, COL.concrete);
          else t.box(x, VIADUCT_Y - 2.4, z, 6.5, 1.0, 2.2, COL.concrete);
        });
      }
    }

    for (const wb of map.water) {
      const [x, z] = centroid(wb.pts);
      tileOf(x, z).water.polygon(wb.pts, 0.08);
    }

    const trees: [number, number, number][] = [];
    for (const pk of map.parks) {
      const [x, z] = centroid(pk.pts);
      tileOf(x, z).flat.polygon(pk.pts, 0.03, COL.park);
      scatter(pk.pts, 110, trees, map.water.map((w) => w.pts));
    }
    for (const f of map.furniture) if (f.t === 'tree') trees.push([f.p[0], f.p[1], hash2(f.p[0], f.p[1])]);

    // Buildings.
    const tanks: [number, number, number][] = [];
    const tmp = new THREE.Color();
    for (const b of map.buildings) {
      const [cx, cz] = centroid(b.pts);
      const t = tileOf(cx, cz).bld;
      const style = map.styles[b.style];
      const signs = style?.signs ?? ['#c8261a'];
      const sign = tmp.set(signs[Math.floor(b.seed * 7919) % signs.length]).clone();
      addBuilding(t, b.pts, b.base, b.h, new THREE.Color(b.color), b.shop, new Set(b.front), b.seed,
        [sign.r, sign.g, sign.b]);
      // Black Sintex-style rooftop water tanks on most houses.
      if (b.h < 20 && b.seed > 0.3 && Math.abs(signedArea(b.pts)) > 35) tanks.push([cx, b.base + b.h, cz]);
      this.stats.buildings++;
    }

    for (const [, t] of tiles) {
      this.add(t.flat, this.mats.flat, false, true);
      this.add(t.water, this.mats.water, false, true);
      const m = this.add(t.bld, this.mats.facade, true, true);
      if (m) this.buildingMeshes.push(m);
    }
    this.addTrees(trees);
    this.addTanks(tanks);
  }

  private add(mb: MeshBuilder, mat: THREE.Material, cast: boolean, receive: boolean): THREE.Mesh | null {
    if (mb.empty) return null;
    const mesh = new THREE.Mesh(mb.build(), mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    this.stats.drawCalls++;
    this.stats.triangles += mb.pos.length / 9;
    return mesh;
  }

  private buildGround(): void {
    const [x0, z0, x1, z1] = this.map.bounds;
    const g = new THREE.PlaneGeometry(x1 - x0 + 600, z1 - z0 + 600);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: COL.ground, roughness: 1 }));
    m.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    m.receiveShadow = true;
    this.group.add(m);
    this.stats.drawCalls++;
  }

  private addTrees(trees: [number, number, number][]): void {
    if (!trees.length) return;
    const trunk = new THREE.CylinderGeometry(0.16, 0.24, 2.6, 6);
    trunk.translate(0, 1.3, 0);
    const crown = new THREE.IcosahedronGeometry(2.2, 0);
    crown.scale(1, 0.8, 1);
    crown.translate(0, 3.9, 0);
    const tm = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: COL.trunk, roughness: 1 }), trees.length);
    const cm = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), trees.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    trees.forEach(([x, z, h], i) => {
      const s = 0.8 + h * 0.7;
      m.makeRotationY(h * 6.28).scale(new THREE.Vector3(s, s, s)).setPosition(x, 0, z);
      tm.setMatrixAt(i, m);
      cm.setMatrixAt(i, m);
      cm.setColorAt(i, c.copy(COL.crown).lerp(COL.crown2, h));
    });
    for (const im of [tm, cm]) {
      im.castShadow = true;
      im.receiveShadow = true;
      this.group.add(im);
      this.stats.drawCalls++;
    }
  }

  private addTanks(tanks: [number, number, number][]): void {
    if (!tanks.length) return;
    const g = new THREE.CylinderGeometry(0.6, 0.6, 1.1, 10);
    g.translate(0, 0.55, 0);
    const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: COL.tank, roughness: 0.6 }), tanks.length);
    const m = new THREE.Matrix4();
    tanks.forEach(([x, y, z], i) => {
      const h = hash2(x, z);
      im.setMatrixAt(i, m.makeTranslation(x + (h - 0.5) * 3, y, z + (hash2(z, x) - 0.5) * 3));
    });
    im.castShadow = true;
    this.group.add(im);
    this.stats.drawCalls++;
  }
}

/** Walls (with facade attributes) + flat roof for one footprint. */
function addBuilding(m: MeshBuilder, poly: P2[], base: number, h: number, col: THREE.Color, shop: boolean,
                     front: Set<number>, seed: number, sign: number[]): void {
  const top = base + h;
  const n = poly.length;
  let u = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i], c = poly[(i + 1) % n];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len < 1e-3) continue;
    let nx = (c[1] - a[1]) / len, nz = -(c[0] - a[0]) / len;
    const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
    if (pointInPoly(mx + nx * 0.05, mz + nz * 0.05, poly)) {
      nx = -nx;
      nz = -nz;
    }
    const isFront = front.has(i);
    const ex = [shop && isFront ? 1 : 0, 1, seed, isFront ? 1 : 0];
    const p0: [number, number, number] = [a[0], base, a[1]];
    const p1: [number, number, number] = [c[0], base, c[1]];
    const p2: [number, number, number] = [c[0], top, c[1]];
    const p3: [number, number, number] = [a[0], top, a[1]];
    const nn: [number, number, number] = [nx, 0, nz];
    m.tri(p0, p1, p2, nn, col, [u, 0], [u + len, 0], [u + len, h], ex, sign);
    m.tri(p0, p2, p3, nn, col, [u, 0], [u + len, h], [u, h], ex, sign);
    u += len;
  }
  const contour = poly.map(([x, z]) => new THREE.Vector2(x, z));
  const roof = [0, 0, seed, 0];
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) {
    m.tri([poly[i][0], top, poly[i][1]], [poly[j][0], top, poly[j][1]], [poly[k][0], top, poly[k][1]],
      [0, 1, 0], col, [0, 0], [0, 0], [0, 0], roof, sign);
  }
}

function dashes(m: MeshBuilder, pts: P2[], y: number): void {
  const dash = 3, gap = 4;
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-3) continue;
    const dx = (bx - ax) / L, dz = (bz - az) / L;
    const nx = -dz * 0.07, nz = dx * 0.07;
    let s = carry;
    while (s < L) {
      const e = Math.min(s + dash, L);
      m.quadUp([ax + dx * s + nx, y, az + dz * s + nz], [ax + dx * s - nx, y, az + dz * s - nz],
        [ax + dx * e - nx, y, az + dz * e - nz], [ax + dx * e + nx, y, az + dz * e + nz], COL.mark);
      s += dash + gap;
    }
    carry = s - L;
  }
}

/** Calls fn for each run of consecutive segments that falls in the same tile. */
function forEachTilePiece(pts: P2[], fn: (pts: P2[], x: number, z: number) => void): void {
  let cur: P2[] = [pts[0]];
  let key = '';
  let kx = 0, kz = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, mz = (pts[i][1] + pts[i + 1][1]) / 2;
    const k = `${Math.floor(mx / TILE)},${Math.floor(mz / TILE)}`;
    if (key && k !== key) {
      fn(cur, kx, kz);
      cur = [pts[i]];
    }
    key = k;
    kx = mx;
    kz = mz;
    cur.push(pts[i + 1]);
  }
  if (cur.length >= 2) fn(cur, kx, kz);
}

/** Points every `step` meters along a polyline, with the local direction. */
export function walkAlong(pts: P2[], step: number, fn: (x: number, z: number, dx: number, dz: number) => void,
                          offset = step / 2): void {
  let s = offset;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-3) continue;
    const dx = (bx - ax) / L, dz = (bz - az) / L;
    while (s < L) {
      fn(ax + dx * s, az + dz * s, dx, dz);
      s += step;
    }
    s -= L;
  }
}

function scatter(poly: P2[], areaPer: number, out: [number, number, number][], avoid: P2[][] = []): void {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of poly) {
    x0 = Math.min(x0, x);
    z0 = Math.min(z0, z);
    x1 = Math.max(x1, x);
    z1 = Math.max(z1, z);
  }
  let count = Math.floor(Math.abs(signedArea(poly)) / areaPer);
  let tries = count * 4;
  let i = 0;
  while (count > 0 && tries-- > 0) {
    i++;
    const x = x0 + hash2(x0 + i, z0) * (x1 - x0);
    const z = z0 + hash2(z0, x0 + i * 1.7) * (z1 - z0);
    if (pointInPoly(x, z, poly) && !avoid.some((a) => pointInPoly(x, z, a))) {
      out.push([x, z, hash2(x, z)]);
      count--;
    }
  }
}
