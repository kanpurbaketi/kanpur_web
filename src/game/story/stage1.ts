import type { Ramu } from '../../player/ramu';
import { GATE, inMela } from '../../world/melaSite';
import { STATUE } from '../../world/stage1Site';
import type { VendorSpot } from '../../world/vendors';
import type { Director } from './director';
import { playSfx } from './sfx';

/*
 Stage 1, part 1 (plans/08-stage1-part1.md). Built so far:
   beat 1   at the chowk: a growl, his hand to his stomach, "Bhaukal bhookh lagi hai..."
   mission 1  find something to eat: through the Shivaji Putla gate, down the park road, right at the Nagar Nigam, to the carts
   (for now) mission 2  into the mela at its gate, which completes the stage. The samosa scene and the queue come next.
 hooks.step(n) is called as each mission is done (recorded for the admin), hooks.done() at the end.
*/

export interface StoryHooks { step(n: number): void; done(): void }

const CART_R = 4.5;

export async function stage1(d: Director, ramu: Ramu, carts: VendorSpot[], hooks: StoryHooks): Promise<void> {
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
  const near = (x: number, z: number) => carts.some((c) => Math.hypot(c.x - x, c.z - z) < CART_R);
  const cart = carts[0] ?? { x: GATE.x, z: GATE.z - 8 };
  await d.mission(1, 'm.s1.food', [
    { at: [STATUE[0] - 2, 58], hint: 'm.s1.food.h1', done: (_x, z) => z > 58 },
    { at: [-42, 330], hint: 'm.s1.food.h2', done: (_x, z) => z > 318 },
    { at: [-90, 340], hint: 'm.s1.food.h3', done: (x, z) => (z > 318 && x < -75) || near(x, z) },
    { at: [cart.x, cart.z], hint: 'm.s1.food.h4', done: near },
  ]);
  hooks.step(1);

  // ---- (for now) mission 2: into the mela ----
  await d.mission(2, 'm.s1.mela', [{ at: [GATE.x, GATE.z], hint: 'm.s1.mela.h1', done: inMela }]);
  hooks.step(2);
  hooks.done();
}

/** how many missions the introduction lists */
export const STAGE1_STEPS = 2;
