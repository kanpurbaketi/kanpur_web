import * as THREE from 'three';
import { foodMesh, type FoodName } from './foods';
import { findBone } from './handProp';
import type { Sammelan, Seated } from './mela';
import { chappal, shoe } from './storyProps';

/*
 The audience turning on the poet at the mic (stage 1, part 2). volley(): those sitting nearest the stage get up, turn
 to him and throw (the throw clip); each lets go of a thing (fruit, a packet, a can; in the last volley a chappal or a
 shoe too) at the clip's release, and it flies a high arc at him, or near him, spinning; it bounces once where it lands
 and stays there. One that reaches him: onHit() (he flinches). After a while they sit back down (unless told to stay up).
 At most MAX things lie about; clear() takes them all away.
*/

const G = -9.8, RELEASE = 0.95, MAX = 80;
const FOOD: FoodName[] = ['banana', 'apple', 'orange', 'mango', 'chips', 'chips_b', 'wrapper', 'popcorn', 'can', 'carton', 'cookie_pack', 'water_small'];

interface Flying { obj: THREE.Object3D; v: THREE.Vector3; spin: THREE.Vector3; bounced: boolean; resting: boolean; hit: boolean }

const meshes = new Map<string, Promise<THREE.Object3D>>();
function thing(name: string): Promise<THREE.Object3D> {
  let p = meshes.get(name);
  if (!p) {
    p = name === 'chappal' ? Promise.resolve(chappal()) : name === 'shoe' ? Promise.resolve(shoe()) : foodMesh(name as FoodName, name === 'banana' ? 0.55 : 1);
    meshes.set(name, p);
  }
  return p.then((m) => m.clone());
}

export class Throwers {
  private flying: Flying[] = [];
  private pending: { t: number; f: () => void }[] = [];
  private turned = new Map<Seated, number>();
  private v = new THREE.Vector3();
  /** a thing reached him */
  onHit: () => void = () => {};

  /** `target`: where he is (his feet) */
  constructor(private s: Sammelan, private target: () => THREE.Vector3) {
    s.ticks.add(this.tick);
  }

  /**
   `n` of those sitting nearest him throw at him over about `secs` seconds (shoes: chappals and shoes among the food);
   they sit back down `sitBack` seconds after, or stay up (null). Resolves when the last thing has landed.
  */
  volley(n: number, shoes: boolean, secs = 2.2, sitBack: number | null = 3): Promise<void> {
    const at = this.target(), w = new THREE.Vector3();
    const near = this.s.audience
      .map((p) => ({ p, d: p.actor.root.getWorldPosition(w).distanceTo(at) }))
      .sort((a, b) => a.d - b.d).slice(0, Math.max(n * 2, 12));
    const who = near.sort(() => Math.random() - 0.5).slice(0, n).map((x) => x.p);
    let last = 0;
    who.forEach((p, i) => {
      const t = (i / Math.max(1, who.length - 1)) * secs + Math.random() * 0.3;
      last = Math.max(last, t);
      this.after(t, () => this.throwFrom(p, shoes && Math.random() < 0.45 ? (Math.random() < 0.5 ? 'chappal' : 'shoe') : FOOD[Math.floor(Math.random() * FOOD.length)], i));
      if (sitBack !== null) this.after(t + RELEASE + sitBack + Math.random(), () => this.sitDown(p));
    });
    return new Promise((done) => this.after(last + RELEASE + 1.6, done));
  }

  /** everyone in the audience up on their feet, facing him (staying up) */
  standAll(): void {
    const at = this.target();
    for (const p of this.s.audience) {
      this.face(p, at);
      p.actor.play('idle', 0.9 + Math.random() * 0.2, 0.35);
    }
  }

  /** everyone sitting down again, everything thrown taken away */
  clear(): void {
    for (const f of this.flying) f.obj.removeFromParent();
    this.flying.length = 0;
    this.pending.length = 0;
    for (const p of this.turned.keys()) this.sitDown(p);
  }

