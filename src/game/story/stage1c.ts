import * as THREE from 'three';
import type { Ramu } from '../../player/ramu';
import { makeActors, type RigName } from '../../world/actors';
import { Chase } from '../../world/chase';
import { findBone, HandProp } from '../../world/handProp';
import type { Mela, Sammelan } from '../../world/mela';
import { INFLATABLE, KUAN, SAMMELAN, SAMMELAN_GATES } from '../../world/melaSite';
import { GALLERY } from '../../world/mautKuan';
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
   mission 9  hold on: four times his grip slips, Space (or a tap) in time grabs again; a miss drops him (from D again).
              Then a guard has the operator stop the wheel dead, and Ramu is flung into the bouncy castle (F)
   mission 10 G, H, the maut ka kuan's stair, its gallery: he hides among the people at the rail; the guards look and
              miss him; a little girl offers him her candy floss (slow motion); "Woh raha!"; he leaps off the rail, slow
              all the way down, and lands in the dirt with it in his hand. The stage is done.
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
/** where he hides on the gallery, and leaps from: over the ground north-east of the well (no stair below) */
const HIDE_A = 3.75;

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

/** part 2's end: four guards from the sammelan's gates, round the audience, after him; hard, until they have him */
export async function sendGuards(mela: Mela, s: Sammelan, ramu: Ramu): Promise<void> {
  const c = chaseFor(mela, ramu);
  if (c.guards.length) return;
  const { x, z } = ramu.position;
  await c.spawn(4, s.gates, x, z, (gx, gz) => s.route(gx, gz, z));
  c.resetTrail([]);
  c.hard = true;
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

export type Part3From = 'start' | 'wheel' | 'kuan';

export async function stage1Part3(d: Director, ramu: Ramu, mela: Mela, hooks: StoryHooks, from: Part3From = 'start'): Promise<void> {
  const s = await mela.sammelan;
  const c = chaseFor(mela, ramu);
  // the mela's own guards leave him to these four (theirs is a fight: the life bar; this is a chase)
  const hunt = mela.crowd.huntIf;
  mela.crowd.huntIf = () => false;
  if (!c.guards.length) {              // a test start: the guards from the sammelan's gates
    if (from === 'start') ramu.standAt(SAMMELAN.x1 - 4, EAST.z, 0.5);
    await sendGuards(mela, s, ramu);
  }

  if (from === 'start') {
    // ---- mission 6, run: they have him soon enough ----
    let caught = false;
    c.onCatch = () => { caught = true; };
    if (!c.on) { c.resetTrail([]); c.hard = true; c.go(); }
    await d.mission(6, 'm.s1.run', [{ at: null, hint: 'm.s1.run.h1', done: () => caught }]);
    await firstCatch(d, ramu, c, s);
    hooks.step(6);

    // ---- mission 7: A, B, C ----
    await leg(d, ramu, c, 7, 'm.s1.flee', [step(A, 'm.s1.flee.h1', 2.6), step(B, 'm.s1.flee.h2'), step(C, 'm.s1.flee.h3')],
      { at: A, ry: -Math.PI / 2, behind: [[SAMMELAN.x1 - 1.4, EAST.z - 1.2], [SAMMELAN.x1 - 1.4, EAST.z + 1.2], [SAMMELAN.x1 - 2.6, EAST.z], [SAMMELAN.x1 - 3.4, EAST.z + 0.6]] });
    await rockScene(d, ramu, c, mela);
    hooks.step(7);
  }

  // ---- mission 8: D, E, the wheel; mission 9: hold on (a miss: from D again) ----
  if (from !== 'kuan') {
    const fromD = { at: D, ry: 0, behind: [[-149.6, 293], [-148.4, 293.6], [-149.2, 295], [-148.6, 296]] as P2[] };
    let restart = from === 'wheel' ? fromD : { at: LAND_AT, ry: -Math.PI / 2, behind: [[-166, 298.0], [-166.5, 299.2], [-168, 298.4], [-169, 299]] as P2[] };
    if (from === 'wheel') restartAt(ramu, c, fromD);
    for (;;) {
      await leg(d, ramu, c, 8, 'm.s1.wheel', [step(D, 'm.s1.wheel.h1', 3.5), step(E, 'm.s1.wheel.h2', 3.5)], restart);
      hooks.step(8);
      await grabWheel(d, ramu, c, mela);
      if (await holdOn(d, ramu, mela)) break;
      await fell(d, ramu, c, mela, hooks);
      restart = fromD;
      restartAt(ramu, c, fromD);
      await d.fade(0, 0.6);
    }
    hooks.step(9);
    await flung(d, ramu, c, mela);
  } else {
    ramu.standAt(...F, 0);
    ramu.yaw = ramu.facing;
    c.place([[-134, 265.5], [-134.6, 267], [-136, 266], [-136.5, 267.5]]);
    c.resetTrail([[-134, 266]]);
    void d.wait(1.2).then(() => c.go());
  }

  // ---- mission 10: out of the castle, G, H, the well's stair, the gallery ----
  await leg(d, ramu, c, 10, 'm.s1.kuan', [step(F, 'm.s1.kuan.h1', 2.2), step(G, 'm.s1.kuan.h1'), step(H, 'm.s1.kuan.h2'), step(FOOT, 'm.s1.kuan.h3', 3.5),
    { at: LANDING, hint: 'm.s1.kuan.h4', done: () => ramu.position.y > GALLERY.y - 0.6 }],
    { at: F, ry: Math.PI, behind: [[-134, 265.5], [-134.6, 267], [-136, 266], [-136.5, 267.5]] });
  await gallery(d, ramu, c, mela);
  hooks.step(10);
  mela.crowd.huntIf = hunt;
  hooks.done();
}

/** where he comes down after the rock (in front of the stall at C) */
const LAND_AT: P2 = [C[0] + 1.4, C[1] + 3.1];

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

/** the first time they have him (at the stage): held, hit, then he shoves the one in front over and is off */
async function firstCatch(d: Director, ramu: Ramu, c: Chase, s: Sammelan): Promise<void> {
  // facing out toward the sammelan's east gate, the way he will run
  ramu.faceTowards(A[0], A[1]);
  const gs = surround(ramu, c), g = gs[0];
  await d.scene(async () => {
    const two = d.front(ramu, { dist: 2.8, side: 1.6, up: 0.3, drop: 0.35, fov: 46 });
    d.shot(two, 0, d.pushIn(two, 0.05));
    await d.say('guard', g.face, 'gotcha');
    await blows(d, ramu, g);
    await d.say('ramu', ramu.face, 'ouch');
    ramu.gesture('push_one');
    await d.wait(0.45);
    g.gesture('fall', `fl${performance.now()}`, 3.5);
    gs[1].gesture('shove', 'sv1', 1.6);
    gs[2].gesture('shove', 'sv2', 1.6);
    void playSfx('thud', 0.7);
    await d.wait(0.6);
    d.shot(d.front(ramu, { dist: 1.7, side: 0.4, up: 0.05, drop: 0.15, fov: 38 }), 0);
    await d.say('ramu', ramu.face, 'free');
  });
  ramu.stopGesture();
  ramu.yaw = ramu.facing;
  // the one he shoved gets up as the others (staggered back) go after him
  const p = ramu.position;
  for (const q of c.guards) {
    const dx = q.position.x - p.x, dz = q.position.z - p.z, l = Math.hypot(dx, dz) || 1;
    q.place(p.x + (dx / l) * 2.6, p.z + (dz / l) * 2.6);
    q.faceTowards(p.x, p.z);
  }
  g.gesture('get_up', 'gu1', 2.7);
  c.resetTrail([[g.position.x, g.position.z]]);
  c.hard = false;
  void s;
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
  const custAt: [P2, P2] = [[LAND_AT[0] - 0.45, LAND_AT[1] + 0.55], [LAND_AT[0] + 0.5, LAND_AT[1] + 0.45]];
  const [uncle, aunty] = await Promise.all([extra(mela, 'uncle', ...custAt[0], Math.PI), extra(mela, 'aunty', ...custAt[1], Math.PI)]);
  const g = c.guards[0];
  g.place(run0[0] - 8.5, run0[1] + 0.3, -Math.PI / 2);
  c.guards.slice(1).forEach((q, i) => q.place(run0[0] - 11 - i * 1.3, run0[1] + (i - 1) * 1.1, -Math.PI / 2));
  for (const q of c.guards) { q.position.y = 0.05; q.idle(); }
  const stone = rock(), held = new HandProp(stone, 'palm');
  mela.group.add(stone);
  held.holder(g.actor.root);
  props.push(held);
  ramu.sitAt(run0[0], 0.05, run0[1], -Math.PI / 2, 'idle');
  const tilt = (k: number) => { ramu.model.rotation.x = k; };
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
    // off his feet, over and down onto the two at the stall
    ramu.holdClip('falling');
    ramu.model.rotation.y = Math.atan2(-(LAND_AT[0] - run1[0]), -(LAND_AT[1] - run1[1]));
    await d.tween(0.75, (k) => {
      ramu.position.set(run1[0] + (LAND_AT[0] - run1[0]) * k, 0.05 + Math.sin(k * Math.PI) * 1.3 + (1 - k) * 0.2, run1[1] + (LAND_AT[1] - run1[1]) * k);
      tilt(-1.2 * k);
      stone.position.y = Math.max(0.08, stone.position.y - 0.08);
    });
    uncle.gesture('fall', 'cf1', 4);
    aunty.gesture('fall2', 'cf2', 4);
    void playSfx('thud', 1);
    tilt(0);
    ramu.holdClip('idle');
    ramu.gesture('fall2');
    d.shot({ pos: v(LAND_AT[0] + 3.2, 1.3, LAND_AT[1] - 2.6), look: v(LAND_AT[0], 0.4, LAND_AT[1] + 0.3), fov: 46 }, 0);
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
  tilt(0);
  ramu.stopGesture();
  ramu.standUp(LAND_AT[0] - 0.4, LAND_AT[1] - 1.2, 0.5);
  ramu.model.rotation.y = 0;
  ramu.yaw = 0;
  held.holder(null);
  stone.position.set(run1[0] + 0.6, 0.08, run1[1] + 0.3);
  for (const p of [uncle, aunty]) { p.idle(); p.face.angry = 0.6; p.faceTowards(LAND_AT[0], LAND_AT[1] - 1.2); }
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

/** at E: he runs at the wheel, jumps for a cabin coming up and it lifts him off his feet; the guards jump for his feet */
async function grabWheel(d: Director, ramu: Ramu, c: Chase, mela: Mela): Promise<void> {
  const w = mela.giant;
  c.stop();
  hangFrom(mela, ramu);
  w.speed = 0.05;                                          // (the scene's own pace: slow enough to jump for)
  // the cabin on the rising (west) side whose floor is lowest above 1.6 m
  let best: THREE.Object3D | null = null, by = Infinity;
  for (const cb of w.cabins) {
    const p = gripOf(cb);
    if (p.x < w.hub.x - 0.5 && p.y > 1.5 && p.y < by) { by = p.y; best = cb; }
  }
  const cabin = best ?? w.cabins[0];
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
  });
  // watched or skipped: hanging from the cabin, on the way up, the guards beneath shaking their fists
  hanging.cabin = cabin; hanging.slip = 0; hanging.w = 1;
  ramu.holdClip('hang_idle');
  w.speed = 0.2;
  for (const q of c.guards) { q.driven = null; q.idle(); q.faceTowards(ramu.position.x, ramu.position.z); }
}

