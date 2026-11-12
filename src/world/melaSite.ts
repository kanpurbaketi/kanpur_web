/** Where the Moti Jheel mela stands: the open ground in Tulsi Upvan, east of the metro. Metres, map coordinates. */
export const MELA = { x0: -8, x1: 108, z0: 112, z1: 222, cx: 50, gateZ: 218 };

export function inMela(x: number, z: number, margin = 0): boolean {
  return x > MELA.x0 - margin && x < MELA.x1 + margin && z > MELA.z0 - margin && z < MELA.z1 + margin;
}
