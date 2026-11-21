import type { Ramu } from '../../player/ramu';
import * as THREE from 'three';
import type { GateQueue } from '../../world/gateQueue';
import { GATE, inMela, TEAR } from '../../world/melaSite';
import { STATUE } from '../../world/stage1Site';
import type { CartKeepers, Keeper } from '../../world/cartKeepers';
import type { Director } from './director';
import { playSfx } from './sfx';
import type { Sammelan } from '../../world/mela';
import { stage1Part2 } from './stage1b';

/*
 Stage 1, part 1 (plans/08-stage1-part1.md). Built so far:
   beat 1   at the chowk: a growl, his hand to his stomach, "Bhaukal bhookh lagi hai..."
   mission 1  find something to eat: through the Shivaji Putla gate, down the park road, right at the Nagar Nigam, to the carts
   beats 3-4  at whichever cart he walks up to: "Bhaiya, ek samosa chaat lagao", the keeper turns him away ("Daud jao..."),
              Ramu scowls, throws up his hands and turns away; any keeper he goes back to after that: "Pehle udhaar chukao!"
   mission 2  the mela's main gate: a line for tickets, roped off, a guard at the gap; at its end, E to stand in line
   beats 9-12 in line; a cut and he is at the front: "Ticket??" / "Haan laaye the, kahaan rakh diya..." (his pockets);
              the guard shoves him aside with one hand: "Arre bilkul guru, dhoondh lo aaram se, mil jaye toh aa jaana."
              Back at the gap later: "Ticket mila? Nahi? Toh side ho jao."
   mission 3  another way in: the maps show a search area round the torn sheet on the west wall, not the spot, and it
              closes in after 90 s without getting nearer; the hint sharpens as he does (the cloth wall, its west side,
              there). Through the sheet (the only way in now) ends part 1, recorded as the stage's progress; part 2 (stage1b.ts)
   goes on inside.
 hooks.step(n) is called as each mission is done (recorded for the admin), hooks.done() at the end.
*/

export interface StoryHooks { step(n: number): void; done(toastKey?: string): void }

const CART_R = 4.5;

export async function stage1(d: Director, ramu: Ramu, keepers: CartKeepers, queue: GateQueue, sammelan: Promise<Sammelan> | null, hooks: StoryHooks): Promise<void> {
  // ---- beat 1: hungry at the chowk ----
  await d.scene(async () => {
    await d.wait(0.3);
    const wide = d.front(ramu, { dist: 2.5, side: 0.7, up: 0.05, drop: 0.3, fov: 42 });
    d.shot(wide, 1.1, d.pushIn(wide, 0.15));
    await d.wait(1.0);
    void playSfx('stomach');
    ramu.gesture('stomach');
    await d.wait(1.6);
    const close = d.front(ramu, { dist: 1.45, side: 0.38, up: 0, drop: 0.2, fov: 35 });
    d.shot(close, 0.7, d.pushIn(close, 0.03));
    await d.wait(0.5);
    await d.say('ramu', ramu.face, 'hungry');
    await d.wait(0.3);
  });
  ramu.stopGesture();

  // ---- mission 1: find something to eat ----
  const near = (x: number, z: number) => keepers.keepers.some((k) => Math.hypot(k.cart.x - x, k.cart.z - z) < CART_R);
  const first = keepers.keepers[0]?.front ?? { x: GATE.x, y: GATE.z - 8 };
  await d.mission(1, 'm.s1.food', [
    { at: [STATUE[0] - 2, 58], hint: 'm.s1.food.h1', done: (_x, z) => z > 58 },
    { at: [-42, 330], hint: 'm.s1.food.h2', done: (_x, z) => z > 318 },
    { at: [-90, 340], hint: 'm.s1.food.h3', done: (x, z) => (z > 318 && x < -75) || near(x, z) },
    { at: [first.x, first.y], hint: 'm.s1.food.h4', done: (x, z) => keepers.at(x, z) !== null },
  ]);

  // ---- beats 3-4: "ek samosa chaat", turned away ----
  const keeper = keepers.at(ramu.position.x, ramu.position.z, 9) ?? keepers.keepers[0];
  if (keeper) await samosa(d, ramu, keeper);
  hooks.step(1);
  void refusals(d, ramu, keepers);

  // ---- mission 2: the mela's main gate, and the line ----
  const back = () => { const [x, z] = queue.backSpot(); return Math.hypot(ramu.position.x - x, ramu.position.z - z); };
  let joined = false;
  d.prompt = { key: 'act.line', when: () => back() < 2.2, act: () => { joined = true; } };
  const [bx, bz] = queue.backSpot();
  await d.mission(2, 'm.s1.gate', [
    { at: [bx, bz], hint: 'm.s1.gate.h1', done: () => back() < 2.2 || joined },
    { at: [bx, bz], hint: 'm.s1.gate.h2', done: () => joined },
  ]);
  d.prompt = null;
  await ticket(d, ramu, queue);
  hooks.step(2);
  void turnedBack(d, ramu, queue);

  // ---- mission 3: another way in ----
  const search = searchArea(ramu);
  await d.mission(3, 'm.s1.way', [{ at: search.at, hint: search.hint, radius: search.radius, done: (x, z) => { search.tick(); return inMela(x, z); } }]);
  hooks.step(3);
  if (sammelan) await stage1Part2(d, ramu, sammelan, hooks);
  else hooks.done('story.s1.part1');
}

