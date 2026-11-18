import { P2 } from './types';

/*
 The raised footpaths (streetDetail.ts draws them as 16 cm slabs along roads with sidewalks): where they are, so whoever
 stands or is put on one stands on top of it rather than in it (Ramu through the collision world's floors, the crowd,
 the carts, vehicles driven up onto one).
*/

const CELL = 10;

interface Strip { ax: number; az: number; bx: number; bz: number; l2: number; half: number; h: number }

export class Footpaths {
  private cells = new Map<number, Strip[]>();

  /** a slab of width w and top h along the polyline */
  add(line: P2[], w: number, h: number): void {
    for (let i = 0; i + 1 < line.length; i++) {
      const [ax, az] = line[i], [bx, bz] = line[i + 1];
      const l2 = (bx - ax) ** 2 + (bz - az) ** 2;
      if (l2 < 1e-6) continue;
      const s: Strip = { ax, az, bx, bz, l2, half: w / 2, h };
      const m = w / 2;
      for (let cx = Math.floor((Math.min(ax, bx) - m) / CELL); cx <= Math.floor((Math.max(ax, bx) + m) / CELL); cx++)
        for (let cz = Math.floor((Math.min(az, bz) - m) / CELL); cz <= Math.floor((Math.max(az, bz) + m) / CELL); cz++) {
          const k = (cx + 4096) * 8192 + (cz + 4096);
          let l = this.cells.get(k);
          if (!l) this.cells.set(k, (l = []));
          l.push(s);
        }
    }
  }

  /** the footpath's top at (x, z), 0 off them */
  at(x: number, z: number): number {
    const l = this.cells.get((Math.floor(x / CELL) + 4096) * 8192 + (Math.floor(z / CELL) + 4096));
    if (!l) return 0;
    let best = 0;
    for (const s of l) {
      if (s.h <= best) continue;
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const t = ((x - s.ax) * dx + (z - s.az) * dz) / s.l2;
      if (t < -0.02 || t > 1.02) continue;
      const px = s.ax + dx * t - x, pz = s.az + dz * t - z;
      if (px * px + pz * pz <= s.half * s.half) best = s.h;
    }
    return best;
  }

  /** the top under a footprint (half-sizes along and across, turned by heading): the average of its corners and middle */
  under(x: number, z: number, heading: number, hl: number, hw: number): number {
    const s = Math.sin(heading), c = Math.cos(heading);
    let sum = this.at(x, z);
    for (const [a, b] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw]]) sum += this.at(x + s * a + c * b, z + c * a - s * b);
    return sum / 5;
  }
}

/** the city's footpaths (filled by StreetDetail) */
export const FOOTPATHS = new Footpaths();
