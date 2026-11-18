import * as THREE from 'three';
import { Geo, litMat, rnd } from './geo';
import { walkAlong } from './city';
import { offsetLines } from './meshBuilder';
import { P2 } from './types';

/*
 The road isn't clean (stage 1, as in the video): potholes (some holding water), patched asphalt, mud, litter thickest
 along the kerbs and on the footpaths, and heaps of garbage against the walls. Flat decals, instanced per kind (one draw
 call each), plus the heaps merged into one mesh. Everything is seeded: the same dirt in the same places every time.
*/

const ROAD_Y = 0.07;          // just above the asphalt (0.05) and its dashes (0.065)
const WALK_Y = 0.175;         // just above the raised footpath (0.16)

type Decal = 'pothole' | 'puddle' | 'patch' | 'mud' | 'litter';

/** where to put the dirt: the road's centre line, its width, the footpaths' width; `keep`: false where nothing goes (gates, the mela's front) */
export interface DirtOpts { line: P2[]; roadW: number; walkW: number; keep: (x: number, z: number) => boolean }

export class RoadDirt {
  readonly group = new THREE.Group();

  constructor(o: DirtOpts) {
    if (o.line.length < 2) return;
    const spots: Record<Decal, [number, number, number, number, number][]> = { pothole: [], puddle: [], patch: [], mud: [], litter: [] };   // x, y, z, size, turn
    let seed = 17;
    const r = () => rnd(seed++ * 0.731);
    const hw = o.roadW / 2;
    // potholes, patches, puddles and mud on the carriageway: most near the edges, where the water stands
    walkAlong(o.line, 7, (x, z, dx, dz) => {
      const nx = -dz, nz = dx;
      for (let k = 0; k < 2; k++) {
        const kind: Decal = r() < 0.42 ? 'pothole' : r() < 0.3 ? 'puddle' : r() < 0.55 ? 'patch' : 'mud';
        const edge = r() < 0.65;
        const off = (r() < 0.5 ? -1 : 1) * (edge ? hw - 0.5 - r() * 1.6 : r() * (hw - 1.5));
        const along = (r() - 0.5) * 7;
        const px = x + nx * off + dx * along, pz = z + nz * off + dz * along;
        if (!o.keep(px, pz)) continue;
        const size = kind === 'patch' ? 1.2 + r() * 2.2 : kind === 'mud' ? 1.5 + r() * 2.5 : kind === 'puddle' ? 1.2 + r() * 1.6 : 0.8 + r() * 1.2;
        spots[kind].push([px, ROAD_Y + k * 0.002, pz, size, r() * Math.PI * 2]);
      }
    }, 3);
    // litter: thick in the gutter along both kerbs, scattered on the footpaths and here and there on the road
    for (const [off, y, step, spread] of [[hw - 0.35, ROAD_Y + 0.004, 2.2, 0.5], [hw + o.walkW * 0.55, WALK_Y, 3.0, o.walkW * 0.4], [hw * 0.4, ROAD_Y + 0.004, 9, hw * 0.4]] as const) {
      for (const side of offsetLines(o.line, off)) {
        walkAlong(side, step, (x, z, dx, dz) => {
          if (r() < 0.25) return;
          const s = (r() - 0.5) * 2 * spread, px = x - dz * s, pz = z + dx * s;
          if (o.keep(px, pz)) spots.litter.push([px, y, pz, 0.9 + r() * 1.3, r() * Math.PI * 2]);
        }, r() * step);
      }
    }
    const tex = atlas();
    (Object.keys(spots) as Decal[]).forEach((kind, ti) => {
      const list = spots[kind];
      if (!list.length) return;
      const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) + ti) / TILES);
      const mat = new THREE.MeshStandardMaterial({
        map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        roughness: kind === 'litter' ? 0.75 : 0.95, metalness: 0,     // all matte: no lamps mirrored in the road
      });
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      list.forEach(([x, y, z, s, a], i) => {
        const sq = kind === 'patch' ? 0.6 + 0.4 * ((i * 37) % 10) / 10 : 1;
        im.setMatrixAt(i, m.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, a), new THREE.Vector3(s, 1, s * sq)));
      });
      im.receiveShadow = true;
      im.renderOrder = 1;
      im.userData.noAO = true;
      im.computeBoundingSphere();
      this.group.add(im);
    });
    // garbage heaps against the walls, past the footpaths
    const heaps = new Geo();
    for (const side of offsetLines(o.line, hw + o.walkW + 0.9)) {
      walkAlong(side, 46, (x, z) => {
        if (!o.keep(x, z) || r() < 0.3) return;
        heap(heaps, x + (r() - 0.5) * 3, z + (r() - 0.5) * 3, 0.9 + r() * 0.9, r);
      }, 10 + r() * 30);
    }
    const hm = new THREE.Mesh(heaps.build(), litMat({ roughness: 0.9, metalness: 0 }));
    hm.castShadow = hm.receiveShadow = true;
    this.group.add(hm);
  }
}

