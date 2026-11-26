import * as THREE from 'three';
import type { Ramu } from '../../player/ramu';
import { makeActors, type RigName } from '../../world/actors';
import { Chase } from '../../world/chase';
import { findBone, HandProp } from '../../world/handProp';
import type { Mela, Sammelan } from '../../world/mela';
import { INFLATABLE, KUAN, SAMMELAN, SAMMELAN_GATES } from '../../world/melaSite';
import { GALLERY, WELL_R, WELL_SHOW } from '../../world/mautKuan';
import { Person } from '../../world/person';
import { candyFloss, rock } from '../../world/storyProps';
import { GripPrompt } from '../../ui/grip';
import type { Director, Waypoint } from './director';
import type { StoryHooks } from './stage1';
import { playSfx } from './sfx';

/*
 Stage 1, part 3 (plans/10-stage1-part3.md): the escape across the mela, along the user's points A-I.
   mission 6  run: the guards (chase.ts) run hard until they have him: a beating, he shoves one over and is off
   mission 7  A (out of the sammelan's east gate), B (down the lane), C (east along the aisle); at C a guard's rock
              knocks him flying into two customers at a stall
   mission 8  D (north up the main aisle), E (the giant wheel): he jumps for a cabin and it lifts him away
   mission 9  he climbs onto the cabin's roof; a guard waits on the east side, where the cabins come down. Each time his
              cabin goes over the top, Space (or a tap) in time jumps back to the cabin behind; a miss, and it takes
              him down to the guard (back up on a cabin, from the start of the jumps). Three jumps: the guard has the
              operator stop the wheel, his cabin out on the east side; one more jump, into the bouncy castle (F)
   mission 10 G, H, the maut ka kuan's stair, up to its gallery; at the top he sees Anaya across the well, candy floss
              in her hand
   mission 11 round the gallery to her: the guards come up the stair across the well, "Woh raha!"; slow motion: she
              hands him the candy floss; he leaps off the rail, slow all the way down, and lands in the dirt with it in
              his hand. The stage is done.
 Caught on any stretch: a beating, a fade, and that stretch again from its start, the guards a few metres behind.
*/

type P2 = [number, number];
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** a point of the ground plan at height y */
const at3 = (p: P2, y: number) => new THREE.Vector3(p[0], y, p[1]);

// the route (world metres): the user's sketch, moved onto the open ground of the mela as built
const EAST = SAMMELAN_GATES.east;
const A: P2 = [SAMMELAN.x1 + 2.2, EAST.z];
const B: P2 = [-175.3, 298.3];
const C: P2 = [-156.6, 298.3];
const D: P2 = [-149.0, 283.7];
const E: P2 = [-149.0, 273.2];
const F: P2 = [INFLATABLE.x, INFLATABLE.z + INFLATABLE.r + 2.6];   // outside the bouncy castle's door (its ramp)
const G: P2 = [-113.5, 262.0];
const H: P2 = [-108.7, 281.2];
/** a point on the well (its own angle a, radius r) in the world */
const onWell = (a: number, r: number): P2 => [KUAN.x - Math.sin(a) * r, KUAN.z + Math.cos(a) * r];
const STAIR_R = (GALLERY.stairR0 + GALLERY.stairR1) / 2;
const FOOT = onWell(GALLERY.a0 - 0.08, STAIR_R + 0.6);
const LANDING = onWell(GALLERY.a1 + 0.08, (GALLERY.r0 + GALLERY.r1) / 2);
/** the stair's height at angle a */
const stairY = (a: number) => Math.min(GALLERY.y - 0.01, (GALLERY.y - 0.01) * Math.max(0, GALLERY.a0 - a) / (GALLERY.span - GALLERY.land));

const step = (at: P2, hint: string, r = 3): Waypoint => ({ at, hint, done: (x, z) => Math.hypot(x - at[0], z - at[1]) < r });

// ---- the guards ----

let chase: Chase | null = null;
/** the story's guards (one lot for parts 2 and 3), run every frame */
export function chaseFor(mela: Mela, ramu: Ramu): Chase {
  if (!chase) {
    const c = chase = new Chase(mela.group, () => ramu.position, () => ramu.onGround);
    mela.always.add((dt) => c.update(dt));
    if (import.meta.env.DEV) (window as unknown as { __chase: Chase }).__chase = c;   // for test scripts
  }
  return chase;
}

/**
 Part 2's end: four guards after him. On the stage (`stairs`): from beyond the foot of its stairs, up them and across the
 stage at him; otherwise (a test start down on the ground) from the sammelan's gates, round the audience.
*/
export async function sendGuards(mela: Mela, s: Sammelan, ramu: Ramu, stairs = true): Promise<void> {
  const c = chaseFor(mela, ramu);
  if (c.guards.length) return;
  c.harmless = stairs;                 // in part 2's scene they only come at him: mission 6 starts before they have him
  const { x, z } = ramu.position;
  if (stairs) {
    const [fx, fz] = s.exit[5], [bx, bz] = s.exit[6], top = s.exit[4];
    const ux = bx - fx, uz = bz - fz, ul = Math.hypot(ux, uz) || 1;      // away from the stairs' foot
    const spots: [number, number][] = [0, 1, 2, 3].map((i) => [bx + (ux / ul) * (i * 1.1) + (-uz / ul) * ((i % 2) - 0.5), bz + (uz / ul) * (i * 1.1) + (ux / ul) * ((i % 2) - 0.5)]);
    await c.spawn(4, spots, x, z, () => [[fx, fz], top]);
    for (const g of c.guards) g.floor = s.ground;
  } else await c.spawn(4, s.gates, x, z, (gx, gz) => s.route(gx, gz, z));
  c.resetTrail([]);
  c.go();
}

/** people for a scene (customers, the girl), updated each frame till dropped */
const extras = new Set<Person>();
const props: HandProp[] = [];
let ticking = false;
function tickExtras(mela: Mela): void {
  if (ticking) return;
  ticking = true;
  mela.always.add((dt) => { for (const p of extras) p.update(dt); for (const h of props) h.update(); });
}
async function extra(mela: Mela, kind: RigName, x: number, z: number, ry: number, scale = 1): Promise<Person> {
  const [a] = await makeActors(kind, 1);
  a.root.scale.setScalar(scale);
  const p = new Person(a, x, 0.05, z, ry);
  mela.group.add(a.root);
  extras.add(p);
  tickExtras(mela);
  return p;
}

// ---- part 3 ----

export type Part3From = 'start' | 'flee' | 'wheel' | 'hang' | 'kuan' | 'gallery';
/** a test start's mission (the Testing menu) -> where part 3 begins; 11: on the gallery, Anaya seen across the well */
export const PART3_FROM: Record<number, Part3From> = { 6: 'start', 7: 'flee', 8: 'wheel', 9: 'hang', 10: 'kuan', 11: 'gallery' };

