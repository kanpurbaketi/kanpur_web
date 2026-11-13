/*
 Where the Moti Jheel mela stands (the open ground in Tulsi Upvan, east of the metro) and how it is laid out.
 The layout follows assets/mela/mela_map.png: the map's boundary rectangle is the cloth wall, and every box and circle on it
 is converted here from map pixels to metres (map coordinates: x east, z south). 1 map pixel = K metres.
*/

const K = 119 / 1558;                                   // the wall is 119 m wide on the map (1558 px)
export const mx = (px: number): number => -9.5 + (px - 91) * K;
export const mz = (py: number): number => 127 + (py - 62) * K;

export interface Rect { x0: number; x1: number; z0: number; z1: number }
const rect = (a: number, b: number, c: number, d: number): Rect => ({ x0: mx(a), x1: mx(c), z0: mz(b), z1: mz(d) });
const circle = (px: number, py: number, rpx: number) => ({ x: mx(px), z: mz(py), r: rpx * K });

/** the trodden ground inside the cloth wall */
export const MELA = { x0: -8, x1: 108, z0: 128.5, z1: 202, cx: 50, gateZ: 203.5 };

export function inMela(x: number, z: number, margin = 0): boolean {
  return x > MELA.x0 - margin && x < MELA.x1 + margin && z > MELA.z0 - margin && z < MELA.z1 + margin;
}

/** The torn place in the boundary cloth, west side, level with the stage entry. */
export const TEAR = { x: -9.5, z: mz(620) };
/** The mela gate, in the middle of the south wall (a real opening, `half` metres each side of x). */
export const GATE = { x: mx(895), z: 203.5, half: 4.2 };

/** Outline of the boundary cloth (clockwise from the north-west corner). */
export const WALL_LOOP: [number, number][] = [[-9.5, 127], [109.5, 127], [109.5, 203.5], [-9.5, 203.5]];

// ---- the layout on the map ---------------------------------------------------------------------------
/** kavi sammelan stage: its front faces east, towards the audience */
export const STAGE = rect(144, 417, 302, 642);
export const STAGE_STAIRS = rect(210, 365, 276, 417);     // on the stage's north side
export const STAGE_ENTRY = rect(144, 562, 170, 642);      // back-stage door, next to the torn place in the wall
export const AUDIENCE = rect(355, 384, 553, 675);         // people sitting, clapping

export const WHEEL = circle(926, 329, 122);
export const INFLATABLE = circle(1232, 272, 59.5);
export const KUAN = circle(1437, 800, 145);               // maut ka kuan; its stair runs north
export const KUAN_STAIRS = rect(1371, 602, 1530, 681);

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
