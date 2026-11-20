import type { Ramu } from '../../player/ramu';
import { GATE, inMela } from '../../world/melaSite';
import { STATUE } from '../../world/stage1Site';
import type { CartKeepers, Keeper } from '../../world/cartKeepers';
import type { Director } from './director';
import { playSfx } from './sfx';

/*
 Stage 1, part 1 (plans/08-stage1-part1.md). Built so far:
   beat 1   at the chowk: a growl, his hand to his stomach, "Bhaukal bhookh lagi hai..."
   mission 1  find something to eat: through the Shivaji Putla gate, down the park road, right at the Nagar Nigam, to the carts
   beats 3-4  at whichever cart he walks up to: "Bhaiya, ek samosa chaat lagao", the keeper turns him away ("Daud jao..."),
              Ramu scowls, throws up his hands and turns away; any keeper he goes back to after that: "Pehle udhaar chukao!"
   mission 2  the mela's main gate (for now going in completes the stage; the queue and the guard come next)
 hooks.step(n) is called as each mission is done (recorded for the admin), hooks.done() at the end.
*/

export interface StoryHooks { step(n: number): void; done(): void }

const CART_R = 4.5;

export async function stage1(d: Director, ramu: Ramu, keepers: CartKeepers, hooks: StoryHooks): Promise<void> {
  // ---- beat 1: hungry at the chowk ----
  await d.scene(async () => {
    await d.wait(0.3);
    const wide = d.front(ramu, { dist: 2.5, side: 0.7, up: 0.05, drop: 0.3, fov: 42 });
    d.shot(wide, 1.1, d.pushIn(wide, 0.15));
    await d.wait(1.0);
    void playSfx('stomach');
    ramu.gesture('stomach');
    await d.wait(1.6);
    const close = d.front(ramu, { dist: 1.0, side: 0.28, up: 0.02, drop: -0.07, fov: 35 });
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

  // ---- mission 2: the mela's main gate (for now in at it ends the stage) ----
  await d.mission(2, 'm.s1.gate', [{ at: [GATE.x, GATE.z], hint: 'm.s1.gate.h1', done: inMela }]);
  hooks.step(2);
  hooks.done();
}

async function samosa(d: Director, ramu: Ramu, k: Keeper): Promise<void> {
  await d.scene(async () => {
    // Ramu at the cart's front, facing the keeper, who looks up at him
    const kp = k.position;
    ramu.standAt(k.front.x, k.front.y);
    ramu.faceTowards(kp.x, kp.z);
    k.faceTowards(k.front.x, k.front.y);
    const ask = d.front(ramu, { dist: 1.05, side: -0.3, up: 0.02, drop: -0.07, fov: 35 });
    d.shot(ask, 0, d.pushIn(ask, 0.03));
    await d.wait(0.5);
    await d.say('ramu', ramu.face, 'samosa');
    await d.wait(0.2);
    // the keeper: no
    const no = d.front(k, { dist: 1.15, side: 0.3, up: 0.02, drop: -0.06, fov: 35 });
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
    turnAway(ramu, kp.x, kp.z);
    await d.wait(0.6);
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
export const STAGE1_STEPS = 2;