  dispose(): void { this.clear(); this.s.ticks.delete(this.tick); }

  private after(t: number, f: () => void): void { this.pending.push({ t, f }); }

  /** turned (in the stage's frame, which is turned a quarter round) to face (x, z) of the world */
  private face(p: Seated, at: THREE.Vector3): void {
    const r = p.actor.root, w = r.getWorldPosition(this.v);
    if (!this.turned.has(p)) this.turned.set(p, r.rotation.y);
    const parentY = r.parent ? new THREE.Euler().setFromQuaternion(r.parent.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y : 0;
    r.rotation.y = Math.atan2(-(at.x - w.x), -(at.z - w.z)) - parentY;
  }

  private sitDown(p: Seated): void {
    const ry = this.turned.get(p);
    if (ry !== undefined) p.actor.root.rotation.y = ry;
    this.turned.delete(p);
    p.actor.play(p.sit, p.scale, 0.4);
  }

  private throwFrom(p: Seated, name: string, i: number): void {
    const at = this.target();
    this.face(p, at);
    p.actor.once('throw', `throw-${performance.now()}-${i}`, 1.1, 0.25);
    this.after(RELEASE, () => {
      void thing(name).then((obj) => {
        const hand = findBone(p.actor.root, 'RightHand');
        const from = new THREE.Vector3();
        if (hand) hand.getWorldPosition(from); else p.actor.root.getWorldPosition(from).setY(from.y + 1.5);
        // at him (his chest) one time in three, else somewhere about him on the stage
        const to = this.target().clone();
        if (Math.random() < 0.35) to.y += 1.1 + Math.random() * 0.3;
        else { const a = Math.random() * Math.PI * 2, r = 0.5 + Math.random() * 2.0; to.x += Math.cos(a) * r; to.z += Math.sin(a) * r; to.y = this.s.ground(to.x, to.z); }
        const d = Math.hypot(to.x - from.x, to.z - from.z), T = Math.min(1.25, Math.max(0.7, d / 9));
        const v = new THREE.Vector3((to.x - from.x) / T, (to.y - from.y - 0.5 * G * T * T) / T, (to.z - from.z) / T);
        obj.position.copy(this.s.group.worldToLocal(from.clone()));
        obj.rotation.set(Math.random() * 6, Math.random() * 6, 0);
        this.s.group.add(obj);
        this.flying.push({ obj, v, spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14), bounced: false, resting: false, hit: false });
        while (this.flying.length > MAX) this.flying.shift()!.obj.removeFromParent();
      }).catch(() => {});
    });
  }

  private tick = (dt: number): void => {
    for (const w of [...this.pending]) if ((w.t -= dt) <= 0) { this.pending.splice(this.pending.indexOf(w), 1); w.f(); }
    const him = this.target();
    for (const f of this.flying) {
      if (f.resting) continue;
      const p = f.obj.position;
      f.v.y += G * dt;
      p.addScaledVector(f.v, dt);
      f.obj.rotation.x += f.spin.x * dt;
      f.obj.rotation.y += f.spin.y * dt;
      f.obj.rotation.z += f.spin.z * dt;
      // at him: it hits, and drops off him
      if (!f.hit && Math.hypot(p.x - him.x, p.z - him.z) < 0.35 && p.y > him.y + 0.2 && p.y < him.y + 1.75) {
        f.hit = true;
        f.v.set(-f.v.x * 0.15, Math.min(f.v.y, 0) * 0.3, -f.v.z * 0.15);
        this.onHit();
      }
      const floor = this.s.ground(p.x, p.z) + 0.03;
      if (p.y < floor && f.v.y < 0) {
        p.y = floor;
        if (!f.bounced) { f.bounced = true; f.v.set(f.v.x * 0.35, -f.v.y * 0.28, f.v.z * 0.35); f.spin.multiplyScalar(0.4); }
        else { f.resting = true; f.obj.rotation.x = Math.round(f.obj.rotation.x / Math.PI) * Math.PI; f.obj.rotation.z = 0; }
      }
    }
  };
}