/**
 Where to look for the torn sheet: a circle round it (not centred on it: the map should not give the spot away) that
 closes in each time 90 s go by without his getting 5 m nearer; and the hint, by how near he is.
*/
function searchArea(ramu: Ramu) {
  const RADII = [40, 24, 13], OFF: [number, number] = [14, -15];
  let level = 0, best = Infinity, since = 0, last = performance.now();
  const dist = () => Math.hypot(ramu.position.x - TEAR.x, ramu.position.z - TEAR.z);
  return {
    radius: () => RADII[level],
    at: (): [number, number] => {
      if (dist() < 12) return [TEAR.x, TEAR.z];                    // found: no more hiding it
      const k = RADII[level] / RADII[0];
      return [TEAR.x + OFF[0] * k, TEAR.z + OFF[1] * k];
    },
    hint: () => { const m = dist(); return m < 12 ? 'm.s1.way.h3' : m < 60 ? 'm.s1.way.h2' : 'm.s1.way.h1'; },
    /** every frame (game time: paused menus do not count) */
    tick: () => {
      const now = performance.now(), dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const m = dist();
      if (m < best - 5) { best = m; since = 0; return; }
      if ((since += dt) > 90 && level < RADII.length - 1) { level++; since = 0; }
    },
  };
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** beats 9-12: in line, at the front, no ticket, pushed aside */
async function ticket(d: Director, ramu: Ramu, q: GateQueue): Promise<void> {
  const guard = q.guard, rest = guard.facing, post: [number, number] = [guard.position.x, guard.position.z];
  let aside: [number, number] = [0, 0];
  await d.scene(async () => {
    // he steps in at the end of the line, facing the gate
    const [bx, bz] = q.backSpot();
    q.hold = true;
    ramu.standAt(bx, bz);
    ramu.faceTowards(bx, bz - 5);
    d.shot({ pos: v3(bx + 3.4, 1.75, bz + 0.6), look: v3(bx - 0.2, 1.25, bz - 2.2), fov: 48 }, 0);
    await d.wait(2.2);
    // a cut: the line has moved on, he is at the front
    const [fx, fz] = q.ramuFirst();
    ramu.standAt(fx, fz);
    ramu.faceTowards(guard.position.x, guard.position.z);
    guard.faceTowards(fx, fz);
    const gp = guard.position;
    d.shot({ pos: v3(fx + 2.8, 1.7, fz + 1.6), look: v3((fx + gp.x) / 2, 1.35, (fz + gp.z) / 2), fov: 42 }, 0);
    await d.wait(1.2);
    // (from a little above: his eyes are under the cap's brim)
    const g = d.front(guard, { dist: 1.85, side: 0.7, up: 0.1, drop: 0.3, fov: 36 });
    d.shot(g, 0, d.pushIn(g, 0.02));
    await d.wait(0.3);
    await d.say('guard', guard.face, 'ticket');
    // his pockets
    // his pockets: from the side, wide enough for the search (the clip turns him about)
    d.shot({ pos: v3(fx + 2.3, 1.45, fz + 0.5), look: v3(fx, 1.1, fz), fov: 40 }, 0);
    const search = ramu.gesture('pockets');
    await d.wait(0.3);
    await d.say('ramu', ramu.face, 'pockets');
    await d.wait(Math.max(0, Math.min(1.5, search - 3)));
    // the shove: one hand, Ramu staggers out of the line
    ramu.stopGesture();
    const dx = fx - gp.x, dz = fz - gp.z, dl = Math.hypot(dx, dz) || 1;
    aside = [fx + (dx / dl) * 2.1, fz + (dz / dl) * 2.1];
    // from inside the gate, over the rope: the guard's arm, Ramu sent out of the line behind him
    d.shot({ pos: v3(fx + 1.1, 1.75, GATE.z - 2.6), look: v3(fx + 0.4, 1.05, fz + 0.6), fov: 48 }, 0);
    // he steps in as he draws his arm back (from his post his hand would stop short), and the hand lands at ~0.45 s
    guard.gesture('push_one', 'shove', 1.6);
    const reach: [number, number] = [fx - (dx / dl) * 0.72, fz - (dz / dl) * 0.72];
    await d.tween(0.3, (k) => guard.place(post[0] + (reach[0] - post[0]) * k, post[1] + (reach[1] - post[1]) * k));
    await d.wait(0.24);
    ramu.gesture('shove');
    const sx = fx, sz = fz;
    await d.tween(0.9, (k) => {
      const e = 1 - (1 - k) * (1 - k);
      ramu.standAt(sx + (aside[0] - sx) * e, sz + (aside[1] - sz) * e);
    });
    await d.wait(0.3);
    guard.faceTowards(aside[0], aside[1]);
    const g2 = d.front(guard, { dist: 1.9, side: 0.65, up: 0.1, drop: 0.3, fov: 37 });
    d.shot(g2, 0);
    await d.say('guard', guard.face, 'aside');
    if (ramu.face) ramu.face.angry = 1.2;
    const r2 = d.front(ramu, { dist: 1.5, side: 0.45, up: 0, drop: 0.2, fov: 36 });
    d.shot(r2, 0);
    await d.wait(1.4);
  });
  // watched or skipped: Ramu out of the line, the line going on, the guard back to it
  ramu.stopGesture();
  ramu.standAt(aside[0], aside[1]);
  q.release();
  guard.idle();
  guard.walkTo(post[0], post[1], 0.8);                     // back to his post by the gap
  void d.until(() => !guard.walking).then(() => guard.turn(rest));
  ramu.faceTowards(ramu.position.x, ramu.position.z - 5);   // facing the gate he cannot go through, the camera behind him
  ramu.yaw = ramu.facing;
  void d.wait(2.5).then(() => { if (ramu.face) ramu.face.angry = 0; });
}

/** back at the gap without a ticket, the guard has a word in passing */
async function turnedBack(d: Director, ramu: Ramu, q: GateQueue): Promise<void> {
  const near = () => { const [x, z] = q.gap; return Math.hypot(ramu.position.x - x, ramu.position.z - z) < 1.9; };
  for (;;) {
    await d.until(() => !near());
    await d.until(() => near() && !d.locked);
    q.guard.faceTowards(ramu.position.x, ramu.position.z);
    await d.say('guard', q.guard.face, 'again');
    q.guard.turn(q.guard.towards(...q.slot(0)));
  }
}

async function samosa(d: Director, ramu: Ramu, k: Keeper): Promise<void> {
  await d.scene(async () => {
    // Ramu at the cart's front, facing the keeper, who looks up at him
    const kp = k.position;
    ramu.standAt(k.front.x, k.front.y);
    ramu.faceTowards(kp.x, kp.z);
    k.faceTowards(k.front.x, k.front.y);
    const ask = d.front(ramu, { dist: 1.45, side: -0.42, up: 0, drop: 0.2, fov: 35 });
    d.shot(ask, 0, d.pushIn(ask, 0.03));
    await d.wait(0.5);
    await d.say('ramu', ramu.face, 'samosa');
    await d.wait(0.2);
    // the keeper: no (from beside the cart, three-quarters on: from in front of him its boards and goods stand in the way)
    const no = d.front(k, { dist: 0.7, side: 1.7, up: 0, drop: 0.14, fov: 36 });
    d.shot(no, 0, d.pushIn(no, 0.03));
    await d.wait(0.35);
    k.gesture('head_no', 'samosa-no');
    k.face.angry = 0.5;
    await d.say('keeper', k.face, 'refuse');
    // Ramu: a scowl, his hands thrown up, and he turns his back on the cart
    d.shot(ask, 0, d.pushIn(ask, 0.02));
    if (ramu.face) ramu.face.angry = 1.5;            // (past the key's full: it reads at night, at this distance)
    await d.wait(0.9);
    // from the road behind him (in front of him is the cart): he throws up his hands, then turns round to us
    const wide = d.front(ramu, { dist: -2.7, side: 1.0, up: 0.35, drop: 0.45, fov: 45 });
    d.shot(wide, 0.6);
    const len = ramu.gesture('disappointed');
    await d.wait(Math.min(2.4, len || 1.6));
    ramu.stopGesture();
    await d.wait(0.2);
    // he turns his back on the cart (over half a second, not at once)
    const from = ramu.facing;
    turnAway(ramu, kp.x, kp.z);
    const to = ramu.facing, turn = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    const p = ramu.position;
    await d.tween(0.5, (k) => { const a = from + turn * k * k * (3 - 2 * k); ramu.faceTowards(p.x - Math.sin(a), p.z - Math.cos(a)); });
    await d.wait(0.4);
  });
  // whether watched or skipped: he ends up turned away, the keeper back at his cart, the scowl fading
  const kp = k.position;
  ramu.stopGesture();
  ramu.yaw = turnAway(ramu, kp.x, kp.z);
  k.facing = k.rest;
  k.idle();
  k.face.angry = 0;
  void d.wait(3).then(() => { if (ramu.face) ramu.face.angry = 0; });
}

/**
 He turns his back on the cart at (kx, kz), half towards the mela's gate along the road. Gives the camera's way to look
 when it comes back: along the road to the gate (straight behind him would be in the cart's canopy).
*/
function turnAway(ramu: Ramu, kx: number, kz: number): number {
  const p = ramu.position;
  let ax = p.x - kx, az = p.z - kz;
  const al = Math.hypot(ax, az) || 1;
  ax /= al; az /= al;
  let lx = -az, lz = ax;                                  // along the cart row
  if (lx * (GATE.x - p.x) + lz * (GATE.z - p.z) < 0) { lx = -lx; lz = -lz; }
  ramu.faceTowards(p.x + (ax + lx) * 3, p.z + (az + lz) * 3);
  return Math.atan2(-lx, -lz);
}

/** after the samosa scene, any keeper Ramu walks up to again turns him away in passing (no cutscene) */
async function refusals(d: Director, ramu: Ramu, keepers: CartKeepers): Promise<void> {
  for (;;) {
    // away from every cart first, then up to one
    await d.until(() => keepers.at(ramu.position.x, ramu.position.z, 3.5) === null);
    let k: Keeper | null = null;
    await d.until(() => (k = keepers.at(ramu.position.x, ramu.position.z, 2.2)) !== null && !d.locked);
    const kk = k as Keeper | null;
    if (!kk) continue;
    kk.faceTowards(ramu.position.x, ramu.position.z);
    kk.gesture('head_no', `no-${Date.now()}`);
    await d.say('keeper', kk.face, 'payfirst');
    kk.facing = kk.rest;
    kk.idle();
  }
}

/** how many missions the introduction lists */
export const STAGE1_STEPS = 6;
