import { P2 } from './types';

/** where the game starts: on the way in by the statue, the Shivaji Putla gate ahead (facing south) — plans/05 */
export const SHIVAJI_START: P2 = [-23.6, 15];
/** the statue on its pillar, in the island where the way in splits */
export const STATUE: P2 = [-27.9, 31];

/** no tree here: it would hide the statue (the first thing Ramu sees), or grow through the gate's wall (z ≈ 57), or hide the Nagar Nigam */
export function treeClear(x: number, z: number): boolean {
  return Math.hypot(x - STATUE[0], z - STATUE[1]) > 9 && !(z > 43 && z < 62 && x > -66 && x < -12)
    && !(z > 372 && z < 402 && x > -78 && x < -8);       // nor before the Nagar Nigam's front
}
