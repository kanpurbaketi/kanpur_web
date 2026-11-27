import * as THREE from 'three';
import type { P2 } from './types';
import { makeActors, type RigName } from './actors';
import { GATE } from './melaSite';
import { Person } from './person';

/*
 Stage 1: the line for tickets at the mela's main gate (plans/08, beats 8-12). A red rope on brass posts across the gate's
 opening, with a gap the guard keeps; a small ticket table beside him. People stand in line from the gap out to the
 footpath; every few seconds the one at the front shows a ticket and walks in through the gap, the rest step up, and
 whoever went in comes back later along the footpath to the end of the line (so it never runs out). The story can hold
 the line still and put Ramu at its front (ramuFirst), then let it go on (release).
 The rope and the gap are solid to Ramu while the stage is played (main.ts adds `walls` and `posts`); the line's people
 walk through the gap. Only exists while stage 1 is played: roaming free, the gate is open.
*/

/** the line's x, a little east of the gate's middle (the guard and his table on its west) */
const QX = GATE.x + 1.2;
const ROPE_Z = GATE.z + 0.5;
const Z0 = GATE.z + 1.45;          // the front of the line
const GAP = 0.9;                   // between people in line
const TICKET_S = 3;
const KINDS: RigName[] = ['uncle', 'aunty', 'boy', 'girl', 'uncle', 'girl', 'aunty', 'boy'];

interface Walker { p: Person; path: P2[]; t: number }