/** a heap: a low mound of dirt and rot, bags and bottles and paper on it */
function heap(g: Geo, x: number, z: number, R: number, r: () => number): void {
  g.add(new THREE.SphereGeometry(R, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.38, 0.8).rotateY(r() * 3), '#4a3e30',
    new THREE.Matrix4().makeTranslation(x, 0, z));
  // dull, dirty colours: grubby white and black bags, cardboard, faded blue and green plastic, the odd red
  const BAG = ['#a9a397', '#1e1d1b', '#4a6585', '#8f897d', '#8a6d48', '#55704a', '#7d3b31', '#b0a68c', '#2c2a27', '#6e6658'];
  for (let i = 0; i < 26 + R * 22; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R * 0.95, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d * 0.8;
    const h = Math.sqrt(Math.max(0, 1 - (d / R) ** 2)) * R * 0.36;
    const s = 0.05 + r() * 0.12, col = BAG[Math.floor(r() * BAG.length)];
    const k = r();
    if (k < 0.45) g.sphere(px, h + s * 0.3, pz, s, col, 1.2, 0.55, 1);                         // a bag, sagging
    else if (k < 0.8) g.box(px, h + 0.02, pz, s * 2.4, 0.03, s * 1.8, col, r() * 3);            // paper, cardboard, a flattened box
    else g.add(new THREE.CylinderGeometry(0.035, 0.035, 0.24, 6).rotateZ(Math.PI / 2).rotateY(r() * 3), r() < 0.5 ? '#6f8a7a' : '#8c8578',
      new THREE.Matrix4().makeTranslation(px, h + 0.04, pz));                                   // a bottle
  }
  // the spill round it
  for (let i = 0; i < 14; i++) {
    const a = r() * Math.PI * 2, d = R * (0.95 + r() * 0.6);
    g.box(x + Math.cos(a) * d, 0.03, z + Math.sin(a) * d * 0.8, 0.08 + r() * 0.12, 0.02, 0.06 + r() * 0.1, BAG[Math.floor(r() * BAG.length)], r() * 3);
  }
}

const TILES = 5;