export async function stage1Part3(d: Director, ramu: Ramu, mela: Mela, hooks: StoryHooks, from: Part3From = 'start'): Promise<void> {
  const s = await mela.sammelan;
  const c = chaseFor(mela, ramu);
  // the mela's own guards leave him to these four (theirs is a fight: the life bar; this is a chase)
  const hunt = mela.crowd.huntIf;
  mela.crowd.huntIf = () => false;
  if (!c.guards.length) {              // a test start: the guards from the sammelan's gates
    if (from === 'start') ramu.standAt(SAMMELAN.x1 - 4, EAST.z, 0.5);
    await sendGuards(mela, s, ramu, false);
  }
  c.harmless = false;                  // (they came up the stage's stairs at him in a scene: from here they can have him)

  if (from === 'start' || from === 'flee') {
    const fromA: Restart = { at: A, ry: -Math.PI / 2, behind: [[SAMMELAN.x1 - 1.4, EAST.z - 1.2], [SAMMELAN.x1 - 1.4, EAST.z + 1.2], [SAMMELAN.x1 - 2.6, EAST.z], [SAMMELAN.x1 - 3.4, EAST.z + 0.6]] };
    if (from === 'start') {
      // ---- mission 6, run: off the stage before they lay hands on him, and out of the sammelan's east gate (he is
      // the faster; caught, a beating and from the foot of the stairs again) ----
      const [sx, sz] = s.exit[5], ry = Math.atan2(-(A[0] - sx), -(A[1] - sz));
      const back = (k: number): P2 => [sx - Math.sin(ry) * -k, sz - Math.cos(ry) * -k];
      const fromStairs: Restart = { at: [sx, sz], ry, behind: [back(3.5), back(4.5), back(5.5), back(6.5)] };
      c.hard = false;
      // a head start: the scene cut just short of their hands; back along their way, 4.5 m and more off him
      const r = ramu.position;
      c.place(c.guards.map((g, i) => {
        const dx = g.position.x - r.x, dz = g.position.z - r.z, l = Math.hypot(dx, dz) || 1, want = Math.max(l, 4.5 + i * 0.9);
        return [r.x + (dx / l) * want, r.z + (dz / l) * want];
      }));
      await leg(d, ramu, c, 6, 'm.s1.run', [step(A, 'm.s1.flee.h1', 2.6)], fromStairs);
      hooks.step(6);
    } else restartAt(ramu, c, fromA);

    // ---- mission 7: A, B, C ----
    await leg(d, ramu, c, 7, 'm.s1.flee', from === 'flee' ? [step(A, 'm.s1.flee.h1', 2.6), step(B, 'm.s1.flee.h2'), step(C, 'm.s1.flee.h3')] : [step(B, 'm.s1.flee.h2'), step(C, 'm.s1.flee.h3')], fromA);
    await rockScene(d, ramu, c, mela);
    hooks.step(7);
  }

  // ---- mission 8: D, E, the wheel; mission 9: hold on (a miss: from D again) ----
  if (from !== 'kuan' && from !== 'gallery') {
    const fromD = { at: D, ry: 0, behind: [[-149.6, 293], [-148.4, 293.6], [-149.2, 295], [-148.6, 296]] as P2[] };
    const restart = from === 'wheel' || from === 'hang' ? fromD : { at: LAND_AT, ry: -Math.PI / 2, behind: [[-166, 298.0], [-166.5, 299.2], [-168, 298.4], [-169, 299]] as P2[] };
    if (from === 'wheel' || from === 'hang') restartAt(ramu, c, fromD);
    let toHang = from === 'hang';                    // a test start at mission 9: straight onto the wheel
    if (!toHang) {
      await leg(d, ramu, c, 8, 'm.s1.wheel', [step(D, 'm.s1.wheel.h1', 3.5), step(E, 'm.s1.wheel.h2', 3.5)], restart);
      hooks.step(8);
    }
    d.fastForward = toHang;
    await grabWheel(d, ramu, c, mela);
    d.fastForward = false;
    // on the roof: three jumps back to the cabin behind; a miss, and the guard below has him: back up on a cabin
    while (!(await rideWheel(d, ramu, mela))) {
      await caughtBelow(d, ramu, c, mela, hooks);
      backOnWheel(ramu, c, mela);
      await d.fade(0, 0.6);
    }
    hooks.step(9);
    await stopAndJump(d, ramu, c, mela);
  } else if (from === 'kuan') {
    ramu.standAt(...F, 0);
    ramu.yaw = ramu.facing;
    c.place([[-134, 265.5], [-134.6, 267], [-136, 266], [-136.5, 267.5]]);
    c.resetTrail([[-134, 266]]);
    void d.wait(1.2).then(() => c.go());
  } else {                                           // the gallery: at the stair's top, the guards on the stair below
    ramu.standAt(LANDING[0], LANDING[1], GALLERY.y - 0.01);
    ramu.yaw = ramu.facing;
    c.place([FOOT, FOOT, FOOT, FOOT]);
  }

  // ---- mission 10: out of the castle, G, H, the well's stair, the gallery ----
  if (from !== 'gallery') await leg(d, ramu, c, 10, 'm.s1.kuan', [step(F, 'm.s1.kuan.h1', 2.2), step(G, 'm.s1.kuan.h1'), step(H, 'm.s1.kuan.h2'), step(FOOT, 'm.s1.kuan.h3', 3.5),
    { at: LANDING, hint: 'm.s1.kuan.h4', done: () => ramu.position.y > GALLERY.y - 0.6 }],
    { at: F, ry: Math.PI, behind: [[-134, 265.5], [-134.6, 267], [-136, 266], [-136.5, 267.5]] });
  hooks.step(10);
  // mission 11 passed: the big card, while he lies there smiling, eyes shut (once, watched or skipped)
  let passed: Promise<void> | null = null;
  const pass = (): Promise<void> => (passed ??= (async () => { hooks.step(11); await hooks.done(undefined, true); })());
  await gallery(d, ramu, c, mela, pass);
  await pass();
  mela.crowd.huntIf = hunt;
  // then up off the sand, the stage played out (he can go on round the mela)
  if (ramu.face) { ramu.face.smile = 0; ramu.face.shut = 0; }
  ramu.standUp(ramu.position.x, ramu.position.z, 0.1);
  ramu.gesture('get_up');
}

/** his model's roll (about its own forward) that leans him to his left */
const ROLL_LEFT = 1;
/** where he comes down after the rock (in front of the stall at C) */
const LAND_AT: P2 = [C[0] + 1.4, C[1] - 2.6];     // to his left as he runs +x

interface Restart { at: P2; ry: number; behind: P2[] }

function restartAt(ramu: Ramu, c: Chase, r: Restart): void {
  if (ramu.posed) ramu.standUp(r.at[0], r.at[1], 0.5);
  ramu.standAt(r.at[0], r.at[1], 0.5);
  ramu.model.rotation.set(0, r.ry, 0);
  ramu.yaw = r.ry;
  c.place(r.behind);
  c.resetTrail([r.behind[0]]);
  c.hard = false;
}

/**
 A stretch of the chase: the mission's points with the guards after him. Caught: a beating, a fade, and the stretch
 again from `restart` (him there, them behind him), till he gets through.
*/
async function leg(d: Director, ramu: Ramu, c: Chase, n: number, key: string, steps: Waypoint[], restart: Restart): Promise<void> {
  for (;;) {
    let caught = false;
    c.onCatch = () => { caught = true; };
    if (!c.on) void d.wait(1.0).then(() => { if (!caught) c.go(); });
    await d.mission(n, key, steps.map((w) => ({ ...w, done: (x: number, z: number) => caught || w.done(x, z) })));
    if (!caught) { c.onCatch = null; return; }
    await beaten(d, ramu, c);
    restartAt(ramu, c, restart);
    await d.wait(0.3);
    d.cam.release(0);
    await d.fade(0, 0.6);
  }
}

/** the guards round him, facing him: one in front (the one who hits), the rest about */
function surround(ramu: Ramu, c: Chase): Person[] {
  const p = ramu.position, f = ramu.facing, fx = -Math.sin(f), fz = -Math.cos(f);
  const spots: [number, number][] = [[fx * 0.85, fz * 0.85], [-fz * 0.8, fx * 0.8], [fz * 0.8, -fx * 0.8], [-fx * 0.9, -fz * 0.9]];
  c.guards.forEach((g, i) => {
    const [ox, oz] = spots[i % 4];
    g.place(p.x + ox, p.z + oz);
    g.position.y = p.y;
    g.faceTowards(p.x, p.z);
    g.driven = null;
    g.idle();
  });
  return c.guards;
}

/** two blows from the one in front, a flinch each */
async function blows(d: Director, ramu: Ramu, g: Person, n = 2): Promise<void> {
  for (let i = 0; i < n; i++) {
    g.gesture('punch', `pc${performance.now()}`, 1.7);
    await d.wait(0.95);
    ramu.flinch();
    void playSfx('thud', 0.9);
    await d.wait(0.75);
  }
}

const CAUGHT = ['caught1', 'caught2', 'caught3'];
let caughtN = 0;

/** caught on the way: held, a blow or two, a fade */
async function beaten(d: Director, ramu: Ramu, c: Chase): Promise<void> {
  const gs = surround(ramu, c), g = gs[0];
  await d.scene(async () => {
    d.shot(d.front(ramu, { dist: 2.6, side: 1.4, up: 0.4, drop: 0.35, fov: 46 }), 0);
    await d.say('guard', g.face, CAUGHT[caughtN++ % CAUGHT.length]);
    await blows(d, ramu, g, 1);
    await d.fade(1, 0.6);
  });
  await d.fade(1, 0);
}

