import * as THREE from 'three';
import { figure } from './figures';
import { Bulbs, BULB, Geo, litMat, rnd } from './geo';

/*
 The inflatable: a round bouncy castle of coloured tubes, open at the top, with kids jumping inside.
 Local frame: centred on (0, 0); the entrance (a ramp and an arch) faces south (+z), towards the mela gate.
*/

export const INFLATABLE_R = 4.4;

export function buildInflatable() {
  const group = new THREE.Group();
  const R = INFLATABLE_R, WALL_H = 3.0;
  const COL = ['#e63946', '#ffd23f', '#2a9d8f', '#3a86ff', '#f77f00', '#9b5de5'];
  const col = (i: number) => COL[i % COL.length];

  // the wall: puffy vertical tubes, each a squashed capsule, in alternating colours
  const g = new Geo();
  const TUBES = 22;
  for (let i = 0; i < TUBES; i++) {
    const a = (i / TUBES) * Math.PI * 2;
    const x = Math.cos(a) * R, z = Math.sin(a) * R;
    const tube = new THREE.CapsuleGeometry(0.62, WALL_H - 1.2, 5, 10);
    g.add(tube, col(i), new THREE.Matrix4().makeScale(1, 1, 0.9).setPosition(x, 0.3 + WALL_H / 2, z));
  }
  // top and bottom rings
  const ring = (y: number, r: number, tube: number, color: string) => g.add(new THREE.TorusGeometry(r, tube, 8, 40).rotateX(Math.PI / 2), color, new THREE.Matrix4().makeTranslation(0, y, 0));
  ring(WALL_H + 0.2, R, 0.34, '#ffffff');
  ring(0.55, R, 0.4, '#1d3557');
  g.cyl(0, 0.05, 0, R + 0.3, 0.3, '#1d3557', 32);           // the base mat
  g.cyl(0, 0.34, 0, R - 0.6, 0.12, '#3a86ff', 32);          // the jumping floor
  // four corner towers with domed tops
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4, x = Math.cos(a) * (R + 0.2), z = Math.sin(a) * (R + 0.2);
    g.add(new THREE.CylinderGeometry(0.75, 0.85, 3.4, 12), col(k * 2 + 1), new THREE.Matrix4().makeTranslation(x, 0.3 + 1.7, z));
    g.add(new THREE.SphereGeometry(0.9, 12, 8), col(k * 2), new THREE.Matrix4().makeScale(1, 0.9, 1).setPosition(x, 3.9, z));
    g.add(new THREE.ConeGeometry(0.32, 0.9, 8), '#ffd23f', new THREE.Matrix4().makeTranslation(x, 5.0, z));
  }
  // the entrance: two fat posts, an arch, and a ramp
  for (const sx of [-1, 1]) g.add(new THREE.CapsuleGeometry(0.5, 2.2, 5, 10), col(sx > 0 ? 3 : 1), new THREE.Matrix4().makeTranslation(sx * 1.25, 1.7, R + 0.65));
  g.add(new THREE.TorusGeometry(1.25, 0.42, 8, 20, Math.PI).rotateZ(0), '#ff5a8a', new THREE.Matrix4().makeTranslation(0, 2.8, R + 0.65));
  g.box(0, 0.12, R + 1.9, 2.4, 0.24, 2.2, '#1d3557');
  group.add(new THREE.Mesh(g.build(), litMat({ metalness: 0.0, roughness: 0.45 })));

  // strings of coloured lights round the rim and over the arch
  const bulbs = new Bulbs();
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2;
    bulbs.add(Math.cos(a) * (R + 0.05), WALL_H + 0.62, Math.sin(a) * (R + 0.05), BULB[i % 6], (i % 6) / 6, 1.1);
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 11) * Math.PI;
    bulbs.add(Math.cos(a) * 1.25 * -1, 2.8 + Math.sin(a) * 1.25, R + 1.1, BULB[i % 6], (i % 6) / 6, 1.0);
  }
  group.add(bulbs.object(0.8));

  // kids bouncing inside
  const kids: { m: THREE.Object3D; x: number; z: number; ph: number; sp: number; vx: number; vz: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const a = rnd(i * 3.3) * Math.PI * 2, r = rnd(i * 5.1) * (R - 1.4);
    const m = figure(i % 2 ? 'girl' : 'boy', i * 3 + 1, i % 3 ? 'hop' : 'talk_b', 0.58 + rnd(i) * 0.1);      // children (figures.ts)
    m.rotation.y = rnd(i * 9) * 6.28;
    group.add(m);
    kids.push({ m, x: Math.cos(a) * r, z: Math.sin(a) * r, ph: rnd(i * 7) * 6.28, sp: 4.5 + rnd(i * 11) * 2.5, vx: (rnd(i * 13) - 0.5) * 0.5, vz: (rnd(i * 17) - 0.5) * 0.5 });
  }
  const update = (t: number) => {
    for (const k of kids) {
      const x = k.x + Math.sin(t * 0.5 + k.ph) * k.vx * 2, z = k.z + Math.cos(t * 0.4 + k.ph) * k.vz * 2;
      const hop = Math.abs(Math.sin(t * k.sp * 0.5 + k.ph));
      k.m.position.set(x, 0.46 + hop * 1.1, z);
      k.m.rotation.y += 0.01;
    }
  };

  return {
    group,
    update,
    post: [[0, 0, R + 0.9, 3.2]] as [number, number, number, number?][],
    light: [0, 5.2, 0, '#ffd6a0'] as [number, number, number, string],
  };
}
