import * as THREE from 'three';
import { walkAlong } from '../city';
import { MeshBuilder, offsetLines } from '../meshBuilder';
import { MapData, P2, signedArea } from '../types';

const C = (h: string) => new THREE.Color(h);
const VIADUCT_Y = 9.5;

/** Hand-built landmarks placed from real coordinates. */
export class Landmarks {
  readonly group = new THREE.Group();
  readonly posts: [number, number, number][] = []; // collision posts [x, z, halfSize]
  readonly walls: P2[][] = [];                      // collision rings (station stair blocks etc.)

  constructor(map: MapData) {
    const mb = new MeshBuilder();
    for (const w of map.water) if (w.name === 'Moti Jheel') this.lake(mb, w.pts);
    for (const p of map.parks) this.parkEdge(mb, p.pts, p.kind);
    const st = map.pois.find((p) => p.kind === 'stop' && p.name === 'Moti Jheel');
    if (st) this.metroStation(mb, map, st.p, st.name, st.name_hi);
    const mesh = new THREE.Mesh(mb.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /** Moti Jheel: stone ghat-style embankment, railing and promenade around the water. */
  private lake(mb: MeshBuilder, pts: P2[]): void {
    const ring = closed(pts);
    const outward = signedArea(pts) > 0 ? 1 : 0; // which offset side is outside the water
    const sides = offsetLines(ring, 1.0);
    const edge = sides[outward];
    mb.slab(edge, 2.0, -0.4, 0.45, C('#b7a58a'));                 // sandstone embankment
    const prom = offsetLines(ring, 4.5)[outward];
    mb.ribbon(prom, 5.0, 0.06, C('#c9b9a0'));                      // promenade path
    const rail = offsetLines(ring, 2.0)[outward];
    walkAlong(rail, 2.5, (x, z) => mb.box(x, 0.45, z, 0.12, 0.9, 0.12, C('#2f4f3a')));
    mb.slab(rail, 0.08, 1.25, 1.35, C('#2f4f3a'));                // top rail
    walkAlong(offsetLines(ring, 7.5)[outward], 22, (x, z) => {
      // benches and lamp posts along the promenade
      mb.box(x, 0, z, 0.15, 4.5, 0.15, C('#3a3a3a'));
      mb.box(x, 4.5, z, 0.45, 0.3, 0.45, C('#f1ead2'));
      mb.box(x + 1.4, 0.4, z, 1.8, 0.1, 0.5, C('#8a6a4a'));
    }, 5);
  }

  /** Low boundary wall with a grille on top, and a gap for the gate. */
  private parkEdge(mb: MeshBuilder, pts: P2[], kind: string): void {
    if (!['park', 'garden'].includes(kind)) return;
    const ring = closed(pts);
    let total = 0;
    for (let i = 0; i < ring.length - 1; i++) total += Math.hypot(ring[i + 1][0] - ring[i][0], ring[i + 1][1] - ring[i][1]);
    const gate = total * 0.1;
    let s = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i], b = ring[i + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!(s + L < gate - 4 || s > gate + 4)) {
        s += L;
        continue; // gate opening
      }
      mb.slab([a, b], 0.3, 0, 0.8, C('#d9c9a8'));
      walkAlong([a, b], 0.35, (x, z) => mb.box(x, 0.8, z, 0.04, 0.9, 0.04, C('#2a3a2a')), 0.15);
      s += L;
    }
  }