/** the camera beside him on the wheel (he is the player's to keep up there): this frame's shot */
function wheelCam(d: Director, ramu: Ramu, mela: Mela): void {
  const p = ramu.position, h = mela.giant.hub;
  const out = Math.sign(p.x - h.x) || -1;
  d.shot({ pos: v(p.x + out * 2.4, p.y + 1.1, p.z + 6.6), look: v(p.x, p.y + 0.45, p.z), fov: 50 }, 0);
}

/** four slips: true if he grabbed every time */
async function holdOn(d: Director, ramu: Ramu, mela: Mela): Promise<boolean> {
  const ui = new GripPrompt();
  let following = true;
  void d.until(() => { if (following && hanging.cabin) wheelCam(d, ramu, mela); return !following; });
  d.locked = true;                                      // (he is held; the keys are for the grip)
  d.box.set(9, 'm.s1.hold', 'm.s1.hold.h1', null);
  try {
    for (let i = 0; i < 4; i++) {
      await d.wait(i ? 1.3 + Math.random() * 0.5 : 1.0);
      // the grip goes: his hands slide down the edge
      ramu.gesture('hang_drop', 2.2);
      void d.tween(0.5, (k) => { hanging.slip = 0.12 * k; });
      const ok = await ui.grab(i < 2 ? 1.5 : 1.25);
      if (!ok) return false;
      ramu.stopGesture();
      ramu.gesture('hang_braced', 1.4);
      void d.tween(0.4, (k) => { hanging.slip = 0.12 * (1 - k); });
      void playSfx('thud', 0.25);
    }
    await d.wait(0.8);
    return true;
  } finally {
    following = false;
    ui.dispose();
    d.box.clear();
    d.locked = false;
  }
}

