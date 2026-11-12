/** Where the Moti Jheel mela stands: the open ground in Tulsi Upvan, east of the metro. Metres, map coordinates. */
export const MELA = { x0: -8, x1: 108, z0: 112, z1: 222, cx: 50, gateZ: 218 };

export function inMela(x: number, z: number, margin = 0): boolean {
  return x > MELA.x0 - margin && x < MELA.x1 + margin && z > MELA.z0 - margin && z < MELA.z1 + margin;
}

/** The torn place in the boundary cloth: the only way in. West side of the mela, Ramu arrives from the open park. */
export const TEAR = { x: -9.5, z: 150 };

/** Outline of the boundary cloth (clockwise from the north-west corner), a little outside the trodden ground. */
export const WALL_LOOP: [number, number][] = [[-9.5, 111], [109.5, 111], [109.5, 219.5], [2.5, 219.5], [-9.5, 211]];