/** at C: a guard's rock knocks him flying into two customers at the stall ahead; they all go down, and get up */
async function rockScene(d: Director, ramu: Ramu, c: Chase, mela: Mela): Promise<void> {
  c.stop();
  const run0: P2 = [C[0] - 3.6, C[1] + 0.1], run1: P2 = [C[0] - 0.4, C[1] + 0.6];
  const custAt: [P2, P2] = [[LAND_AT[0] - 0.45, LAND_AT[1] - 0.75], [LAND_AT[0] + 0.5, LAND_AT[1] - 0.65]];
  const [uncle, aunty] = await Promise.all([extra(mela, 'uncle', ...custAt[0], 0), extra(mela, 'aunty', ...custAt[1], 0)]);
  const g = c.guards[0];
  g.place(run0[0] - 8.5, run0[1] + 0.3, -Math.PI / 2);
  c.guards.slice(1).forEach((q, i) => q.place(run0[0] - 11 - i * 1.3, run0[1] + (i - 1) * 1.1, -Math.PI / 2));
  for (const q of c.guards) { q.position.y = 0.05; q.idle(); }
  const stone = rock(), held = new HandProp(stone, 'palm');
  mela.group.add(stone);
  held.holder(g.actor.root);
  props.push(held);
  ramu.sitAt(run0[0], 0.05, run0[1], -Math.PI / 2, 'idle');
  const roll = (k: number) => { ramu.model.rotation.z = k; };
  await d.scene(async () => {
    // over the guard's shoulder, Ramu running ahead of him
    d.shot({ pos: v(g.position.x - 2.2, 1.9, g.position.z + 1.4), look: v(run0[0], 1.0, run0[1]), fov: 44 }, 0);
    await d.wait(0.3);
    await d.say('guard', g.face, 'rock');
    g.gesture('throw', 'rk', 1.8);
    await d.wait(0.95);
    // he runs on; the stone goes after him and gets him in the back
    held.holder(null);
    const from = stone.position.clone();
    ramu.holdClip('run');
    d.shot({ pos: v(run1[0] + 5.5, 1.6, run1[1] - 1.2), look: v(run1[0] - 2.5, 1.0, run1[1] + 0.6), fov: 50 }, 0);   // down the aisle, him coming
    await d.tween(0.7, (k) => {
      const x = run0[0] + (run1[0] - run0[0]) * k, z = run0[1] + (run1[1] - run0[1]) * k;
      ramu.position.set(x, 0.05, z);
      stone.position.lerpVectors(from, v(run1[0] - 0.15, 1.25, run1[1]), k);
      stone.position.y += Math.sin(k * Math.PI) * 0.9;
      stone.rotation.x += 0.3;
    });
    void playSfx('thud', 1);
    // struck: arched back, off his feet, thrown to his left, twisting that way, and down onto the two at the stall
    ramu.holdClip('idle');
    ramu.gesture('struck', 1);
    const y0 = -Math.PI / 2, y1 = Math.atan2(-(LAND_AT[0] - run1[0]), -(LAND_AT[1] - run1[1]));
    await d.tween(0.8, (k) => {
      const e = k * k * (3 - 2 * k);
      ramu.position.set(run1[0] + (LAND_AT[0] - run1[0]) * k, 0.05 + Math.sin(k * Math.PI) * 1.0, run1[1] + (LAND_AT[1] - run1[1]) * k);
      ramu.model.rotation.y = y0 + (y1 - y0) * e;
      roll(ROLL_LEFT * Math.sin(k * Math.PI) * 0.7);
      stone.position.y = Math.max(0.08, stone.position.y - 0.08);
    });
    uncle.gesture('fall', 'cf1', 4);
    aunty.gesture('fall2', 'cf2', 4);
    void playSfx('thud', 1);
    roll(0);
    ramu.model.rotation.y = y1;
    ramu.gesture('fall2');
    d.shot({ pos: v(LAND_AT[0] + 3.2, 1.3, LAND_AT[1] + 2.6), look: v(LAND_AT[0], 0.4, LAND_AT[1] - 0.6), fov: 46 }, 0);
    await d.wait(2.2);
    // up again: the customers angry, Ramu sorry, and off
    uncle.gesture('get_up', 'cu1', 2.7);
    aunty.gesture('get_up', 'cu2', 2.7);
    ramu.gesture('get_up');
    await d.wait(2.7);
    aunty.faceTowards(LAND_AT[0], LAND_AT[1]);
    uncle.faceTowards(LAND_AT[0], LAND_AT[1]);
    aunty.face.angry = 1;
    uncle.face.angry = 1;
    d.shot(d.front(aunty, { dist: 1.7, side: 0.95, up: 0.05, drop: 0.12, fov: 38 }), 0);
    await d.wait(0.2);
    await d.say('customer', aunty.face, 'andha');
    ramu.model.rotation.y = Math.atan2(-(aunty.position.x - LAND_AT[0]), -(aunty.position.z - LAND_AT[1]));
    d.shot(d.front(ramu, { dist: 1.7, side: -0.4, up: 0.05, drop: 0.15, fov: 38 }), 0);
    await d.say('ramu', ramu.face, 'sorry');
  });
  // watched or skipped: Ramu up by the stall, the customers on their feet and cross, the guards behind
  roll(0);
  ramu.stopGesture();
  ramu.standUp(LAND_AT[0] - 0.4, LAND_AT[1] + 1.2, 0.5);
  ramu.model.rotation.y = 0;
  ramu.yaw = 0;
  held.holder(null);
  stone.position.set(run1[0] + 0.6, 0.08, run1[1] + 0.3);
  for (const p of [uncle, aunty]) { p.idle(); p.face.angry = 0.6; p.faceTowards(LAND_AT[0], LAND_AT[1] + 1.2); }
  c.place([[run0[0] - 5.5, run0[1]], [run0[0] - 7, run0[1] + 0.9], [run0[0] - 8, run0[1] - 0.8], [run0[0] - 9.5, run0[1]]]);
  c.resetTrail([[run0[0] - 5.5, run0[1]], run1]);
}

// ---- the giant wheel ----

const hands = new THREE.Vector3(), hl = new THREE.Vector3(), hr = new THREE.Vector3(), cab = new THREE.Vector3();
let handBones: [THREE.Object3D, THREE.Object3D] | null = null;
/** the middle of his two hands (world) */
function handsAt(ramu: Ramu): THREE.Vector3 {
  if (!handBones) {
    const l = findBone(ramu.model, 'LeftHand'), r = findBone(ramu.model, 'RightHand');
    if (l && r) handBones = [l, r];
  }
  if (!handBones) return hands.copy(ramu.position).setY(ramu.position.y + 2.0);
  ramu.model.updateWorldMatrix(true, true);
  handBones[0].getWorldPosition(hl);
  handBones[1].getWorldPosition(hr);
  return hands.addVectors(hl, hr).multiplyScalar(0.5);
}

/** where a cabin's floor has its south edge (world): what he hangs from */
function gripOf(cabin: THREE.Object3D, out = new THREE.Vector3()): THREE.Vector3 {
  cabin.getWorldPosition(out);
  out.y -= 1.35;
  out.z += 0.95;
  return out;
}

/** hanging from `cabin`: his hands kept on its edge (`slip` metres down it), every frame, till `hanging.cabin` is null */
const hanging: { cabin: THREE.Object3D | null; slip: number; w: number; ground: number } = { cabin: null, slip: 0, w: 1, ground: 0.05 };
let hangTick = false;
function hangFrom(mela: Mela, ramu: Ramu): void {
  if (hangTick) return;
  hangTick = true;
  mela.always.add(() => {
    const cb = hanging.cabin;
    if (!cb) return;
    const grip = gripOf(cb, cab);
    grip.y -= hanging.slip;
    const off = handsAt(ramu).sub(ramu.position);           // his hands from his feet, in this frame of the clip
    const want = grip.sub(off);
    // still coming up off the ground (w < 1): his feet where they were, rising to the hold
    ramu.position.set(want.x, hanging.ground + (want.y - hanging.ground) * hanging.w, want.z);
  });
}

/** at E: he runs at the wheel, jumps for a cabin coming up and it lifts him off his feet; the guards jump for his feet;
 * he climbs up onto its roof, and one of them goes round to the east side, where the cabins come down */
