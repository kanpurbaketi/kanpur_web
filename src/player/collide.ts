import { MapData, P2 } from '../world/types';

interface Seg {
  ax: number; az: number; bx: number; bz: number; h: number; cam: boolean;
}

const CELL = 8;

/** 2D collision world: building walls and water edges as segments on a spatial hash. */
export class CollisionWorld {
  private cells = new Map<number, Seg[]>();

  constructor(map: MapData) {
    for (const b of map.buildings) this.addRing(b.pts, b.base + b.h);
    for (const w of map.water) this.addRing(w.pts, 0.6); // can't walk into the lake
  }

  /** Square post (pillar, pole, tree trunk) of half-size r. */
  addPost(x: number, z: number, r: number, h = 10): void {
    this.addRing([[x - r, z - r], [x + r, z - r], [x + r, z + r], [x - r, z + r]], h, r > 0.5);
  }

  private key(cx: number, cz: number): number {
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  private addRing(pts: P2[], h: number, cam = true): void {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const s: Seg = { ax: a[0], az: a[1], bx: b[0], bz: b[1], h, cam };
      const x0 = Math.floor(Math.min(a[0], b[0]) / CELL), x1 = Math.floor(Math.max(a[0], b[0]) / CELL);
      const z0 = Math.floor(Math.min(a[1], b[1]) / CELL), z1 = Math.floor(Math.max(a[1], b[1]) / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const k = this.key(cx, cz);
        let l = this.cells.get(k);
        if (!l) this.cells.set(k, (l = []));
        l.push(s);
      }
    }
  }

  private near(x0: number, z0: number, x1: number, z1: number): Set<Seg> {
    const out = new Set<Seg>();
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const l = this.cells.get(this.key(cx, cz));
        if (l) for (const s of l) out.add(s);
      }
    return out;
  }

  /** Push a circle (x, z, r) at foot height y out of walls. Returns corrected position. */
  resolve(x: number, z: number, r: number, y: number): [number, number] {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const s of this.near(x - r, z - r, x + r, z + r)) {
        if (y >= s.h - 0.1) continue; // standing above it (e.g. on a roof)
        const dx = s.bx - s.ax, dz = s.bz - s.az;
        const l2 = dx * dx + dz * dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2));
        const px = s.ax + dx * t, pz = s.az + dz * t;
        const ox = x - px, oz = z - pz;
        const d = Math.hypot(ox, oz);
        if (d < r && d > 1e-6) {
          x = px + (ox / d) * r;
          z = pz + (oz / d) * r;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return [x, z];
  }

  /**
   * Fraction (0..1) along the segment from (x0,y0,z0) to (x1,y1,z1) where it first hits a wall,
   * or 1 if clear. Used to pull the camera in front of buildings.
   */
  raycast(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number {
    let best = 1;
    const rx = x1 - x0, rz = z1 - z0;
    for (const s of this.near(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1))) {
      if (!s.cam) continue; // thin posts don't block the camera
      const sx = s.bx - s.ax, sz = s.bz - s.az;
      const den = rx * sz - rz * sx;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((s.ax - x0) * sz - (s.az - z0) * sx) / den;
      const u = ((s.ax - x0) * rz - (s.az - z0) * rx) / den;
      if (t < 0 || t > best || u < 0 || u > 1) continue;
      if (y0 + (y1 - y0) * t < s.h) best = t;
    }
    return best;
  }
}