/** a miss: he drops from the cabin; a fade */
async function fell(d: Director, ramu: Ramu, c: Chase, mela: Mela, hooks: StoryHooks): Promise<void> {
  const from = ramu.position.clone();
  hanging.cabin = null;
  await d.scene(async () => {
    ramu.holdClip('falling');
    d.shot({ pos: v(from.x + 3, Math.max(2, from.y * 0.5), from.z + 9), look: v(from.x, from.y * 0.5, from.z), fov: 55 }, 0);
    const T = Math.max(0.5, Math.sqrt((2 * Math.max(0.2, from.y)) / 9.8));
    await d.tween(T, (k) => { ramu.position.set(from.x, Math.max(0.08, from.y - 0.5 * 9.8 * (k * T) ** 2), from.z + k * 0.6); });
    void playSfx('thud', 1);
    ramu.holdClip('idle');
    ramu.gesture('fall');
    await d.wait(1.2);
    await d.fade(1, 0.6);
  });
  await d.fade(1, 0);
  mela.giant.speed = 0.22;
  hooks.note('story.s1.fell');
  c.stop();
}

/** a guard has the operator stop the wheel dead; Ramu is flung off it, over the stalls, into the bouncy castle */
async function flung(d: Director, ramu: Ramu, c: Chase, mela: Mela): Promise<void> {
  const w = mela.giant, op = mela.wheelMan;
  const at = new THREE.Vector3(), bounce = v(INFLATABLE.x + 0.4, 0.46, INFLATABLE.z - 0.3);
  w.speed = 0.05;                                         // (he slows it as he sees them coming)
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
    // the wheel stops dead: he goes on without it
    w.speed = 0;
    hanging.cabin = null;
    at.copy(ramu.position);
    ramu.holdClip('falling');
    const mid = at.clone().lerp(bounce, 0.5);
    d.shot({ pos: v(mid.x - 2, 9, mid.z + 27), look: v(mid.x, 6, mid.z), fov: 55 }, 0);
    const T = 2.0, peak = 4.5;
    await d.tween(T, (k) => {
      ramu.position.lerpVectors(at, bounce, k);
      ramu.position.y += Math.sin(k * Math.PI) * peak;
      ramu.model.rotation.x = -k * Math.PI * 2.2;
      ramu.model.rotation.y = -Math.PI / 2;
    });
    ramu.model.rotation.x = 0;
    void playSfx('thud', 0.6);
    // boing, boing, boing
    d.shot({ pos: v(bounce.x - 4.5, 6.8, bounce.z + 6.5), look: v(bounce.x, 1.0, bounce.z), fov: 48 }, 0);
    for (const [h, t] of [[2.0, 0.75], [0.9, 0.5], [0.35, 0.3]]) {
      await d.tween(t, (k) => { ramu.position.set(bounce.x, bounce.y + Math.sin(k * Math.PI) * h, bounce.z); });
    }
    ramu.holdClip('idle');
    ramu.gesture('get_up');
    await d.wait(2.5);
    d.shot(d.front(ramu, { dist: 1.8, side: 0.4, up: 0.1, drop: 0.15, fov: 40 }), 0);
    await d.say('ramu', ramu.face, 'boing');
  });
  // watched or skipped: on his feet on the castle's floor, the wheel stopped (it goes again a little later), the guards
  // coming from the wheel
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