async function grabWheel(d: Director, ramu: Ramu, c: Chase, mela: Mela): Promise<void> {
  const w = mela.giant;
  c.stop();
  hangFrom(mela, ramu);
  rideRoof(mela, ramu);
  w.speed = 0.05;                                          // (the scene's own pace: slow enough to jump for)
  // the cabin on the rising (west) side whose floor is lowest above 1.6 m
  let best: THREE.Object3D | null = null, by = Infinity;
  for (const cb of w.cabins) {
    const p = gripOf(cb);
    if (p.x < w.hub.x - 0.5 && p.y > 1.5 && p.y < by) { by = p.y; best = cb; }
  }
  const cabin = best ?? w.cabins[0];
  const catchAt = catchSpot(mela);
  await d.scene(async () => {
    const g0 = gripOf(cabin);
    const under: P2 = [g0.x, g0.z + 0.2];
    ramu.sitAt(E[0], 0.08, E[1], 0, 'run');
    ramu.model.rotation.y = Math.atan2(-(under[0] - E[0]), -(under[1] - E[1]));
    d.shot({ pos: v(w.hub.x - 2, 2.2, w.hub.z + 15), look: v(w.hub.x - 4, 3.2, w.hub.z), fov: 52 }, 0);
    c.guards.forEach((q, i) => { q.place(E[0] + (i - 1.5) * 1.2, E[1] + 9 + i * 0.7, 0); q.position.y = 0.05; });
    await d.tween(1.3, (k) => {
      ramu.position.set(E[0] + (under[0] - E[0]) * k, 0.08, E[1] + (under[1] - E[1]) * k);
      for (const q of c.guards) { q.position.z -= 0.06; q.driven = 4.5; }
    });
    // the jump, the hands on the edge, up he goes
    ramu.model.rotation.y = 0;
    ramu.holdClip('hang_idle');
    hanging.cabin = cabin; hanging.slip = 0; hanging.w = 0; hanging.ground = 0.08;
    ramu.gesture('hang_start', 1.2);
    await d.tween(1.0, (k) => { hanging.w = Math.min(1, Math.max(0, (k - 0.35) / 0.55)); });
    hanging.w = 1;
    for (const q of c.guards) { q.driven = null; }
    c.guards.forEach((q, i) => { q.walkTo(under[0] + (i - 1.5) * 0.7, under[1] + 0.6 + (i % 2) * 0.5, 4.2); });
    await d.wait(1.3);
    c.guards.forEach((q, i) => { if (i < 2) q.gesture('jump', `gj${i}`, 1.3); });
    d.shot({ pos: v(under[0] + 1.5, 1.2, under[1] + 4.8), look: v(under[0], 2.7, under[1]), fov: 50 }, 0);
    await d.say('guard', c.guards[0].face, 'utar');
    d.shot(d.front(ramu, { dist: 2.2, side: 0.6, up: -0.3, drop: 0.1, fov: 42 }), 0);
    await d.say('ramu', ramu.face, 'oonchai');
    // up the cabin's side and onto its roof
    const top = new THREE.Vector3();
    d.shot({ pos: v(g0.x - 1.2, g0.y + 1.0, g0.z + 6.5), look: v(g0.x, g0.y + 1.2, g0.z), fov: 50 }, 0);
    void d.until(() => {
      if (d.skipped || riding.cabin) return true;          // (up: the next shot is the scene's, not this one's)
      roofSpot(cabin, top);
      d.shot({ pos: v(top.x - 1.4, top.y + 0.2, top.z + 6.5), look: v(top.x, top.y - 0.4, top.z), fov: 50 }, 0);
      return false;
    });
    await climbUp(d, ramu, cabin);
    // one of them round to the other side, where the cabins come down
    const g = c.guards[0], g1 = c.guards[1];
    g1.faceTowards(catchAt[0], catchAt[1]);
    d.shot(d.front(g1, { dist: 2.8, side: -0.9, up: 0.1, drop: 0.25, fov: 46 }), 0);
    g1.gesture('angry_point', 'udhar', 1.8);
    await d.say('guard', g1.face, 'udhar');
    // and off he goes, round under the wheel to the east side
    g.walkTo(catchAt[0], catchAt[1], 4.6);
    const t0 = performance.now();
    await d.until(() => {
      const q = g.position;
      d.shot({ pos: v(q.x - 3.5, 2.2, q.z + 8), look: v(q.x + 1, 1.4, q.z - 1), fov: 50 }, 0);
      return d.skipped || performance.now() - t0 > 2600 || Math.hypot(q.x - catchAt[0], q.z - catchAt[1]) < 0.5;
    });
    g.faceTowards(w.hub.x, w.hub.z);
  });
  // watched or skipped: crouched on the cabin's roof, on the way up; one guard on the east side, the others beneath
  onRoof(ramu, cabin);
  w.speed = RIDE_SPEED;
  guardsRound(c, mela);
}

// ---- on a cabin's roof ----

/** his soles on a cabin's roof: the canopy's top (below the pivot), beside the hanger, towards the camera's side */
const ROOF = -0.02, ROOF_DX = 0.3, ROOF_DZ = 0.3;
/** crouched up there, facing south-west (towards the cabin behind and the crowd) */
const FACE_ROOF = Math.PI * 0.75;
/** the wheel's pace while he is up there (slower than its own 0.22, so there is time to jump), and on the way up to the top */
const RIDE_SPEED = 0.12, CLIMB_SPEED = 0.45;
/** cabins apart, round the wheel (16) */
const STEP = (Math.PI * 2) / 16;
/** jumps back to the cabin behind that he needs, and how far over the top his cabin goes before the call to jump */
const JUMPS = 3, CALL_AT = 0.5;
/** a miss: the guard has him when his cabin is this far round (near the bottom, on the east side) */
const CAUGHT_AT = 2.75;

const riding: { cabin: THREE.Object3D | null } = { cabin: null };
const roofAt = new THREE.Vector3(), wpos = new THREE.Vector3();
/** the bones his soles are measured from, each with how far its sole surface is below it (the ankle, the ball, the toe tip) */
let soleBones: [THREE.Object3D, number][] | null = null;
const sp = new THREE.Vector3(), lp = new THREE.Vector3();
const sm = (x: number): number => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };
const wrapA = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

function soles(ramu: Ramu): [THREE.Object3D, number][] {
  if (!soleBones) {
    soleBones = [];
    for (const side of ['Left', 'Right']) for (const [b, m] of [['Foot', 0.07], ['ToeBase', 0.03], ['Toe_End', 0.015]] as const) {
      const bone = findBone(ramu.model, side + b);
      if (bone) soleBones.push([bone, m]);
    }
  }
  return soleBones;
}

/** how far his lowest sole (heel, ball or toe tip) is above his position, in this frame of his clip */
function soleOff(ramu: Ramu): number {
  const bs = soles(ramu);
  if (!bs.length) return 0;
  ramu.model.updateWorldMatrix(true, true);
  let low = Infinity;
  for (const [b, m] of bs) low = Math.min(low, b.getWorldPosition(sp).y - m);
  return low - ramu.position.y;
}

/**
 Lifts him so that no sole is under the roof of a cabin it is over: never a foot through a cabin (the jump clip's take-off
 and landing crouch lower than the pose he was placed for). The cabin: its roof (top 0.02 below the pivot) over the box.
*/
function aboveRoofs(ramu: Ramu, mela: Mela): void {
  const bs = soles(ramu);
  ramu.model.updateWorldMatrix(true, true);
  let lift = 0;
  for (const [b, m] of bs) {
    b.getWorldPosition(sp);
    for (const cb of mela.giant.cabins) {
      cb.worldToLocal(lp.copy(sp));
      const sole = lp.y - m;
      if (Math.abs(lp.x) < 1.1 && Math.abs(lp.z) < 0.75 && sole < -0.01 && sole > -1.45) lift = Math.max(lift, -0.01 - sole);
    }
  }
  if (lift > 0) ramu.position.y += lift;
}

/** where his soles go on `cabin`'s roof (world) */
function roofSpot(cabin: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
  cabin.getWorldPosition(out);
  return out.set(out.x + ROOF_DX, out.y + ROOF, out.z + ROOF_DZ);
}

/** a cabin's angle round the wheel from the top: rising on the west (< 0), going down on the east (> 0) */
function thetaOf(mela: Mela, cabin: THREE.Object3D): number {
  const h = mela.giant.hub;
  cabin.getWorldPosition(wpos);
  return Math.atan2(wpos.x - h.x, wpos.y - h.y);
}

/** the cabin nearest the angle `a` */
function cabinAt(mela: Mela, a: number): THREE.Object3D {
  let to = mela.giant.cabins[0], best = Infinity;
  for (const cb of mela.giant.cabins) {
    const e = Math.abs(wrapA(thetaOf(mela, cb) - a));
    if (e < best) { best = e; to = cb; }
  }
  return to;
}

/** where the guard waits for him: under the east side, where the cabins come down, in front of the wheel */
function catchSpot(mela: Mela): P2 {
  const h = mela.giant.hub;
  return [h.x + 3.7, h.z + 2.6];
}

/** on `cabin`'s roof, every frame, till `riding.cabin` is null */
let rideTick = false;
function rideRoof(mela: Mela, ramu: Ramu): void {
  if (rideTick) return;
  rideTick = true;
  mela.always.add(() => {
    const cb = riding.cabin;
    if (!cb) return;
    roofSpot(cb, roofAt);
    ramu.position.set(roofAt.x, roofAt.y - soleOff(ramu), roofAt.z);
  });
}

/** crouched on `cabin`'s roof (an end state: watched or skipped) */
function onRoof(ramu: Ramu, cabin: THREE.Object3D): void {
  hanging.cabin = null;
  riding.cabin = cabin;
  ramu.stopGesture();
  ramu.holdClip('roof_crouch');
  ramu.model.rotation.set(0, FACE_ROOF, 0);
}

/** the guards: one on the east side to catch him coming down, the others beneath the west side, looking up */
function guardsRound(c: Chase, mela: Mela): void {
  const h = mela.giant.hub, at = catchSpot(mela);
  c.guards.forEach((q, i) => {
    q.driven = null;
    if (i === 0) q.place(at[0], at[1]);
    else q.place(h.x - 5 - i * 0.9, h.z + 2.4 + (i % 2) * 0.8);
    q.position.y = 0.05;
    q.idle();
    q.faceTowards(h.x, h.z);
  });
}

