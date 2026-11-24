import * as THREE from 'three';
import { makeActors } from './actors';
import { Person } from './person';

/*
 The story's guards after Ramu (stage 1, parts 2 and 3): security men as Persons the story can also direct in its
 scenes. While the chase is on they run along the way he went (his trail: a crumb every 0.6 m, with the height he was
 at, so they follow him round stalls and up the well's stair, never through anything he could not get through), and
 straight at him once they are close. They are faster than his walk and a little slower than his run: far behind,
 they close the gap; stop, and they are on him. One that reaches him: onCatch (the chase stops).
 Before they have his trail (coming from the sammelan's gates) they go a way of their own (`via`).
*/

const CRUMB = 0.6, CATCH = 0.95;

/** the guards' top speed, m/s: a little under Ramu's run (5.6) */
const MAX_SPEED = 5.1;

interface Guard { p: Person; via: [number, number][]; k: number; pace: number; off: number }

/** the four of them, each his own man: the bearded one as built; tall and dark; no beard, a little shorter; thin, a grey beard */
const GUARD_BUILDS = [
  { look: '', tall: 1, wide: 1 },
  { look: 'security_b', tall: 1.1, wide: 1.02 },
  { look: 'security_c', tall: 0.96, wide: 1.04 },
  { look: 'security_d', tall: 1.03, wide: 0.8 },
];

export class Chase {
  readonly guards: Person[] = [];
  /** chasing (false: standing where the story puts them) */
  on = false;
  /** they run hard (the first time: they catch him wherever he gets to) */
  hard = false;
  onCatch: (() => void) | null = null;
  /** (test scripts) they never get him */
  harmless = false;
  private g: Guard[] = [];
  private trail: THREE.Vector3[] = [];
  private v = new THREE.Vector3();

  /** `him`: Ramu's feet; `onGround`: whether he is on something (a crumb in the air is not one to run to) */
  constructor(private parent: THREE.Object3D, private him: () => THREE.Vector3, private onGround: () => boolean) {}

  /** `n` guards at `spots` (one each), facing (px, pz); each goes `via` first, when the chase is on */
  async spawn(n: number, spots: [number, number][], px: number, pz: number, via?: (x: number, z: number) => [number, number][]): Promise<void> {
    const made = await makeActors('security', n, false, GUARD_BUILDS.map((b) => b.look));
    made.forEach((a, i) => {
      const b = GUARD_BUILDS[i % GUARD_BUILDS.length];
      a.shape(b.tall, b.wide);
      const [x, z] = spots[i % spots.length];
      const p = new Person(a, x, 0.05, z, Math.atan2(-(px - x), -(pz - z)));
      this.parent.add(a.root);
      this.guards.push(p);
      this.g.push({ p, via: via?.(x, z) ?? [], k: -1, pace: 1 - i * 0.035, off: (i % 2 ? 1 : -1) * (0.25 + 0.15 * i) });
    });
  }

