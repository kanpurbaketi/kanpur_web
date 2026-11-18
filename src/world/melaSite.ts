/*
 Where the Moti Jheel mela stands (the open ground in Tulsi Upvan, east of the metro) and how it is laid out.
 The layout follows assets/mela/mela_map.png: the map's boundary rectangle is the cloth wall, and every box and circle on it
 is converted here from map pixels to metres (map coordinates: x east, z south). 1 map pixel = K metres.
*/

const K = 119 / 1558;                                   // the wall is 119 m wide on the map (1558 px)
/**
 * Where the ground is: the real numaish ground, south of Japani Garden, on the right of the park road once it turns west at
 * the Nagar Nigam (plans/05-stage1-route.md). The layout was first drawn for Tulsi Upvan, so it is that layout moved by
 * (DX, DZ): its gate in the south wall faces the road.
 */
export const DX = -203, DZ = 115.5;
export const mx = (px: number): number => DX - 9.5 + (px - 91) * K;
export const mz = (py: number): number => DZ + 127 + (py - 62) * K;

export interface Rect { x0: number; x1: number; z0: number; z1: number }
const rect = (a: number, b: number, c: number, d: number): Rect => ({ x0: mx(a), x1: mx(c), z0: mz(b), z1: mz(d) });
const circle = (px: number, py: number, rpx: number) => ({ x: mx(px), z: mz(py), r: rpx * K });

/** the trodden ground inside the cloth wall */
export const MELA = { x0: DX - 8, x1: DX + 108, z0: DZ + 128.5, z1: DZ + 202, cx: DX + 50, cz: DZ + 165, gateZ: DZ + 203.5 };

export function inMela(x: number, z: number, margin = 0): boolean {
  return x > MELA.x0 - margin && x < MELA.x1 + margin && z > MELA.z0 - margin && z < MELA.z1 + margin;
}

/**
 * The map has a park path running across this ground. Cut every road off just outside the cloth wall: left in, its asphalt
 * lay in the same plane as the mela's dirt (flickering dark patches across the aisles) and led passers-by through the cloth.
 */
export function clipRoadsToMela<T extends { pts: [number, number][] }>(roads: T[]): T[] {
  const inside = (p: [number, number]) => inMela(p[0], p[1], 3);
  const out: T[] = [];
  for (const r of roads) {
    if (!r.pts.some(inside)) { out.push(r); continue; }
    let run: [number, number][] = [];
    const flush = () => { if (run.length > 1) out.push({ ...r, pts: run }); run = []; };
    for (let i = 0; i < r.pts.length; i++) {
      const p = r.pts[i];
      if (i && inside(r.pts[i - 1]) !== inside(p)) {
        // where this stretch crosses the line: close in on it from both sides, keep the point on the outside
        let a = r.pts[i - 1], b = p;
        for (let k = 0; k < 16; k++) {
          const m: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          if (inside(m) === inside(a)) a = m; else b = m;
        }
        run.push(inside(a) ? b : a);
        if (inside(p)) flush();
      }
      if (!inside(p)) run.push(p);
    }
    flush();
  }
  return out;
}

/** The torn place in the boundary cloth, west side, level with the stage entry. */
export const TEAR = { x: DX - 9.5, z: mz(620) };
/** The mela gate, in the middle of the south wall (a real opening, `half` metres each side of x). */
export const GATE = { x: mx(895), z: DZ + 203.5, half: 4.2 };

/** Outline of the boundary cloth (clockwise from the north-west corner). */
export const WALL_LOOP: [number, number][] = [[DX - 9.5, DZ + 127], [DX + 109.5, DZ + 127], [DX + 109.5, DZ + 203.5], [DX - 9.5, DZ + 203.5]];

// ---- the layout on the map ---------------------------------------------------------------------------
/** kavi sammelan stage: its front faces east, towards the audience */
export const STAGE = rect(144, 417, 302, 642);
export const STAGE_STAIRS = rect(210, 365, 276, 417);     // on the stage's north side
export const STAGE_ENTRY = rect(144, 562, 170, 642);      // back-stage door, next to the torn place in the wall
export const AUDIENCE = rect(355, 384, 553, 675);         // people sitting, clapping

export const WHEEL = circle(926, 329, 122);
export const INFLATABLE = circle(1232, 272, 59.5);
/** maut ka kuan: far bigger than the map drew it, so it has the whole south-east corner (the radius takes in the round stair) */
export const KUAN = { x: DX + 90.5, z: DZ + 184.5, r: 16.5 };

/** each box on the map is a block of stalls (a row, or two rows back to back) */
export const STALL_BLOCKS: Rect[] = [
  rect(592, 167, 751, 245), rect(847, 167, 1005, 245),
  rect(1318, 404, 1398, 562), rect(1516, 404, 1596, 562),
  rect(790, 483, 870, 642), rect(988, 483, 1068, 642), rect(1120, 483, 1279, 562),
  rect(579, 668, 738, 747), rect(777, 668, 870, 747), rect(988, 668, 1147, 747),
  rect(579, 853, 738, 932), rect(962, 853, 1121, 932),
];

/** the older rides, kept, in the free ground of the map */
export const CAROUSEL = { x: mx(250), z: mz(820) };
export const HINDOLA = { x: mx(430), z: mz(930) };
export const COLUMBUS = { x: mx(400), z: mz(200) };
export const CHAIR_SWING = { x: mx(1480), z: mz(220) };