/** from hanging under `cabin`'s floor: up its side, over the roof's edge and crouched on it */
async function climbUp(d: Director, ramu: Ramu, cabin: THREE.Object3D): Promise<void> {
  const edge = new THREE.Vector3(), top = new THREE.Vector3(), byHands = new THREE.Vector3(), byFeet = new THREE.Vector3();
  ramu.stopGesture();
  ramu.holdClip('roof_crouch');
  ramu.gesture('climb_roof', 1);
  hanging.cabin = null;
  await d.tween(1.7, (k) => {
    gripOf(cabin, edge);                                   // the floor's edge, where his hands are
    roofSpot(cabin, top);
    // the hands up the cabin's side to the roof's edge
    const up = sm(k / 0.55);
    byHands.set(edge.x, edge.y + (top.y + 0.04 - edge.y) * up, edge.z + 0.1 * up);
    byHands.sub(handsAt(ramu).sub(ramu.position));
    // the feet over the edge and in to where he crouches
    const inn = sm((k - 0.45) / 0.55);
    byFeet.set(top.x, top.y - soleOff(ramu), edge.z + 0.1 + (top.z - edge.z - 0.1) * inn);
    ramu.position.lerpVectors(byHands, byFeet, sm((k - 0.35) / 0.4));
    ramu.model.rotation.y = FACE_ROOF * inn;
  });
  onRoof(ramu, cabin);
}

/** the camera on him up there: from in front of the wheel, a little to the west (the cabin behind in the shot) */
function rideCam(d: Director, ramu: Ramu): void {
  const p = ramu.position;
  d.shot({ pos: v(p.x - 1.4, p.y + 0.9, p.z + 7.2), look: v(p.x - 1.3, p.y + 0.55, p.z), fov: 50 }, 0);
}

/**
 * Crouched on the roof as the wheel turns: up to the top, and each time his cabin goes over it and on down towards the
 * guard, the call to jump (Space or a tap, in time) back to the cabin behind. True after JUMPS of them; false if he
 * missed one (his cabin goes on down: caughtBelow).
 */
async function rideWheel(d: Director, ramu: Ramu, mela: Mela): Promise<boolean> {
  const w = mela.giant, ui = new GripPrompt('leap');
  let following = true;
  void d.until(() => { if (following && !leaping) rideCam(d, ramu); return !following; });
  d.locked = true;                                      // (he is held; the keys are for the jump)
  try {
    for (let n = 0; n < JUMPS; n++) {
      d.box.set(9, 'm.s1.hold', n ? 'm.s1.hold.h2' : 'm.s1.hold.h1', null);
      const t0 = performance.now();
      await d.until(() => {
        const cb = riding.cabin;
        if (!cb) return true;
        const a = thetaOf(mela, cb);
        w.speed = a < -0.6 ? CLIMB_SPEED : RIDE_SPEED;   // (quicker on the way up to the top)
        return a > CALL_AT && a < 2 && performance.now() - t0 > 1200;
      });
      if (!(await ui.grab(n ? 1.6 : 2.0))) return false;
      await leap(d, ramu, mela);
    }
    return true;
  } finally {
    following = false;
    ui.dispose();
    d.box.clear();
    d.locked = false;
  }
}

/** jump_far (assets/anims/Jump_fromplaceToanother.fbx): 1.03 s; the feet leave at 0.07 s, down again at 0.73 s */
const JF_LEN = 1.03, JF_OFF = 0.07, JF_LAND = 0.73;

/** while a leap is on: the ride camera stands aside for the leap's own close shot */
let leaping = false;
/** the leaps' slow motion: his alone (the clip and his flight across), the wheel and everybody else at their own pace */
const LEAP_SLOW = 0.3;

/**
 a jump from his cabin's roof back to the roof of the one behind (higher, nearer the top), the wheel turning on: in slow
 motion, the camera close on him in front of the wheel, a little ahead of him, swinging round with him from take-off to
 landing (the two roofs in the shot), then back to the ride camera
*/
async function leap(d: Director, ramu: Ramu, mela: Mela): Promise<void> {
  const from = riding.cabin!, to = cabinAt(mela, thetaOf(mela, from) - STEP);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), off = soleOff(ramu), mid = new THREE.Vector3(), dir = new THREE.Vector3();
  riding.cabin = null;
  ramu.gesture('jump_far', LEAP_SLOW);
  ramu.model.rotation.y = Math.PI / 2;                  // west, the way he jumps
  leaping = true;
  try {
    // the clip (Jump_fromplaceToanother, in place) springs him up and lands him: across between its take-off and landing
    // (the roofs read each frame: the wheel turns on at its own pace under him)
    await d.tween(JF_LEN / LEAP_SLOW, (k) => {
      roofSpot(from, a);
      roofSpot(to, b);
      dir.subVectors(b, a).setY(0).normalize();
      mid.lerpVectors(a, b, 0.5);
      const f = Math.max(0, Math.min(1, (k * JF_LEN - JF_OFF) / (JF_LAND - JF_OFF)));
      a.lerp(b, sm(f));
      ramu.position.set(a.x, a.y - off + Math.sin(Math.PI * f) * 0.25, a.z);
      aboveRoofs(ramu, mela);
      // close: 3.4 m out in front of the wheel, from ahead of him at take-off round to beside him at the landing, looking
      // at him (and a little toward where he lands), so the whole leap is in the shot
      // (up with the clip's own spring, which lifts him off the roof, so his head stays in the frame at the top)
      const s = sm(k), along = 1.3 - 1.1 * s, lift = 0.7 * Math.sin(Math.PI * f), y = ramu.position.y + lift;
      const p = ramu.position, lk = v(p.x + dir.x * 0.6 * (1 - s), y + 0.85, p.z + dir.z * 0.6 * (1 - s)).lerp(v(mid.x, y + 0.85, mid.z), 0.25);
      d.shot({ pos: v(p.x + dir.x * along, y + 1.2 - 0.3 * s, p.z + 3.6 + dir.z * along), look: lk, fov: 48 }, 0);
    });
  } finally {
    leaping = false;
  }
  riding.cabin = to;
  void playSfx('thud', 0.4);
  void d.tween(0.4, (k) => { ramu.model.rotation.y = Math.PI / 2 + (FACE_ROOF - Math.PI / 2) * k; });
}

/** a miss: his cabin takes him on down to the guard waiting on the east side, who pulls him off; a fade */
async function caughtBelow(d: Director, ramu: Ramu, c: Chase, mela: Mela, hooks: StoryHooks): Promise<void> {
  const w = mela.giant, g = c.guards[0];
  let following = true;
  void d.until(() => { if (following) rideCam(d, ramu); return !following; });
  d.locked = true;
  await d.until(() => {
    if (!riding.cabin) return true;
    w.speed = 0.42;
    return thetaOf(mela, riding.cabin) > CAUGHT_AT;
  });
  following = false;
  await d.scene(async () => {
    const from = ramu.position.clone(), gp = g.position.clone();
    const land = v(gp.x - 0.7, 0.08, gp.z - 0.35);
    w.speed = RIDE_SPEED;
    riding.cabin = null;
    d.shot({ pos: v(gp.x + 2.2, 1.7, gp.z + 5.2), look: v(gp.x - 0.6, 1.5, gp.z - 0.8), fov: 52 }, 0);
    g.faceTowards(from.x, from.z);
    g.gesture('jump', 'gcatch', 1.0);                     // up for his ankle
    await d.wait(0.35);
    ramu.stopGesture();
    ramu.holdClip('falling');
    ramu.model.rotation.y = FACE_ROOF;
    await d.tween(0.55, (k) => {
      ramu.position.lerpVectors(from, land, k);
      ramu.position.y = from.y + (0.08 - from.y) * k * k;
    });
    void playSfx('thud', 1);
    ramu.holdClip('idle');
    ramu.gesture('fall');
    g.faceTowards(land.x, land.z);
    g.gesture('angry_point', 'gpakda', 1.8);
    await d.say('guard', g.face, 'pakda');
    await d.fade(1, 0.6);
  });
  await d.fade(1, 0);
  d.locked = false;
  hooks.note('story.s1.caughtWheel');
}

/** after a catch: on the roof of a cabin rising on the west side again, the guards back round the wheel */
function backOnWheel(ramu: Ramu, c: Chase, mela: Mela): void {
  const cb = cabinAt(mela, -1.0);
  roofSpot(cb, roofAt);
  ramu.sitAt(roofAt.x, roofAt.y, roofAt.z, FACE_ROOF, 'roof_crouch');
  onRoof(ramu, cb);
  mela.giant.speed = RIDE_SPEED;
  guardsRound(c, mela);
}

