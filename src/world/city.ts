import * as THREE from 'three';
import { makeFacadeMaterial } from './facade';
import { makeGroundMaterial, SURF } from './ground';
import { MeshBuilder, offsetLines } from './meshBuilder';
import { waterNormal } from './textures';
import { makeTrees, TreeSpot } from './trees';
import { centroid, DRIVABLE, hash2, MapData, MARKED, P2, pointInPoly, signedArea } from './types';

const TILE = 250;
const VIADUCT_Y = 9.5;

const C = (hex: string) => new THREE.Color(hex);
const COL = {
  ground: C('#a89a7c'),
  asphalt: C('#3b3a39'),
  asphaltLane: C('#4a4b4d'),
  verge: C('#958670'),
  footpath: C('#a39d92'),
  kerb: C('#c9c4b8'),
  mark: C('#e9e6dc'),
  water: C('#3a4a3c'),
  park: C('#5d6d3a'),
  rail: C('#6e665c'),
  concrete: C('#b9b5ac'),
  tank: C('#151515'),
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
    flat: makeGroundMaterial(),
    water: makeWaterMaterial(),
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
          t.surf = sw > 1 ? SURF.paving : SURF.dirt;
          t.ribbon(pts, r.w + sw * 2, y + 0.02, sw > 1 ? COL.footpath : COL.verge);
          t.surf = SURF.asphalt;
          t.ribbon(pts, r.w, y + 0.05, COL.asphalt);
          t.surf = SURF.concrete;
          if (MARKED.has(r.cls)) dashes(t, pts, y + 0.065);
        } else {
          t.surf = SURF.paving;
          t.ribbon(pts, r.w, y + 0.035, COL.footpath);
          t.surf = SURF.concrete;
        }
      });
      if (drivable) {
        for (const end of [r.pts[0], r.pts[r.pts.length - 1]]) {
          const t = tileOf(end[0], end[1]).flat;
          t.surf = SURF.dirt;
          t.disc(end[0], end[1], r.w / 2 + 1.0, 0.021, COL.verge, 12);
          t.surf = SURF.asphalt;
          t.disc(end[0], end[1], r.w / 2, 0.051, COL.asphalt, 12);
          t.surf = SURF.concrete;
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

    const trees: TreeSpot[] = [];
    for (const pk of map.parks) {
      const [x, z] = centroid(pk.pts);
      const f = tileOf(x, z).flat;
      f.surf = SURF.grass;
      f.polygon(pk.pts, 0.03, COL.park);
      f.surf = SURF.concrete;
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
        [sign.r, sign.g, sign.b], map.floor_h, style?.balcony_share ?? 0.3);
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
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, SURF.dirt, 0);
    const n = g.getAttribute('position').count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) =>
      [COL.ground.r, COL.ground.g, COL.ground.b][i % 3]), 3));
    const m = new THREE.Mesh(g, this.mats.flat);
    m.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    m.receiveShadow = true;
    this.group.add(m);
    this.stats.drawCalls++;
  }

  private addTrees(trees: TreeSpot[]): void {
    for (const im of makeTrees(trees)) {
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

/**
 * Walls (with facade attributes), flat roof, roof parapet and chajja sunshades for one footprint.
 * facade.y: 1 = wall with windows, 2 = plain trim (parapet, ledges), 0 = roof.
 */
function addBuilding(m: MeshBuilder, poly: P2[], base: number, h: number, col: THREE.Color, shop: boolean,
                     front: Set<number>, seed: number, sign: number[], floorH: number, balconyShare: number): void {
  const top = base + h;
  const n = poly.length;
  const area = Math.abs(signedArea(poly));
  const floors = Math.max(1, Math.round(h / floorH));
  const parapet = area > 20 ? 0.9 + (seed > 0.7 ? 0.3 : 0) : 0;
  const trimCol = col.clone().lerp(WHITE_C, 0.12);
  const bay = 3.0 + (Math.floor(seed * 1000) % 2) * 0.6;   // window bay width, read by the facade shader
  const H = (k: number) => hash2(seed * 977 + k, k * 3.7 + seed);
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
    const isShop = shop && isFront;
    const ex = [isShop ? 1 : 0, 1, seed, isFront ? 1 : 0];
    const trim = [0, 2, seed, 0];
    const nn: [number, number, number] = [nx, 0, nz];
    const dx = (c[0] - a[0]) / len, dz = (c[1] - a[1]) / len;

    // --- balcony run (stacked over the floors) decided first: the shader opens door-windows for it
    const cells0 = Math.ceil((u + 0.3) / bay), cells1 = Math.floor((u + len - 0.3) / bay); // whole bays on this wall
    const nCells = cells1 - cells0;
    let bk0 = -1, bk = 0;
    if (floors >= 2 && nCells >= 2 && (isFront || H(i + 40) > 0.7) && H(i + 11) < balconyShare) {
      bk = Math.min(nCells, 1 + Math.floor(H(i + 21) * 3));
      bk0 = cells0 + Math.floor(H(i + 31) * (nCells - bk + 1));
    }
    m.fx = [bay, bk0 >= 0 ? bk0 + 1 : 0, bk, 0];
    const quad = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, nrm: V3, e: number[],
                  cc: THREE.Color, uOff = 0) => {
      const L = Math.hypot(x1 - x0, z1 - z0);
      const p0: V3 = [x0, y0, z0], p1: V3 = [x1, y0, z1], p2: V3 = [x1, y1, z1], p3: V3 = [x0, y1, z0];
      const v0 = y0 - base, v1 = y1 - base;
      m.tri(p0, p1, p2, nrm, cc, [u + uOff, v0], [u + uOff + L, v0], [u + uOff + L, v1], e, sign);
      m.tri(p0, p2, p3, nrm, cc, [u + uOff, v0], [u + uOff + L, v1], [u + uOff, v1], e, sign);
    };
    quad(a[0], a[1], c[0], c[1], base, top, nn, ex, col);

    // --- attached details: edge-aligned boxes and panels (s along the wall, d out from it)
    const at = (s: number, d: number, y: number): V3 => [a[0] + dx * s + nx * d, y, a[1] + dz * s + nz * d];
    const panel = (p0: V3, p1: V3, p2: V3, p3: V3, nrm: V3, e: number[], cc: THREE.Color,
                   uv: [number, number][]) => {
      m.tri(p0, p1, p2, nrm, cc, uv[0], uv[1], uv[2], e, sign);
      m.tri(p0, p2, p3, nrm, cc, uv[0], uv[2], uv[3], e, sign);
    };
    const abox = (s0: number, s1: number, y0: number, y1: number, d0: number, d1: number, e: number[], cc: THREE.Color) => {
      const v0 = y0 - base, v1 = y1 - base;
      panel(at(s0, d1, y0), at(s1, d1, y0), at(s1, d1, y1), at(s0, d1, y1), nn, e, cc,
        [[u + s0, v0], [u + s1, v0], [u + s1, v1], [u + s0, v1]]);                              // front
      panel(at(s0, d0, y1), at(s1, d0, y1), at(s1, d1, y1), at(s0, d1, y1), [0, 1, 0], e, cc,
        [[u + s0, v1], [u + s1, v1], [u + s1, v1], [u + s0, v1]]);                              // top
      panel(at(s0, d0, y0), at(s1, d0, y0), at(s1, d1, y0), at(s0, d1, y0), [0, -1, 0], e, cc,
        [[u + s0, v0], [u + s1, v0], [u + s1, v0], [u + s0, v0]]);                              // bottom
      panel(at(s0, d0, y0), at(s0, d1, y0), at(s0, d1, y1), at(s0, d0, y1), [-dx, 0, -dz], e, cc,
        [[u + s0 + d0, v0], [u + s0 + d1, v0], [u + s0 + d1, v1], [u + s0 + d0, v1]]);          // ends
      panel(at(s1, d0, y0), at(s1, d1, y0), at(s1, d1, y1), at(s1, d0, y1), [dx, 0, dz], e, cc,
        [[u + s1 + d0, v0], [u + s1 + d1, v0], [u + s1 + d1, v1], [u + s1 + d0, v1]]);
    };
    // open railing panel visible from both sides (the shader discards the gaps)
    const rail = (p0: V3, p1: V3, p2: V3, p3: V3, nrm: V3, uv: [number, number][]) => {
      const e = [0, 3, seed, 0];
      panel(p0, p1, p2, p3, nrm, e, trimCol, uv);
      panel(p0, p1, p2, p3, [-nrm[0], -nrm[1], -nrm[2]], e, trimCol, uv);
    };
    if (bk0 >= 0) {
      const s0 = bk0 * bay - u, s1 = (bk0 + bk) * bay - u, D = 1.15;
      for (let f = 1; f < floors; f++) {
        const y = base + f * floorH, v0 = y - base, v1 = v0 + 1.05;
        abox(s0, s1, y - 0.14, y, 0, D, trim, trimCol);
        rail(at(s0, D, y), at(s1, D, y), at(s1, D, y + 1.05), at(s0, D, y + 1.05), nn,
          [[u + s0, v0], [u + s1, v0], [u + s1, v1], [u + s0, v1]]);
        for (const [ss, sg] of [[s0, -1], [s1, 1]] as [number, number][]) {
          rail(at(ss, 0, y), at(ss, D, y), at(ss, D, y + 1.05), at(ss, 0, y + 1.05), [sg * dx, 0, sg * dz],
            [[u + ss, v0], [u + ss + D, v0], [u + ss + D, v1], [u + ss, v1]]);
        }
      }
    }
    // split-AC outdoor units hung under the windows
    if (floors >= 2 && len >= bay) {
      for (let k = cells0; k < cells1; k++) {
        if (bk0 >= 0 && k >= bk0 && k < bk0 + bk) continue;
        for (let f = 1; f < floors; f++) {
          if (H(k * 13 + f * 7 + i) > (isFront ? 0.2 : 0.1)) continue;
          const sc = (k + 0.5) * bay - u, y = base + f * floorH + 0.32;
          abox(sc - 0.42, sc + 0.42, y, y + 0.52, 0.02, 0.36, [0, 5, seed, 0], WHITE_C);
        }
      }
    }
    // shop frontage: striped awnings and hanging blade signs, one decision per 7 m of shutters
    if (isShop) {
      for (let seg = Math.floor(u / 7); seg <= Math.floor((u + len) / 7); seg++) {
        const s0 = Math.max(0.3, seg * 7 - u + 0.3), s1 = Math.min(len - 0.3, (seg + 1) * 7 - u - 0.3);
        if (s1 - s0 < 2.5) continue;
        const e = [0, 4, seed, 0], aw = new THREE.Color(sign[0], sign[1], sign[2]);
        if (H(seg * 5 + 3) < 0.45) {
          const yT = base + 2.3, yB = base + 1.95, D = 1.25;
          const slope: V3 = [nx * 0.3, 0.95, nz * 0.3];
          const pts = [at(s0, 0, yT), at(s1, 0, yT), at(s1, D, yB), at(s0, D, yB)];
          const uvs: [number, number][] = [[u + s0, 0], [u + s1, 0], [u + s1, 0], [u + s0, 0]];
          panel(pts[0], pts[1], pts[2], pts[3], slope, e, aw, uvs);
          panel(pts[0], pts[1], pts[2], pts[3], [-slope[0], -slope[1], -slope[2]], e, aw, uvs);
          panel(at(s0, D, yB - 0.22), at(s1, D, yB - 0.22), at(s1, D, yB), at(s0, D, yB), nn, e, aw,
            [[u + s0, 0], [u + s1, 0], [u + s1, 0], [u + s0, 0]]);
        }
        if (H(seg * 5 + 4) < 0.35) {
          const sb = s1 - 0.3;
          abox(sb - 0.05, sb + 0.05, base + 3.4, base + 4.7, 0.12, 1.0, [0, 6, seed, 0], aw);
        }
      }
    }

    if (parapet) {
      const ix = -nx * 0.2, iz = -nz * 0.2, py = top + parapet;
      quad(a[0], a[1], c[0], c[1], top, py, nn, trim, col);                                   // outside
      quad(a[0] + ix, a[1] + iz, c[0] + ix, c[1] + iz, top, py, [-nx, 0, -nz], trim, trimCol); // inside
      m.tri([a[0], py, a[1]], [c[0], py, c[1]], [c[0] + ix, py, c[1] + iz], [0, 1, 0], trimCol,
        [u, h + parapet], [u + len, h + parapet], [u + len, h + parapet], trim, sign);
      m.tri([a[0], py, a[1]], [c[0] + ix, py, c[1] + iz], [a[0] + ix, py, a[1] + iz], [0, 1, 0], trimCol,
        [u, h + parapet], [u + len, h + parapet], [u, h + parapet], trim, sign);
    }

    // Chajja: concrete sunshade over each floor's windows; a deep awning slab over shop shutters.
    if (len >= 2.0) {
      for (let f = 0; f < floors; f++) {
        const shopRow = isShop && f === 0;
        const y = base + f * floorH + (shopRow ? 0.98 : 0.8) * floorH;
        if (y > top - 0.15) continue;
        const d = shopRow ? 0.9 : 0.45, th = shopRow ? 0.14 : 0.1;
        const ox = nx * d, oz = nz * d;
        const A: P2 = [a[0] + ox, a[1] + oz], B: P2 = [c[0] + ox, c[1] + oz];
        quad(A[0], A[1], B[0], B[1], y - th, y, nn, trim, trimCol);                       // front lip
        m.tri([a[0], y, a[1]], [c[0], y, c[1]], [B[0], y, B[1]], [0, 1, 0], trimCol,
          [u, y - base], [u + len, y - base], [u + len, y - base], trim, sign);           // top
        m.tri([a[0], y, a[1]], [B[0], y, B[1]], [A[0], y, A[1]], [0, 1, 0], trimCol,
          [u, y - base], [u + len, y - base], [u, y - base], trim, sign);
        m.tri([a[0], y - th, a[1]], [c[0], y - th, c[1]], [B[0], y - th, B[1]], [0, -1, 0], trimCol,
          [u, 0], [u, 0], [u, 0], trim, sign);                                           // underside
        m.tri([a[0], y - th, a[1]], [B[0], y - th, B[1]], [A[0], y - th, A[1]], [0, -1, 0], trimCol,
          [u, 0], [u, 0], [u, 0], trim, sign);
      }
    }
    u += len;
  }
  // stair headroom (mumty) on larger roofs
  if (area > 45 && seed > 0.3 && floors >= 2) {
    const [cx, cz] = centroid(poly);
    const sx = 2.3, sz = 2.3, mh = 2.5, e = [0, 2, seed, 0];
    const ok = [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([ax, az]) => pointInPoly(cx + ax * sx, cz + az * sz, poly));
    if (ok) {
      const x0 = cx - sx / 2, x1 = cx + sx / 2, z0 = cz - sz / 2, z1 = cz + sz / 2, y1 = top + mh;
      const q = (p: V3[], nrm: V3) => {
        const uv: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
        m.tri(p[0], p[1], p[2], nrm, trimCol, uv[0], uv[1], uv[2], e, sign);
        m.tri(p[0], p[2], p[3], nrm, trimCol, uv[0], uv[2], uv[3], e, sign);
      };
      q([[x0, top, z1], [x1, top, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]);
      q([[x0, top, z0], [x1, top, z0], [x1, y1, z0], [x0, y1, z0]], [0, 0, -1]);
      q([[x1, top, z0], [x1, top, z1], [x1, y1, z1], [x1, y1, z0]], [1, 0, 0]);
      q([[x0, top, z0], [x0, top, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]);
      q([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0]);
    }
  }
  const contour = poly.map(([x, z]) => new THREE.Vector2(x, z));
  const roof = [0, 0, seed, 0];
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) {
    m.tri([poly[i][0], top, poly[i][1]], [poly[j][0], top, poly[j][1]], [poly[k][0], top, poly[k][1]],
      [0, 1, 0], col, [poly[i][0], poly[i][1]], [poly[j][0], poly[j][1]], [poly[k][0], poly[k][1]], roof, sign);
  }
}

type V3 = [number, number, number];
const WHITE_C = new THREE.Color(1, 1, 1);

function makeWaterMaterial(): THREE.MeshStandardMaterial {
  const nm = waterNormal();
  nm.repeat.set(1 / 9, 1 / 9);
  const mat = new THREE.MeshStandardMaterial({
    color: COL.water, roughness: 0.08, metalness: 0.1, normalMap: nm, normalScale: new THREE.Vector2(0.35, 0.35),
  });
  // Planar uv for the normal map (water polygons have no uv): use world xz.
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
vNormalMapUv = (normalMapTransform * vec3((modelMatrix * vec4(position, 1.0)).xz, 1.0)).xy;`);
  };
  return mat;
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
