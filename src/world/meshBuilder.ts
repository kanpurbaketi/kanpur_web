import * as THREE from 'three';

type V3 = [number, number, number];

/** Triangle accumulator: positions, normals, colors, uv, plus optional extra vec4 attribute. */
export class MeshBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  extra: number[] = []; // vec4 per vertex (facade data), only used when withExtra
  extra2: number[] = []; // vec3 per vertex (sign colour)
  extra3: number[] = []; // vec4 per vertex (facade layout: window bay, balcony run), set through `fx`
  /** facade layout written with every vertex: [bay width m, balcony first cell + 1 (0 = none), balcony cells, 0] */
  fx: number[] = [0, 0, 0, 0];

  /** surface id written to uv.x when a call passes no uv (see ground.ts SURF) */
  surf = 0;

  constructor(private withExtra = false) {}

  get empty(): boolean {
    return this.pos.length === 0;
  }

  /** Add a triangle, flipping winding so its face points along n. */
  tri(a: V3, b: V3, c: V3, n: V3, color: THREE.Color = WHITE, ua: number[] = Z2, ub = Z2, uc = Z2,
      ex: number[] = Z4, ex2: number[] = Z3): void {
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
    const cx = aby * acz - abz * acy, cy = abz * acx - abx * acz, cz = abx * acy - aby * acx;
    if (ua === Z2) ua = ub = uc = [this.surf, 0];
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) {
      [b, c] = [c, b];
      [ub, uc] = [uc, ub];
    }
    for (const [v, u] of [[a, ua], [b, ub], [c, uc]] as [V3, number[]][]) {
      this.pos.push(v[0], v[1], v[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(color.r, color.g, color.b);
      this.uv.push(u[0], u[1]);
      if (this.withExtra) {
        this.extra.push(ex[0], ex[1], ex[2], ex[3]);
        this.extra2.push(ex2[0], ex2[1], ex2[2]);
        this.extra3.push(this.fx[0], this.fx[1], this.fx[2], this.fx[3]);
      }
    }
  }

  quadUp(a: V3, b: V3, c: V3, d: V3, color: THREE.Color = WHITE): void {
    this.tri(a, b, c, UP, color);
    this.tri(a, c, d, UP, color);
  }

  /** Flat horizontal polygon (with optional holes) at height y. */
  polygon(poly: [number, number][], y: number, color: THREE.Color = WHITE): void {
    const contour = poly.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const [i, j, k] of tris) {
      this.tri([poly[i][0], y, poly[i][1]], [poly[j][0], y, poly[j][1]], [poly[k][0], y, poly[k][1]], UP, color);
    }
  }

  /** Mitered ribbon along a polyline at height y. */
  ribbon(pts: [number, number][], width: number, y: number, color: THREE.Color = WHITE): void {
    if (width <= 0 || pts.length < 2) return;
    const [L, R] = offsetLines(pts, width / 2);
    const s = this.surf, l = [s, -1], r = [s, 1]; // uv.y: -1 left edge .. +1 right edge
    for (let i = 0; i < pts.length - 1; i++) {
      const a: V3 = [L[i][0], y, L[i][1]], b: V3 = [R[i][0], y, R[i][1]];
      const c: V3 = [R[i + 1][0], y, R[i + 1][1]], d: V3 = [L[i + 1][0], y, L[i + 1][1]];
      this.tri(a, b, c, UP, color, l, r, r);
      this.tri(a, c, d, UP, color, l, r, l);
    }
  }

  /** Raised ribbon (top + both sides) — kerbs, dividers, viaduct decks. */
  slab(pts: [number, number][], width: number, y0: number, y1: number, color: THREE.Color = WHITE): void {
    if (width <= 0 || pts.length < 2) return;
    const [L, R] = offsetLines(pts, width / 2);
    for (let i = 0; i < pts.length - 1; i++) {
      this.quadUp([L[i][0], y1, L[i][1]], [R[i][0], y1, R[i][1]], [R[i + 1][0], y1, R[i + 1][1]],
        [L[i + 1][0], y1, L[i + 1][1]], color);
      for (const S of [L, R]) {
        const a = S[i], b = S[i + 1];
        const mx = (a[0] + b[0]) / 2 - pts[i][0] / 2 - pts[i + 1][0] / 2;
        const mz = (a[1] + b[1]) / 2 - pts[i][1] / 2 - pts[i + 1][1] / 2;
        const len = Math.hypot(mx, mz) || 1;
        const n: V3 = [mx / len, 0, mz / len];
        this.tri([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], n, color);
        this.tri([a[0], y0, a[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], n, color);
      }
    }
  }

  disc(x: number, z: number, r: number, y: number, color: THREE.Color = WHITE, seg = 10): void {
    for (let i = 0; i < seg; i++) {
      const a0 = (Math.PI * 2 * i) / seg, a1 = (Math.PI * 2 * (i + 1)) / seg;
      this.tri([x, y, z], [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r],
        [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], UP, color);
    }
  }

  /** Axis-aligned box (for pillars, tanks etc.). */
  box(cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, color: THREE.Color = WHITE): void {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, z0 = cz - sz / 2, z1 = cz + sz / 2, y1 = y0 + sy;
    const q = (a: V3, b: V3, c: V3, d: V3, n: V3) => {
      this.tri(a, b, c, n, color);
      this.tri(a, c, d, n, color);
    };
    q([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0]);
    q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
    q([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1]);
    q([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0]);
    q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.withExtra) {
      g.setAttribute('facade', new THREE.Float32BufferAttribute(this.extra, 4));
      g.setAttribute('signColor', new THREE.Float32BufferAttribute(this.extra2, 3));
      g.setAttribute('fx', new THREE.Float32BufferAttribute(this.extra3, 4));
    }
    g.computeBoundingSphere();
    return g;
  }
}

const WHITE = new THREE.Color(1, 1, 1);
const UP: V3 = [0, 1, 0];
const Z2 = [0, 0];
const Z3 = [0, 0, 0];
const Z4 = [0, 0, 0, 0];

/** Left/right offset polylines with clamped miters. */
export function offsetLines(pts: [number, number][], hw: number): [[number, number][], [number, number][]] {
  const L: [number, number][] = [];
  const R: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    let dix = 0, diz = 0, dox = 0, doz = 0;
    if (i > 0) {
      const dx = pts[i][0] - pts[i - 1][0], dz = pts[i][1] - pts[i - 1][1];
      const l = Math.hypot(dx, dz) || 1;
      dix = dx / l;
      diz = dz / l;
    }
    if (i < pts.length - 1) {
      const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1];
      const l = Math.hypot(dx, dz) || 1;
      dox = dx / l;
      doz = dz / l;
    }
    let tx = dix + dox, tz = diz + doz;
    let tl = Math.hypot(tx, tz);
    if (tl < 1e-6) {
      tx = dox || dix;
      tz = doz || diz;
      tl = Math.hypot(tx, tz) || 1;
    }
    tx /= tl;
    tz /= tl;
    const nx = -tz, nz = tx;
    const rx = dox || dix, rz = doz || diz;
    const dot = nx * -rz + nz * rx;
    const m = Math.abs(dot) > 0.3 ? Math.min(hw / dot, hw * 2.5) : hw;
    L.push([pts[i][0] + nx * m, pts[i][1] + nz * m]);
    R.push([pts[i][0] - nx * m, pts[i][1] - nz * m]);
  }
  return [L, R];
}