/** his cabin's angle where the wheel is stopped: out on the east side, the nearest it comes to the bouncy castle */
const STOP_AT = 1.62;

/**
 * Three jumps: the guard has the operator stop the wheel; it slows to a stop with his cabin out on the east side, the
 * bouncy castle below and beyond it; the call to jump; and he leaps, and lands in it.
 */
async function stopAndJump(d: Director, ramu: Ramu, c: Chase, mela: Mela): Promise<void> {
  const w = mela.giant, op = mela.wheelMan;
  const bounce = v(INFLATABLE.x + 0.4, 0.46, INFLATABLE.z - 0.3);
  // slowing to stop with his cabin at STOP_AT (true once stopped)
  let stopping = false;
  const stopTick = (): boolean => {
    if (!stopping || !riding.cabin) return !stopping;
    let rem = STOP_AT - thetaOf(mela, riding.cabin);
    if (rem < -0.25) rem += Math.PI * 2;
    w.speed = rem < 0.004 ? 0 : Math.min(0.3, Math.max(0.035, rem * 0.6));
    return w.speed === 0;
  };
  void d.until(() => stopTick() && stopping);
  await d.scene(async () => {
    // the guard to the operator at his lever (south of the wheel)
    const g = c.guards[0];
    const opAt: P2 = op ? [op.root.position.x, op.root.position.z] : [w.hub.x, w.hub.z + 5.3];
    g.place(opAt[0] - 1.6, opAt[1] + 1.2);
    g.faceTowards(...opAt);
    if (op) op.root.rotation.y = Math.atan2(-(g.position.x - opAt[0]), -(g.position.z - opAt[1]));
    d.shot({ pos: v(opAt[0] + 1.2, 1.6, opAt[1] + 3.4), look: v(opAt[0] - 0.6, 1.3, opAt[1]), fov: 44 }, 0);
    g.gesture('angry_point', 'rok', 1.8);
    await d.say('guard', g.face, 'rok');
    if (op) op.root.rotation.y = 0;
    mela.pullWheelLever();
    await d.say('operator', op?.face ?? null, 'le');
    stopping = true;
    // the wheel slows, his cabin coming round to a stop out on the east side
    const h = w.hub;
    d.shot({ pos: v(h.x + 8, 7, h.z + 30), look: v(h.x + 9, 8, h.z - 2), fov: 52 }, 0);
    const t0 = performance.now();
    await d.until(() => d.skipped || w.speed === 0 || performance.now() - t0 > 9000);
  });
  stopping = true;
  await d.until(() => w.speed === 0 || !riding.cabin);
  // the call to jump, into the castle (no hurry: it asks again till he goes)
  // the camera behind him on the cabin's roof, looking past him down at the castle; it goes with him, jump and fall
  const from = ramu.position.clone();
  const ahead = v(bounce.x - from.x, 0, bounce.z - from.z).normalize();
  const side = v(-ahead.z, 0, ahead.x);
  const behind = (p: THREE.Vector3, k = 0) => ({
    // over his shoulder, close (between him and the spokes behind), looking out past him and a little down at the castle
    pos: v(p.x - ahead.x * 1.7 + side.x * 0.45, p.y + 1.55, p.z - ahead.z * 1.7 + side.z * 0.45),
    look: v(p.x + ahead.x * 5, p.y + 0.8 + (bounce.y - p.y) * (0.15 + 0.6 * k), p.z + ahead.z * 5),
    fov: 60,
  });
  ramu.model.rotation.y = Math.atan2(-(bounce.x - from.x), -(bounce.z - from.z));
  d.shot(behind(from), 0);
  d.box.set(9, 'm.s1.castle', 'm.s1.castle.h1', null);
  d.locked = true;
  const ui = new GripPrompt('leap');
  while (!(await ui.grab(4, 'leap.castle')));
  ui.dispose();
  d.box.clear();
  d.locked = false;
  await d.scene(async () => {
    const off = soleOff(ramu), at = ramu.position.clone().setY(ramu.position.y + off);
    riding.cabin = null;
    ramu.model.rotation.y = Math.atan2(-(bounce.x - at.x), -(bounce.z - at.z));
    const SLOW = 0.4;                                      // slow motion, his alone: the whole leap and fall
    ramu.gesture('jump_far', SLOW);
    d.shot(behind(ramu.position), 0);
    const T = 2.1, peak = 2.4, t0 = JF_OFF / T;
    await d.tween(T / SLOW, (k) => {
      if (k * T > JF_LAND - 0.3) ramu.holdClip('falling', false, SLOW);   // past the clip's top: falling the rest of the way
      const f = Math.max(0, (k - t0) / (1 - t0));
      ramu.position.lerpVectors(at, bounce, f);
      ramu.position.y += Math.sin(f * Math.PI) * peak - off * (1 - f);
      aboveRoofs(ramu, mela);
      // up with the clip's own spring (it lifts him ~0.85 m off the roof before he drops), so he stays in the frame
      const lift = 0.85 * Math.sin(Math.PI * Math.max(0, Math.min(1, (k * T - JF_OFF) / (JF_LAND - JF_OFF))));
      const sh = behind(ramu.position, f);
      sh.pos.y += lift; sh.look.y += lift;
      d.shot(sh, 0);
    });
    ramu.holdClip('falling');
    void playSfx('thud', 0.6);
    // boing, boing, boing
    d.shot({ pos: v(bounce.x - 4.5, 6.8, bounce.z + 6.5), look: v(bounce.x, 1.0, bounce.z), fov: 48 }, 0);
    ramu.stopGesture();
    ramu.holdClip('idle');
    for (const [hh, t] of [[2.0, 0.75], [0.9, 0.5], [0.35, 0.3]]) {
      await d.tween(t, (k) => { ramu.position.set(bounce.x, bounce.y + Math.sin(k * Math.PI) * hh, bounce.z); });
    }
    ramu.gesture('get_up');
    await d.wait(2.5);
    d.shot(d.front(ramu, { dist: 1.8, side: 0.4, up: 0.1, drop: 0.15, fov: 40 }), 0);
    await d.say('ramu', ramu.face, 'boing');
  });
  // watched or skipped: on his feet on the castle's floor, the wheel stopped (it goes again a little later), the guards
  // coming from the wheel
  riding.cabin = null;
  hanging.cabin = null;
  ramu.model.rotation.x = 0;
  ramu.stopGesture();
  ramu.standUp(bounce.x, bounce.z, 0.6);
  ramu.model.rotation.y = Math.PI;
  ramu.yaw = Math.PI;
  w.speed = 0;
  void d.wait(9).then(() => { w.speed = 0.22; });
  c.place([[-134, 265.5], [-134.6, 267], [-136, 266], [-136.5, 267.5]]);
  c.resetTrail([[-134, 266], F]);
}

// ---- the gallery ----

/**
 along the gallery's ring (not across the well) from angle a0 to a1, at `speed`: the shorter way, or with `dir` (+1 / -1)
 the way round the angle grows / falls. Running again (or `halt`) stops the run before.
*/
async function round(d: Director, p: Person, a0: number, a1: number, speed: number, lane = 0, dir = 0): Promise<void> {
  const me = (runs.get(p) ?? 0) + 1;
  runs.set(p, me);
  const TAU = Math.PI * 2;
  let da = a1 - a0;
  if (dir > 0) da = ((da % TAU) + TAU) % TAU;
  else if (dir < 0) da = -((((-da) % TAU) + TAU) % TAU);
  else da = Math.atan2(Math.sin(da), Math.cos(da));
  const n = Math.max(1, Math.ceil(Math.abs(da) / 0.15)), r = (GALLERY.r0 + GALLERY.r1) / 2 + lane;
  for (let i = 1; i <= n; i++) {
    const [x, z] = onWell(a0 + (da * i) / n, r);
    p.walkTo(x, z, speed);
    // near is enough: the others (or the crowd) may keep them off the very spot
    await d.until(() => runs.get(p) !== me || !p.walking || Math.hypot(p.position.x - x, p.position.z - z) < 0.35);
    if (runs.get(p) !== me || d.skipped || !d.locked) return;   // (run again, or the scene is over: they are put where it leaves them)
  }
}
const runs = new WeakMap<Person, number>();
const halt = (p: Person): void => { runs.set(p, (runs.get(p) ?? 0) + 1); };

/** the well's centre, for directions */
/** how high the floor is under (x, z) up at the well: the gallery, or the round stair winding up outside it */
const onFloor = (x: number, z: number): number => {
  const dx = x - KUAN.x, dz = z - KUAN.z;
  return Math.hypot(dx, dz) < GALLERY.r1 + 0.05 ? GALLERY.y - 0.01 : stairY(Math.atan2(-dx, dz));
};