/** the five decals side by side: pothole, puddle (a pothole full of water), patch, mud, litter */
function atlas(): THREE.CanvasTexture {
  const S = 256, c = document.createElement('canvas');
  c.width = S * TILES;
  c.height = S;
  const g = c.getContext('2d')!;
  let seed = 5;
  const r = () => rnd(seed++ * 1.913);
  const blob = (cx: number, cy: number, R: number, wob: number) => {
    g.beginPath();
    const n = 22;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2, rr = R * (1 - wob / 2 + wob * r());
      i ? g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.closePath();
  };
  const grit = (x0: number, n: number, cols: string[], R = 110) => {
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R;
      g.fillStyle = cols[Math.floor(r() * cols.length)];
      g.fillRect(x0 + 128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 1 + r() * 3, 1 + r() * 3);
    }
  };
  // 0 pothole: broken edge, a dark hole of loose gravel
  let x0 = 0;
  g.fillStyle = 'rgba(70,66,60,0.85)'; blob(x0 + 128, 128, 112, 0.35); g.fill();
  g.fillStyle = 'rgba(32,29,26,0.97)'; blob(x0 + 128, 128, 92, 0.4); g.fill();
  g.save(); blob(x0 + 128, 128, 90, 0.3); g.clip(); grit(x0, 900, ['#5a534a', '#3d3833', '#7a7166', '#1e1b18'], 95); g.restore();
  // 1 puddle: the same, with brown water in it
  x0 = S;
  g.fillStyle = 'rgba(60,56,50,0.85)'; blob(x0 + 128, 128, 118, 0.3); g.fill();
  g.fillStyle = 'rgba(52,46,38,0.95)'; blob(x0 + 128, 128, 100, 0.35); g.fill();
  g.fillStyle = 'rgba(78,70,58,0.92)'; blob(x0 + 128, 128, 84, 0.25); g.fill();
  // 2 patch: newer, blacker asphalt, square-ish, a seam round it
  x0 = S * 2;
  const rag = () => {
    g.beginPath();
    const pts: [number, number][] = [[24, 30], [232, 24], [236, 226], [20, 232]];
    pts.forEach(([px, py], i) => {
      const [qx, qy] = pts[(i + 1) % 4];
      for (let k = 0; k < 8; k++) {
        const t = k / 8, j = (r() - 0.5) * 14;
        const x = px + (qx - px) * t + (qy - py === 0 ? 0 : j), y = py + (qy - py) * t + (qx - px === 0 ? 0 : j);
        i || k ? g.lineTo(x0 + x, y) : g.moveTo(x0 + x, y);
      }
    });
    g.closePath();
  };
  g.fillStyle = 'rgba(24,24,25,0.85)'; rag(); g.fill();
  g.strokeStyle = 'rgba(12,12,12,0.8)'; g.lineWidth = 5; rag(); g.stroke();
  grit(x0, 500, ['rgba(60,60,62,0.8)', 'rgba(8,8,8,0.8)'], 105);
  // 3 mud: a dried brown smear, fading out
  x0 = S * 3;
  for (let k = 0; k < 6; k++) { g.fillStyle = `rgba(${96 + k * 6},${78 + k * 4},${56},${0.16})`; blob(x0 + 128 + (r() - 0.5) * 40, 128 + (r() - 0.5) * 40, 70 + r() * 40, 0.5); g.fill(); }
  grit(x0, 300, ['rgba(70,55,40,0.5)', 'rgba(140,120,90,0.4)'], 100);
  // 4 litter: paper, wrappers, plastic, cups, leaves
  x0 = S * 4;
  // a dusty haze first, then the rubbish: mostly grubby paper, cardboard and leaves, some faded wrappers
  for (let k = 0; k < 5; k++) { g.fillStyle = 'rgba(110,98,80,0.10)'; blob(x0 + 128 + (r() - 0.5) * 50, 128 + (r() - 0.5) * 50, 70 + r() * 40, 0.5); g.fill(); }
  const COLS = ['#b8b2a4', '#a49c8a', '#9a8f7a', '#8a6d48', '#6b5a40', '#a8443a', '#4c6a92', '#b89a3e', '#9aa0a6', '#4f7a4a', '#2a2826', '#c4bdae'];
  for (let i = 0; i < 40; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 108, px = x0 + 128 + Math.cos(a) * d, py = 128 + Math.sin(a) * d;
    g.save(); g.translate(px, py); g.rotate(r() * 6);
    g.fillStyle = COLS[Math.floor(r() * COLS.length)];
    const k = r();
    if (k < 0.45) g.fillRect(-4 - r() * 6, -3 - r() * 5, 8 + r() * 12, 6 + r() * 10);                    // paper, wrappers
    else if (k < 0.7) { g.beginPath(); g.ellipse(0, 0, 4 + r() * 6, 3 + r() * 4, 0, 0, Math.PI * 2); g.fill(); }   // bags, cups
    else if (k < 0.85) { g.fillRect(-9, -2, 18, 4); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(-9, 1, 18, 1); }  // a bottle, flat
    else { g.fillStyle = r() < 0.5 ? '#7a6230' : '#5d7a2a'; g.beginPath(); g.ellipse(0, 0, 5, 2.5, 0, 0, Math.PI * 2); g.fill(); }   // leaves
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