  /** start the trail afresh: from `from` (behind him, where the guards are) to where he is now */
  resetTrail(from: [number, number][]): void {
    this.trail.length = 0;
    const h = this.him();
    const pts = [...from.map(([x, z]) => new THREE.Vector3(x, 0.05, z)), h.clone()];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(a.distanceTo(b) / CRUMB));
      for (let j = 0; j < n; j++) this.trail.push(a.clone().lerp(b, j / n));
    }
    this.trail.push(h.clone());
    for (const g of this.g) { g.k = -1; g.via = []; }
  }

  /** the guards standing at `spots` (one each), facing him, off their way, each to come on along the trail from its start */
  place(spots: [number, number][]): void {
    const h = this.him();
    this.g.forEach((g, i) => {
      const [x, z] = spots[i % spots.length];
      g.p.place(x, z, Math.atan2(-(h.x - x), -(h.z - z)));
      g.p.position.y = 0.05;
      g.p.driven = null;
      g.p.idle();
      g.via = [];
      g.k = -1;
    });
  }

  /** everyone stands still where they are (a scene takes them) */
  stop(): void {
    this.on = false;
    for (const g of this.g) { g.p.driven = null; g.p.idle(); }
  }

  go(): void { this.on = true; }

  update(dt: number): void {
    const h = this.him();
    // his trail: a crumb each 0.6 m he goes on his feet
    const last = this.trail[this.trail.length - 1];
    if (this.on && this.onGround() && (!last || last.distanceTo(h) > CRUMB)) this.trail.push(h.clone());
    if (this.trail.length > 4000) { this.trail.splice(0, 1000); for (const g of this.g) g.k = Math.max(0, g.k - 1000); }
    let caught = false;
    for (const g of this.g) {
      const p = g.p, q = p.position;
      if (this.on && !p.busy) {
        const left = this.v.set(h.x - q.x, 0, h.z - q.z).length();
        // how far behind (along the trail, roughly): far, they close in; near, a little slower than his run
        const behind = g.k >= 0 ? Math.max(left, (this.trail.length - g.k) * CRUMB) : left;
        // (never as fast as his run, 5.6 m/s: a guard catches him only if he stops, or runs into a corner)
        const speed = Math.min(MAX_SPEED, this.hard ? 5.1 : behind > 11 ? 5.0 : behind > 5 ? 4.6 : 4.3) * g.pace;
        let tx: number, tz: number, ty: number | null = null;
        if (g.via.length) {                                  // their own way first
          [tx, tz] = g.via[0];
          if (Math.hypot(tx - q.x, tz - q.z) < 0.8) g.via.shift();
          if (!g.via.length) g.k = this.nearest(q);
        } else if (left < 2.2 && Math.abs(h.y - q.y) < 0.8) { tx = h.x; tz = h.z; ty = h.y; }   // on him
        else {
          if (g.k < 0) g.k = this.nearest(q);
          // on along the trail: past crumbs already reached, and those a step further that are nearer
          while (g.k < this.trail.length - 1 && (this.trail[g.k].distanceTo(q) < 0.7 || this.trail[g.k + 1].distanceTo(q) < this.trail[g.k].distanceTo(q))) g.k++;
          const c = this.trail[g.k] ?? h;
          tx = c.x; tz = c.z; ty = c.y;
        }
        const dx = tx - q.x, dz = tz - q.z, d = Math.hypot(dx, dz);
        if (d > 0.02) {
          const s = Math.min(d, speed * dt);
          // a little to one side of the line each (so four do not run in one file), less as they close in
          const side = left > 3 ? g.off : 0;
          q.x += (dx / d) * s + (-dz / d) * side * dt * 0.6;
          q.z += (dz / d) * s + (dx / d) * side * dt * 0.6;
          if (ty !== null) q.y += (Math.max(0.05, ty) - q.y) * Math.min(1, dt * 10);
          else if (p.floor) q.y = p.floor(q.x, q.z);                // their own way (up the stage's stairs): on the steps
          p.turn(Math.atan2(-dx, -dz));
        }
        p.driven = speed;
        if (left < CATCH && Math.abs(h.y - q.y) < 0.9) caught = true;
      }
      p.update(dt);
    }
    // not in each other
    for (let i = 0; i < this.g.length; i++) for (let j = i + 1; j < this.g.length; j++) {
      const a = this.g[i].p.position, b = this.g[j].p.position, dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d < 0.6 && d > 1e-4 && Math.abs(a.y - b.y) < 1) { const k = (0.6 - d) / 2 / d; a.x -= dx * k; a.z -= dz * k; b.x += dx * k; b.z += dz * k; }
    }
    if (caught && this.on && !this.harmless) { this.stop(); this.onCatch?.(); }
  }

  /** the crumb nearest q (at about its height) */
  private nearest(q: THREE.Vector3): number {
    let best = 0, bd = Infinity;
    this.trail.forEach((c, i) => { const d = c.distanceTo(q) + Math.abs(c.y - q.y) * 3; if (d < bd) { bd = d; best = i; } });
    return best;
  }
}