const fromWell = (p: P2): P2 => { const dx = p[0] - KUAN.x, dz = p[1] - KUAN.z, l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };

/**
 On the gallery: he sees Anaya at the rail with candy floss, right across the well, and goes round to her (the player's
 run); there the guards come up the stair across the well and see him; slow from then on: she holds the candy floss out
 and he takes it; they come round at him from both sides; he gets up on the inner rail, his back to the well, facing
 her; he sways, his foot slips and he goes over backward: slow all the way down, the bikes and cars on the wall going round past him, between him and the camera; down on the
 sand, the candy floss still in his hand. The stage is done.
*/
async function gallery(d: Director, ramu: Ramu, c: Chase, mela: Mela, pass: () => Promise<void>): Promise<void> {
  c.stop();
  const Y = GALLERY.y - 0.01, rIn = GALLERY.r0 + 0.45;
  const GIRL_A = GALLERY.girl;
  const girlAt = onWell(GIRL_A, rIn), meetAt = onWell(GIRL_A + 0.075, rIn);
  const RAIL_A = GIRL_A + 0.03, rail = onWell(RAIL_A, WELL_R + 0.22);   // where he goes up on the inner rail, beside her
  const girlBack = onWell(GIRL_A - 0.02, GALLERY.r1 - 0.3);             // where she backs off to
  const faceGirl = Math.atan2(-(girlBack[0] - rail[0]), -(girlBack[1] - rail[1]));
  // the guards: 0 and 1 come round with the angle growing, 2 and 3 the other way; where each stops, close by him
  const side = (i: number): number => (i < 2 ? 1 : -1);
  const lane = (i: number): number => (i % 2 ? 0.35 : -0.3);
  const closeTo = (i: number): number => RAIL_A + side(i) * (0.2 + (i % 2) * 0.08) + (side(i) < 0 ? -0.08 : 0);
  const toWell = Math.atan2(-(KUAN.x - meetAt[0]), -(KUAN.z - meetAt[1]));
  // at the rail, watching the show down in the well (she turns to him when he comes up to her)
  const girl = await extra(mela, 'anaya', girlAt[0], girlAt[1], Math.atan2(-(KUAN.x - girlAt[0]), -(KUAN.z - girlAt[1])));
  girl.position.y = Y;
  girl.face.laughing = true;
  const floss = candyFloss(), held = new HandProp(floss, 'stick', 0.12);  // in her fist, 12 cm up the stick
  mela.group.add(floss);
  held.holder(girl.actor.root);
  props.push(held);
  // the guards still on the stair, a turn below (out of sight)
  const onStair = (i: number): [number, number, number] => { const a = GALLERY.a1 + 0.45 + i * 0.09; const [x, z] = onWell(a, STAIR_R); return [x, stairY(a), z]; };
  c.guards.forEach((q, i) => { const [x, y, z] = onStair(i); q.place(x, z); q.position.y = y; q.faceTowards(...LANDING); q.idle(); });
  const overWell = (a: number, y: number, back = 2.2) => at3(onWell(a, GALLERY.r0 - back), y);
  // on his back on the sand: close over his face, from above his chest along his body (so the face is the right way up)
  const onFace = (): void => {
    const h = new THREE.Vector3(), hips = new THREE.Vector3();
    let hb: THREE.Object3D | null = null;
    ramu.model.traverse((o) => { if (!hb && /Hips$/.test(o.name)) hb = o; });
    if (!ramu.headPosition(h)) return;
    const [ix, iz] = fromWell([h.x, h.z]);
    if (hb) (hb as THREE.Object3D).getWorldPosition(hips); else hips.set(h.x - ix, h.y, h.z - iz);
    const along = hips.sub(h).setY(0).normalize();               // from his head toward his feet
    d.shot({ pos: v(h.x + along.x * 0.55, h.y + 0.85, h.z + along.z * 0.55), look: v(h.x - along.x * 0.04, h.y + 0.04, h.z - along.z * 0.04), fov: 38 }, 0);
  };
  let shown = false;                             // the card shown in the scene (not skipped)

  // ---- he sees her ----
  await d.scene(async () => {
    ramu.standAt(LANDING[0], LANDING[1], Y);
    ramu.faceTowards(...girlAt);
    const [ix, iz] = fromWell(LANDING);
    d.shot({ pos: v(LANDING[0] - ix * 0.2 + Math.sin(ramu.facing) * 1.6, Y + 1.8, LANDING[1] - iz * 0.2 + Math.cos(ramu.facing) * 1.6), look: at3(girlAt, Y + 1.3), fov: 42 }, 0);
    await d.wait(0.9);
    const on = { pos: overWell(GIRL_A - 0.05, Y + 1.5), look: at3(girlAt, Y + 1.35), fov: 30 };
    d.shot(on, 0, d.pushIn(on, 0.08));
    await d.wait(1.2);
    d.shot(d.front(ramu, { dist: 1.5, side: 0.3, up: 0.05, drop: 0.12, fov: 38 }), 0);
    await d.say('ramu', ramu.face, 'dekho');
  });
  ramu.yaw = ramu.facing;

  // ---- mission 11: to her ----
  await d.mission(11, 'm.s1.girl', [{ at: girlAt, hint: 'm.s1.girl.h1', done: (x, z) => Math.hypot(x - meetAt[0], z - meetAt[1]) < 1.4 && ramu.position.y > Y - 0.6 }]);

  // ---- the guards come up the stair, across the well from him; then slow: the candy floss, and into the well ----
  await d.scene(async () => {
    ramu.sitAt(meetAt[0], Y, meetAt[1], Math.atan2(-(girlAt[0] - meetAt[0]), -(girlAt[1] - meetAt[1])), 'idle');
    girl.faceTowards(...meetAt);
    const top = (i: number) => onWell(GALLERY.a1 + 0.05 + (i >> 1) * 0.06, (GALLERY.r0 + GALLERY.r1) / 2 + (i % 2 ? 0.35 : -0.3));
    c.guards.forEach((q, i) => { q.floor = onFloor; q.walkTo(...top(i), 3.8); });
    // from behind the two of them, across the well to the stair's top
    d.shot({ pos: at3(onWell(GIRL_A + 0.42, rIn + 0.55), Y + 1.7), look: at3(LANDING, Y + 1.0), fov: 17 }, 0);   // off the line through the centre pole
    await Promise.race([d.until(() => c.guards.every((q) => !q.walking)), d.wait(3.5)]);
    c.guards.forEach((q) => q.faceTowards(...meetAt));
    await d.wait(0.9);                               // there they are, across the well
    const g = c.guards[1];
    g.faceTowards(...meetAt);
    g.gesture('angry_point', 'wr', 1.8);
    d.shot(d.front(g, { dist: 2.4, side: 0.6, up: 0.1, drop: 0.2, fov: 40 }), 0);
    await d.say('guard', g.face, 'wohraha');
    // they split: two round one way, two the other (the stair's top is right across from her: as far either way)
    c.guards.forEach((q, i) => { q.floor = null; void round(d, q, GALLERY.a1 + 0.05, closeTo(i), 3.8, lane(i), side(i)); });
    // slow from here: she holds out the candy floss as they come round
    d.timeScale = 0.4;
    const two = { pos: overWell(GIRL_A + 0.04, Y + 1.45), look: at3(onWell(GIRL_A + 0.04, rIn), Y + 1.2), fov: 34 };
    d.shot(two, 0, d.pushIn(two, 0.05));
    await d.wait(0.4);
    girl.gesture('offer', 'offer', 30);              // she holds it out (till it is taken)
    await d.say('girl', girl.face, 'khaoge');
    // slower still, close on the hands: his comes up to hers and takes it
    d.timeScale = 0.25;
    // over the inner rail from the well's side, high enough to clear it: their faces and the hands between them
    const hands = { pos: overWell(GIRL_A + 0.0375, Y + 1.8, 1.6), look: at3([(girlAt[0] + meetAt[0]) / 2, (girlAt[1] + meetAt[1]) / 2], Y + 1.15), fov: 36 };
    d.shot(hands, 0, d.pushIn(hands, 0.06));
    ramu.gesture('offer', 1, 30);
    await d.wait(0.85);
    held.holder(ramu.model);
    await d.wait(0.45);
    girl.idle();
    ramu.stopGesture();
    d.timeScale = 0.4;
    if (ramu.face) ramu.face.laughing = true;
    d.shot({ ...two, pos: overWell(GIRL_A + 0.04, Y + 1.3, 2.8), fov: 36 }, 0);
    await d.say('ramu', ramu.face, 'shrota');
    if (ramu.face) ramu.face.laughing = false;

    // ---- from both sides at once (the half-way round they ran while the two of them were on screen) ----
    d.timeScale = 0.7;
    c.guards.forEach((q, i) => {
      const [x, z] = onWell(GIRL_A + side(i) * (0.48 + (i % 2) * 0.08), (GALLERY.r0 + GALLERY.r1) / 2 + lane(i));
      q.place(x, z); q.position.y = Y;
      void round(d, q, GIRL_A + side(i) * (0.48 + (i % 2) * 0.08), closeTo(i), 3.8, lane(i), -side(i));
    });
    girl.walkTo(...girlBack, 0.8);                   // she backs off from the rail, scared
    // high, from outside, down onto the gallery: him in the middle, a pair coming round at him from each side
    const wide = { pos: at3(onWell(RAIL_A, GALLERY.r1 + 6), Y + 8), look: at3(onWell(RAIL_A, rIn), Y + 0.6), fov: 50 };
    d.shot(wide, 0, d.pushIn(wide, 0.05));
    await d.wait(1.5);
    // he looks one way, then the other: nowhere to go
    d.shot(d.front(ramu, { dist: 1.6, side: 0.2, up: 0.05, drop: 0.12, fov: 40 }), 0);
    for (const s of [1, -1]) {
      const q = c.guards[s > 0 ? 0 : 2];
      ramu.faceTowards(q.position.x, q.position.z);
      await d.wait(0.55);
    }
    ramu.model.rotation.y = faceGirl;
    await d.wait(0.25);

    // ---- up onto the inner rail, his back to the well, facing her ----
    const outside = { pos: at3(onWell(RAIL_A + 0.1, GALLERY.r1 + 1.4), Y + 2.0), look: at3(rail, Y + 1.85), fov: 46 };   // from out past her, the well behind him
    d.shot(outside, 0);
    const [sx, sz] = [ramu.position.x, ramu.position.z];
    await d.tween(0.55, (k) => ramu.position.set(sx + (rail[0] - sx) * k, Y + 1.1 * Math.sin(k * Math.PI / 2), sz + (rail[1] - sz) * k));
    c.guards.forEach((q) => q.faceTowards(...rail));
    // he sways up there
    ramu.model.rotation.order = 'YXZ';               // (pitch and roll about his own axes)
    await d.tween(1.1, (k) => { ramu.model.rotation.z = 0.09 * Math.sin(k * Math.PI * 3) * (1 - k * 0.4); ramu.model.rotation.x = 0.05 * Math.sin(k * Math.PI * 2); });
    // ---- his foot slips: slow, he goes over backward ----
    d.timeScale = 0.3;
    girl.gesture('offer', 'reach', 2);               // her hand out after him, too late
    const close = { pos: at3(onWell(RAIL_A + 0.05, GALLERY.r1 + 0.6), Y + 1.9), look: at3(rail, Y + 1.9), fov: 44 };
    d.shot(close, 0, d.pushIn(close, 0.06));
    ramu.gesture('fall', 1.3);
    await d.tween(0.45, (k) => { ramu.model.rotation.z = 0.06 * (1 - k); ramu.model.rotation.x = 0.35 * k * k; });
    ramu.stopGesture();
    ramu.holdClip('falling');
    // down, back first; the camera falls with him from inside the well, the show going round between
    const fall = jumpIn(ramu, RAIL_A, true);
    let turn = toWell - faceGirl;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    await d.tween(fall.T, (k) => {
      fall.at(k);
      // he twists round as he goes down, to land facing the middle (and the camera)
      const e = Math.min(1, Math.max(0, (k - 0.15) / 0.5));
      ramu.model.rotation.y = faceGirl + turn * e * e * (3 - 2 * e);
      const p = ramu.position, [ix, iz] = fromWell([p.x, p.z]);
      // in from him (toward the middle), a little round the ring, level with him
      d.shot({ pos: v(p.x - ix * 4.6 - iz * 1.3, p.y + 0.5, p.z - iz * 4.6 + ix * 1.3), look: v(p.x, p.y + 0.7, p.z), fov: 50 }, 0);
    });
    d.timeScale = 1;
    ramu.model.rotation.set(0, ramu.model.rotation.y, 0);
    void playSfx('thud', 1);
    ramu.holdClip('fall', true);                 // and then he lies there
    ramu.model.rotation.y = toWell;              // facing the middle: the clip throws him back toward the wall, with room to
    ramu.gesture('fall');
    const p = ramu.position, [ix, iz] = fromWell([p.x, p.z]);
    d.shot({ pos: v(p.x - ix * 1.6 - iz * 2.8, 1.1, p.z - iz * 1.6 + ix * 2.8), look: v(p.x - ix * 0.3, 0.3, p.z - iz * 0.3), fov: 46 }, 0);   // side on, along the wall
    await d.wait(2.4);
    if (d.skipped) return;                       // (skipped: he is laid on the sand below, and the card shown from there)
    // close over his face: a smile; his line; the eyes shut; the card
    onFace();
    await d.wait(0.6);
    if (ramu.face) ramu.face.smile = 1;
    await d.wait(1.1);
    await d.say('ramu', ramu.face, 'bache');
    await d.wait(0.4);
    if (ramu.face) ramu.face.shut = 1;
    await d.wait(2.0);
    shown = true;
    await pass();
  });
  // watched or skipped: down on the sand at the foot of the wall, the candy floss in his hand, the guards at the rail above
  d.timeScale = 1;
  const end = jumpIn(ramu, RAIL_A, true);
  end.at(1);
  ramu.model.rotation.set(0, 0, 0, 'XYZ');
  if (ramu.face) ramu.face.laughing = false;
  held.holder(ramu.model);
  ramu.sitAt(ramu.position.x, ramu.position.y, ramu.position.z, toWell, 'fall');
  ramu.holdClip('fall', true);                   // on his back on the sand
  if (ramu.face) { ramu.face.talking = false; ramu.face.smile = 1; ramu.face.shut = 1; }
  ramu.yaw = toWell + Math.PI;                   // the camera on the well's open side, not in the sand banked up behind him
  if (!shown) await d.scene(async () => { await d.wait(0.05); onFace(); await pass(); });   // skipped: the card over him lying there
  girl.idle();
  girl.place(...girlBack);
  girl.position.y = Y;
  girl.faceTowards(KUAN.x, KUAN.z);
  c.guards.forEach((q, i) => { halt(q); q.floor = null; q.idle(); const [x, z] = onWell(RAIL_A + side(i) * (0.12 + (i % 2) * 0.07), GALLERY.r0 + 0.4); q.place(x, z); q.position.y = Y; q.faceTowards(KUAN.x, KUAN.z); });
}