/** along the gallery's ring (not across the well) from angle a0 to a1 (going the shorter way), at `speed` */
async function round(d: Director, p: Person, a0: number, a1: number, speed: number): Promise<void> {
  let da = a1 - a0;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  const n = Math.max(1, Math.ceil(Math.abs(da) / 0.15)), r = (GALLERY.r0 + GALLERY.r1) / 2;
  for (let i = 1; i <= n; i++) {
    p.walkTo(...onWell(a0 + (da * i) / n, r), speed);
    await d.until(() => !p.walking);
    if (d.skipped || !d.locked) return;              // (the scene is over: they are put where it leaves them)
  }
}

async function gallery(d: Director, ramu: Ramu, c: Chase, mela: Mela): Promise<void> {
  c.stop();
  const Y = GALLERY.y - 0.01;
  const hide = onWell(HIDE_A, GALLERY.r0 + 0.45), girlAt = onWell(HIDE_A + 0.075, GALLERY.r0 + 0.45);
  const rail = onWell(HIDE_A, GALLERY.r1 - 0.05), down = onWell(HIDE_A, GALLERY.r1 + 4.2);
  const toWell = Math.atan2(-(KUAN.x - hide[0]), -(KUAN.z - hide[1]));
  const outward = toWell + Math.PI;
  const girl = await extra(mela, 'girl', girlAt[0], girlAt[1], toWell + 0.9, 0.66);
  girl.position.y = Y;
  const floss = candyFloss(), held = new HandProp(floss, 'mic', 0.05);
  mela.group.add(floss);
  held.holder(girl.actor.root);
  props.push(held);
  // the guards on the stair, coming up
  const onStair = (i: number): [number, number, number] => { const a = GALLERY.a1 + 0.25 + i * 0.09; const [x, z] = onWell(a, STAIR_R); return [x, stairY(a), z]; };
  await d.scene(async () => {
    ramu.sitAt(hide[0], Y, hide[1], toWell, 'crouch');
    c.guards.forEach((q, i) => { const [x, y, z] = onStair(i); q.place(x, z); q.position.y = y; q.faceTowards(...LANDING); });
    // the guards come up onto the gallery and look about
    const [lx, lz] = LANDING;
    d.shot({ pos: v(lx + 2.5, Y + 2.6, lz + 3), look: v(lx, Y + 1, lz), fov: 50 }, 0);
    c.guards.forEach((q, i) => { q.floor = () => Math.max(q.position.y, Y); q.walkTo(...onWell(GALLERY.a1 + 0.05 - i * 0.12, (GALLERY.r0 + GALLERY.r1) / 2 + (i % 2 ? 0.4 : -0.3)), 2.6); });
    await d.wait(2.0);
    c.guards.forEach((q, i) => q.gesture('look_around', `la${i}`, 3));
    await d.say('guard', c.guards[1].face, 'kahan');
    // him, crouched among the people at the rail; the girl beside him holds out her candy floss: slow
    d.shot(d.front(ramu, { dist: 1.9, side: -0.9, up: 0.05, drop: 0.2, fov: 40 }), 0);
    await d.wait(0.8);
    d.timeScale = 0.45;
    girl.faceTowards(hide[0], hide[1]);
    await d.wait(0.6);
    // from over the well (nothing between): the two of them at the rail
    const two = { pos: at3(onWell(HIDE_A + 0.04, GALLERY.r0 - 2.0), Y + 1.25), look: at3(onWell(HIDE_A + 0.04, GALLERY.r0 + 0.45), Y + 0.75), fov: 36 };
    d.shot(two, 0, d.pushIn(two, 0.06));
    await d.say('girl', girl.face, 'khaoge');
    held.holder(ramu.model);
    if (ramu.face) ramu.face.laughing = true;
    d.shot(d.front(ramu, { dist: 1.3, side: 0.5, up: 0.0, drop: 0.15, fov: 34 }), 0);
    await d.say('ramu', ramu.face, 'shrota');
    girl.face.laughing = true;
    await d.wait(0.8);
    d.timeScale = 1;
    // seen
    const g = c.guards[1];
    g.faceTowards(hide[0], hide[1]);
    g.gesture('angry_point', 'wr', 1.8);
    d.shot(d.front(g, { dist: 2.2, side: 0.5, up: 0.1, drop: 0.2, fov: 40 }), 0);
    await d.say('guard', g.face, 'wohraha');
    c.guards.forEach((q, i) => void round(d, q, GALLERY.a1 + 0.05 - i * 0.12, HIDE_A - 0.2 - i * 0.06, 3.8));
    // up, onto the rail, and over
    if (ramu.face) ramu.face.laughing = false;
    ramu.holdClip('idle');
    ramu.model.rotation.y = outward;
    d.shot({ pos: at3(onWell(HIDE_A + 0.35, GALLERY.r1 + 2.5), Y + 1.6), look: v(rail[0], Y + 1.3, rail[1]), fov: 48 }, 0);
    await d.tween(0.5, (k) => ramu.position.set(hide[0] + (rail[0] - hide[0]) * k, Y + 1.0 * Math.sin(k * Math.PI / 2), hide[1] + (rail[1] - hide[1]) * k));
    ramu.position.y = Y + 1.05;
    await d.wait(0.35);
    // the leap: slow, all the way down
    d.timeScale = 0.3;
    ramu.holdClip('falling');
    const top = ramu.position.clone(), T = 1.75;
    d.shot({ pos: at3(onWell(HIDE_A - 0.6, GALLERY.r1 + 7.5), 3.5), look: at3(onWell(HIDE_A, GALLERY.r1 + 2.5), 9.0), fov: 54 }, 0);
    await d.tween(T, (k) => {
      ramu.position.set(top.x + (down[0] - top.x) * k, top.y + 1.2 * Math.sin(Math.min(1, k * 2.2) * Math.PI / 2) * (1 - k) - (top.y - 0.05) * k * k, top.z + (down[1] - top.z) * k);
      ramu.model.rotation.x = -0.5 * Math.sin(k * Math.PI);
    });
    d.timeScale = 1;
    ramu.model.rotation.x = 0;
    ramu.position.y = 0.05;
    void playSfx('thud', 1);
    ramu.holdClip('idle');
    ramu.gesture('fall');
    d.shot({ pos: v(down[0] + 1.8, 0.7, down[1] + 1.6), look: v(down[0], 0.3, down[1]), fov: 42 }, 0);
    await d.wait(1.6);
    await d.say('ramu', ramu.face, 'bache');
    await d.wait(0.6);
  });
  // watched or skipped: down in the dirt north-east of the well, the candy floss still in his hand
  d.timeScale = 1;
  ramu.model.rotation.x = 0;
  if (ramu.face) ramu.face.laughing = false;
  held.holder(ramu.model);
  ramu.stopGesture();
  ramu.standUp(down[0], down[1], 0.5);
  ramu.model.rotation.y = outward;
  ramu.yaw = outward;
  for (const q of c.guards) { q.floor = null; q.idle(); }
  c.guards.forEach((q, i) => { const [x, z] = onWell(HIDE_A - 0.05 + i * 0.05, GALLERY.r1 - 0.4); q.place(x, z); q.position.y = Y; q.faceTowards(down[0], down[1]); });
}