const rnd = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export class GateQueue {
  readonly group = new THREE.Group();
  readonly guard: Person;
  /** collision for Ramu: the rope, as thin walls ([ring, height]); the gap and the guard, as posts ([x, z, r, h]) */
  readonly walls: [P2[], number][] = [];
  readonly posts: [number, number, number, number][] = [];
  /** in line, front first */
  private line: Person[] = [];
  /** gone in (walking off inside, then out of sight for a while before they come back) */
  private gone: Walker[] = [];
  private ticketT = -1;
  private pauseT = 1.5;
  private n = 0;
  /** the line stands still (a cutscene has it) */
  hold = false;

  private constructor(guard: Person) { this.guard = guard; }

  static async create(): Promise<GateQueue> {
    const [g] = await makeActors('security', 1);
    const guard = new Person(g, QX - 1.05, 0.02, GATE.z + 0.95, 0);
    const q = new GateQueue(guard);
    guard.faceTowards(QX, Z0 + 0.4);
    q.group.add(g.root);
    const by = new Map<RigName, number>();
    for (const k of KINDS) by.set(k, (by.get(k) ?? 0) + 1);
    const actors = (await Promise.all([...by].map(([k, n]) => makeActors(k, n)))).flat();
    actors.forEach((a, i) => {
      const [x, z] = q.slot(i);
      const p = new Person(a, x + (rnd(i) - 0.5) * 0.12, 0.02, z, (rnd(i + 9) - 0.5) * 0.3);
      q.line.push(p);
      q.group.add(a.root);
    });
    q.build();
    return q;
  }

  /** where the i-th in line stands */
  slot(i: number): P2 { return [QX, Z0 + i * GAP]; }

  /** the end of the line, where Ramu would join it */
  backSpot(): P2 { return this.slot(this.line.length); }

  /** where the guard keeps the gap */
  get gap(): P2 { return [QX, ROPE_Z]; }

  /** the rope, its posts, the ticket table */
  private build(): void {
    const brass = new THREE.MeshStandardMaterial({ color: '#c9a23a', metalness: 0.7, roughness: 0.35 });
    const red = new THREE.MeshStandardMaterial({ color: '#a1121c', roughness: 0.7 });
    const post = new THREE.CylinderGeometry(0.035, 0.035, 0.95, 10).translate(0, 0.5, 0);
    const knob = new THREE.SphereGeometry(0.06, 10, 8).translate(0, 1.0, 0);
    const base = new THREE.CylinderGeometry(0.16, 0.18, 0.05, 16).translate(0, 0.045, 0);
    const xs = (a: number, b: number) => { const n = Math.max(1, Math.round((b - a) / 1.5)); return Array.from({ length: n + 1 }, (_, i) => a + (i * (b - a)) / n); };
    const runs = [xs(GATE.x - GATE.half + 0.1, QX - 0.55), xs(QX + 0.55, GATE.x + GATE.half - 0.1)];
    for (const run of runs) {
      for (const x of run) for (const g of [post, knob, base]) {
        const m = new THREE.Mesh(g, brass);
        m.position.set(x, 0.02, ROPE_Z);
        this.group.add(m);
      }
      for (let i = 0; i + 1 < run.length; i++) {
        const a = run[i], b = run[i + 1];
        const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(a, 0.98, ROPE_Z), new THREE.Vector3((a + b) / 2, 0.72, ROPE_Z), new THREE.Vector3(b, 0.98, ROPE_Z));
        this.group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.022, 6), red));
      }
      const a = run[0], b = run[run.length - 1];
      this.walls.push([[[a, ROPE_Z - 0.08], [b, ROPE_Z - 0.08], [b, ROPE_Z + 0.08], [a, ROPE_Z + 0.08]], 1.0]);
    }
    // the gap: the guard lets nobody through without a ticket (a wall, not a post: pushed past a post's middle, you are out the far side)
    this.walls.push([[[QX - 0.6, ROPE_Z - 0.25], [QX + 0.6, ROPE_Z - 0.25], [QX + 0.6, ROPE_Z + 0.25], [QX - 0.6, ROPE_Z + 0.25]], 1.8]);
    this.posts.push([this.guard.position.x, this.guard.position.z, 0.3, 1.8]);
    // the ticket table: a folding table under a cloth, a roll of tickets and a cash box on it
    const tx = QX - 2.05, tz = GATE.z + 0.95;
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.74, 0.55), new THREE.MeshStandardMaterial({ color: '#1f4f8c', roughness: 0.9 }));
    cloth.position.set(tx, 0.39, tz);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.03, 0.58), new THREE.MeshStandardMaterial({ color: '#e9e2d0', roughness: 0.8 }));
    top.position.set(tx, 0.775, tz);
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.09, 14).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#f0a8b8', roughness: 0.8 }));
    roll.position.set(tx - 0.22, 0.84, tz + 0.05);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.18), new THREE.MeshStandardMaterial({ color: '#4a4a4a', metalness: 0.5, roughness: 0.5 }));
    box.position.set(tx + 0.2, 0.84, tz);
    this.group.add(cloth, top, roll, box);
    this.posts.push([tx, tz, 0.5, 0.8]);
  }

  /** where its people stand, for the street's walkers to step round: [x, z, r] */
  solids(out: [number, number, number][]): void {
    for (const p of [...this.line, this.guard]) if (p.visible) out.push([p.position.x, p.position.z, 0.3]);
  }

  /** the story's people pushing Ramu out of them (as the crowds do) */
  pushOut(x: number, z: number, r: number): [number, number] {
    const z0 = z;
    for (const p of [...this.line, this.guard]) {
      if (!p.visible) continue;
      const dx = x - p.position.x, dz = z - p.position.z, d = Math.hypot(dx, dz), m = r + 0.27;
      if (d < m && d > 1e-4) { x = p.position.x + (dx / d) * m; z = p.position.z + (dz / d) * m; }
    }
    // never through the rope by being jostled: the line is outside it
    if (z0 >= ROPE_Z && Math.abs(x - GATE.x) < GATE.half + 0.5 && z < ROPE_Z + 0.45) z = ROPE_Z + 0.45;
    return [x, z];
  }

  /** a cut in a scene: the line has moved on and Ramu is at its front; everybody else behind him, standing */
  ramuFirst(): P2 {
    this.hold = true;
    this.ticketT = -1;
    this.line.forEach((p, i) => { const [x, z] = this.slot(i + 1); p.place(x, z, 0); p.idle(); });
    return this.slot(0);
  }

  /** the line goes on without him */
  release(): void { this.hold = false; this.pauseT = 2.5; }

  update(dt: number, rx: number, rz: number): void {
    const near = Math.hypot(rx - QX, rz - Z0) < 90;
    if (!this.hold) this.advance(dt);
    if (!near) return;
    this.guard.update(dt);
    for (const p of this.line) p.update(dt);
    for (const w of this.gone) if (w.p.visible) w.p.update(dt);
  }

  private advance(dt: number): void {
    // in line: everybody walks up to their place, then faces the gate
    this.line.forEach((p, i) => {
      const [x, z] = this.slot(i);
      const pos = p.position;
      if (Math.hypot(pos.x - x, pos.z - z) > 0.08 && !p.walking) p.walkTo(x, z, i === this.line.length - 1 ? 1.3 : 0.9);
      if (!p.walking && Math.abs(p.facing) > 0.05 && Math.hypot(pos.x - x, pos.z - z) <= 0.08) p.turn(0);
    });
    // the front: a short wait, the ticket shown, in through the gap
    const f = this.line[0];
    if (f && !f.walking && Math.hypot(f.position.x - QX, f.position.z - Z0) < 0.12) {
      if (this.ticketT < 0) {
        if ((this.pauseT -= dt) <= 0) {
          this.ticketT = TICKET_S;
          f.gesture('talk', `ticket-${this.n}`, TICKET_S);
          this.guard.gesture('ticket_check', `ticket-${this.n}`, TICKET_S);   // takes it, looks at it, tears it, hands the stub back
          this.guard.face.talking = true;
        }
      } else if ((this.ticketT -= dt) <= 0) {
        this.guard.face.talking = false;
        this.ticketT = -1;
        this.pauseT = 1.2 + rnd(this.n) * 2.2;
        this.line.shift();
        const side = rnd(this.n + 3) < 0.5 ? -1 : 1;
        this.gone.push({ p: f, path: [[QX, ROPE_Z - 1.4], [QX + side * 2.5, GATE.z - 6], [QX + side * 6, GATE.z - 11]], t: 6 + rnd(this.n + 5) * 6 });
        this.n++;
      }
    }
    // gone in: walk off inside, out of sight for a while, then back along the footpath to the end of the line
    for (const w of [...this.gone]) {
      if (w.path.length) {
        if (!w.p.walking) { const [x, z] = w.path.shift()!; w.p.walkTo(x, z, 1.25); }
        continue;
      }
      if (w.p.walking) continue;
      w.p.visible = false;
      if ((w.t -= dt) > 0) continue;
      this.gone.splice(this.gone.indexOf(w), 1);
      const side = rnd(this.n + 7) < 0.5 ? -1 : 1, bz = this.slot(this.line.length)[1];
      w.p.place(QX + side * 14, bz + 1.2);
      w.p.visible = true;
      this.line.push(w.p);
    }
  }
}
