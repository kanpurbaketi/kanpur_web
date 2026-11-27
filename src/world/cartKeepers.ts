import * as THREE from 'three';
import { type Actor, makeActors } from './actors';
import { Person } from './person';
import { cartRadius, type VendorSpot } from './vendors';

/*
 Stage 1's food carts by the mela (Stage1Route.stalls, marked `live`) get their keepers as rigged people, so the story can
 turn one to Ramu and have him talk (src/game/story/stage1.ts). Each stands behind his cart, as the still figures do
 elsewhere (vendors.ts), facing the road; idle, breathing, blinking. A paan wala sits out of sight in his gumti: none there.
 Only the ones near Ramu are animated.
*/

export class Keeper extends Person {
  /** where somebody buying stands, in front of the cart */
  readonly front: THREE.Vector2;
  readonly rest: number;

  constructor(actor: Actor, readonly cart: VendorSpot, x: number, y: number, z: number, ry: number, front: [number, number]) {
    super(actor, x, y, z, ry);
    this.rest = ry;
    this.front = new THREE.Vector2(...front);
  }
}

export class CartKeepers {
  readonly group = new THREE.Group();
  readonly keepers: Keeper[] = [];

  static async create(carts: VendorSpot[]): Promise<CartKeepers> {
    const k = new CartKeepers();
    const live = carts.filter((c) => c.live && c.kind !== 'paan');
    const actors = await makeActors('uncle', live.length);
    live.forEach((c, i) => {
      const s = Math.sin(c.rot), co = Math.cos(c.rot);
      const W = (lx: number, lz: number): [number, number] => [c.x + lx * co + lz * s, c.z - lx * s + lz * co];
      const [kx, kz] = W(((i * 37) % 7 - 3) * 0.06, c.kind === 'chai' ? -0.45 : -0.85);
      const keeper = new Keeper(actors[i], c, kx, c.y, kz, c.rot + Math.PI + (((i * 53) % 9) - 4) * 0.04, W(0, cartRadius(c.kind) + 0.55));
      k.keepers.push(keeper);
      k.group.add(keeper.actor.root);
    });
    return k;
  }

  /** collision for them: [x, z, r] */
  get posts(): [number, number, number][] {
    return this.keepers.map((k) => [k.position.x, k.position.z, 0.3]);
  }

  /** the keeper whose cart Ramu stands in front of (within `r` of where a buyer would stand), or null */
  at(x: number, z: number, r = 2.6): Keeper | null {
    let best: Keeper | null = null, bd = r;
    for (const k of this.keepers) {
      const d = Math.hypot(k.front.x - x, k.front.y - z);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  update(dt: number, x: number, z: number): void {
    for (const k of this.keepers) if (Math.hypot(k.position.x - x, k.position.z - z) < 70) k.update(dt);
  }
}