  /** Elevated station box around the viaduct: concourse, platform canopy, stairs, name boards. */
  private metroStation(mb: MeshBuilder, map: MapData, p: P2, name: string, nameHi: string): void {
    // Station direction from the nearest viaduct segment.
    let best = Infinity, dir: P2 = [1, 0], at: P2 = p;
    for (const r of map.rails) {
      if (!(r.bridge || r.layer > 0 || r.kind === 'subway')) continue;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
        const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / l2));
        const cx = ax + dx * t, cz = az + dz * t;
        const d = Math.hypot(p[0] - cx, p[1] - cz);
        if (d < best) {
          best = d;
          const l = Math.sqrt(l2);
          dir = [dx / l, dz / l];
          at = [cx, cz];
        }
      }
    }
    const HALF = 70, W = 11;
    const a: P2 = [at[0] - dir[0] * HALF, at[1] - dir[1] * HALF];
    const b: P2 = [at[0] + dir[0] * HALF, at[1] + dir[1] * HALF];
    const n: P2 = [-dir[1], dir[0]];
    const line: P2[] = [a, b];
    const concrete = C('#c4bfb5'), cladding = C('#d8d2c4'), roof = C('#7f8a90'), accent = C('#e07b2a');
    // concourse level (below the tracks), walls with a band of windows, platform level, canopy
    mb.slab(line, W * 2, VIADUCT_Y - 4.2, VIADUCT_Y - 1.4, cladding);
    mb.slab(offsetLines(line, W - 0.2)[0], 0.4, VIADUCT_Y - 1.4, VIADUCT_Y + 1.2, cladding);
    mb.slab(offsetLines(line, W - 0.2)[1], 0.4, VIADUCT_Y - 1.4, VIADUCT_Y + 1.2, cladding);
    mb.slab(offsetLines(line, W - 0.25)[0], 0.45, VIADUCT_Y - 3.2, VIADUCT_Y - 2.6, accent);
    mb.slab(offsetLines(line, W - 0.25)[1], 0.45, VIADUCT_Y - 3.2, VIADUCT_Y - 2.6, accent);
    mb.slab(line, W * 2 + 2, VIADUCT_Y + 6.5, VIADUCT_Y + 7.0, roof);
    walkAlong(line, 12, (x, z) => {
      for (const s of [-1, 1]) mb.box(x + n[0] * s * (W - 1), VIADUCT_Y, z + n[1] * s * (W - 1), 0.4, 6.5, 0.4, concrete);
    }, 4);
    // station piers (wider than line piers)
    walkAlong(line, 24, (x, z) => {
      for (const s of [-1, 1]) {
        const px = x + n[0] * s * 7, pz = z + n[1] * s * 7;
        mb.box(px, 0, pz, 1.6, VIADUCT_Y - 4.2, 1.6, concrete);
        this.posts.push([px, pz, 0.8]);
      }
    }, 10);
    // stair / lift blocks down to the footpaths on both sides at each end
    for (const end of [-1, 1]) {
      for (const s of [-1, 1]) {
        const cx = at[0] + dir[0] * end * (HALF - 12) + n[0] * s * (W + 6);
        const cz = at[1] + dir[1] * end * (HALF - 12) + n[1] * s * (W + 6);
        const sl: P2[] = [[cx - dir[0] * 9, cz - dir[1] * 9], [cx + dir[0] * 9, cz + dir[1] * 9]];
        mb.slab(sl, 4, 0, VIADUCT_Y - 4.2, cladding);
        mb.slab(sl, 4.6, VIADUCT_Y - 4.2, VIADUCT_Y - 3.6, roof);
        const [L, R] = offsetLines(sl, 2);
        this.walls.push([L[0], L[1], R[1], R[0]]);
      }
    }
    // name boards on both long sides
    const tex = nameBoard(name, nameHi);
    const boardMat = new THREE.MeshBasicMaterial({ map: tex });
    for (const s of [-1, 1]) {
      const g = new THREE.PlaneGeometry(14, 2.2);
      const m = new THREE.Mesh(g, boardMat);
      m.position.set(at[0] + n[0] * s * (W + 0.05), VIADUCT_Y - 0.2, at[1] + n[1] * s * (W + 0.05));
      m.rotation.y = Math.atan2(n[0] * s, n[1] * s);
      this.group.add(m);
    }
  }
}

function closed(pts: P2[]): P2[] {
  return [...pts, pts[0]];
}

/** Generic bilingual station name board (no operator logo or livery). */
function nameBoard(name: string, hi: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 160;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1f3b57';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 64px system-ui, sans-serif';
  g.fillText(hi || name, c.width * 0.27, 82);
  g.fillText(name.toUpperCase(), c.width * 0.73, 82);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