/**
 The fall from the inner rail at angle `a` into the well, as a path: off the rail a little up (a leap; with `slip`,
 barely, and over backward), then down the wall's face to the sand (`at(k)`, k 0..1 over T seconds). On the way down three of the show (two bikes and a car) are moved
 round the wall so each comes past him just as he is at its height: one under his feet, one over his head, one
 between them and the camera.
*/
function jumpIn(ramu: Ramu, a: number, slip = false): { T: number; at: (k: number) => void } {
  const y0 = GALLERY.y + 1.1, vy = slip ? 0.5 : 1.6, g = 9.8, floor = 0.1;
  const T = (vy + Math.sqrt(vy * vy + 2 * g * (y0 - floor))) / g;
  const r0 = WELL_R + 0.22, r1 = WELL_R - (slip ? 1.9 : 0.75);
  const yAt = (t: number) => y0 + vy * t - 0.5 * g * t * t;
  const at = (k: number) => {
    const t = k * T, r = r0 + (r1 - r0) * Math.min(1, k * 2.5);
    const [x, z] = onWell(a, r);
    ramu.position.set(x, Math.max(floor, yAt(t)), z);
    // the leap: head first, then upright; the slip: over on his back, coming round to upright near the sand
    ramu.model.rotation.x = slip ? 0.35 + 0.75 * Math.sin(Math.min(1, k * 1.25) * Math.PI) - 0.35 * k : -0.35 * Math.sin(Math.min(1, k * 1.4) * Math.PI);
  };
  // when he is at a height (falling): the time
  const when = (y: number) => (vy + Math.sqrt(Math.max(0, vy * vy + 2 * g * (y0 - y)))) / g;
  const show = WELL_SHOW;
  if (show.ride.length && !jumped) {
    jumped = true;
    // [vehicle, where it passes him: his feet above it (+), his head below it (-)]
    for (const [i, dy] of [[0, 0.7], [2, -2.1], [3, 0.6]] as const) {
      const r = show.ride[i], y = r.y0 * show.yk;
      const tHit = show.t + when(y + dy);
      const want = a - 0.02 * Math.sign(r.w);
      show.shift[i] = want - (r.a0 + r.w * tHit);
    }
  }
  return { T, at };
}
let jumped = false;
