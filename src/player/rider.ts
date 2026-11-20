import * as THREE from 'three';

/*
 Ramu on a vehicle, posed on his own rig every frame (after the animation mixer has set the standing idle):
   hips    on the seat (or, on a cycle too big for him, standing on the pedals: up and down with the lower one)
   spine   leant forward as far as his hands need to reach the grips
   hands   two-bone IK onto the grips of the handlebar (turned with the steering) or onto the steering wheel at ten to
           two (round with it, as far as hands go)
   feet    two-bone IK onto the pegs, the floor, or the pedals going round with the wheels
   head    looking into the turn
 Getting on / off: `w` goes 0 -> 1 (on) or 1 -> 0 (off): the hips travel between where he stands beside the vehicle and
 the seat (a bike: a leg swung over it), and every IK target eases between the standing pose and the seated one.

 The tables are in the vehicle's frame (x to its left, y up, z forward; the cars are right-hand drive), metres,
 measured on side / top renders of the models. Two-sided points are given for the left side; the right is their mirror
 about the hips.
*/

type V = [number, number, number];
type Hands = { bars: V; pivot: V } | { wheel: V; r: number; tilt: number };
type Feet = { rest: V } | { pedals: V; r: number; x: number; ratio: number };
export interface Seat { hips: V; hands: Hands; feet: Feet; bike?: boolean }

const car = (hx: number, hy: number, hz: number, tilt = 0.45, r = 0.18, footY = 0.22): Seat => ({
  hips: [hx, hy, hz],
  hands: { wheel: [hx, hy + 0.36, hz + 0.4], r, tilt },
  feet: { rest: [hx + 0.13, footY, hz + 0.42] },
});

export const SEATS: Record<string, Seat> = {
  swift: car(-0.36, 0.64, -0.12),
  maruti: car(-0.32, 0.6, -0.07, 0.45, 0.17, 0.18),
  ambassador: car(-0.4, 0.68, -0.12, 0.45, 0.2, 0.25),
  bolero: car(-0.42, 0.86, -0.02, 0.5, 0.19, 0.45),
  bus: car(-0.82, 1.5, 3.9, 1.0, 0.25, 1.07),
  truck: car(-0.55, 1.6, 1.9, 0.9, 0.22, 1.17),
  autorickshaw: { hips: [0, 0.82, 0.3], hands: { bars: [0.3, 1.02, 0.66], pivot: [0, 1.0, 0.8] }, feet: { rest: [0.13, 0.3, 0.52] } },
  tirri: { hips: [0, 1.0, 0.38], hands: { bars: [0.28, 1.2, 0.8], pivot: [0, 1.15, 0.92] }, feet: { rest: [0.13, 0.6, 0.72] } },
  pulsar: { hips: [0, 0.98, -0.08], hands: { bars: [0.33, 1.02, 0.28], pivot: [0, 1.0, 0.42] }, feet: { rest: [0.2, 0.38, -0.05] }, bike: true },
  enfield: { hips: [0, 0.9, -0.24], hands: { bars: [0.29, 1.01, 0.27], pivot: [0, 1.0, 0.52] }, feet: { rest: [0.22, 0.28, 0.08] }, bike: true },
  enfield_black: { hips: [0, 0.91, -0.2], hands: { bars: [0.27, 1.01, 0.19], pivot: [0, 1.0, 0.47] }, feet: { rest: [0.21, 0.31, 0.02] }, bike: true },
  cycle: { hips: [0, 1.08, -0.3], hands: { bars: [0.25, 1.07, 0.24], pivot: [0, 1.05, 0.39] },
    feet: { pedals: [0, 0.32, -0.07], r: 0.17, x: 0.13, ratio: 0.355 * 2.4 }, bike: true },
  rickshaw: { hips: [0, 1.1, -0.04], hands: { bars: [0.2, 1.02, 0.53], pivot: [0, 1.0, 0.61] },
    feet: { pedals: [0, 0.37, 0.14], r: 0.16, x: 0.12, ratio: 0.37 * 2.0 } },
};
for (const n of ['maruti_red', 'maruti_green']) SEATS[n] = SEATS.maruti;
SEATS.bus_green = SEATS.bus;

/** what drives the pose this frame */
export interface RidePose {
  /** the vehicle body's world matrix (heading, lean) */
  frame: THREE.Matrix4;
  kind: string;
  /** front wheels' angle (rad, > 0 left), metres rolled (the pedals) */
  steer: number; dist: number;
  /** 0 standing beside it .. 1 on it */
  w: number;
  /** where he stands beside it (world), on the ground */
  sx: number; sz: number;
}

const ANKLE = 0.07;     // ankle above the sole
const SIDES = ['Left', 'Right'] as const;

export class Rider {
  private bone: Record<string, THREE.Bone> = {};
  private leg = 0;      // hip joint -> ankle, m
  private arm = 0;      // shoulder -> wrist
  /** per kind: how far the spine leans so the hands reach */
  private leanOf = new Map<string, number>();
  private hipsY = 0.68; // the Hips bone above the soles, standing

  constructor(body: THREE.Object3D) {
    body.traverse((o) => {
      if (!(o as THREE.Bone).isBone) return;
      const n = o.name.replace(/[^A-Za-z0-9]/g, '').replace(/^mixamorig\d*/, '');
      this.bone[n] = o as THREE.Bone;
    });
    const b = this.bone;
    if (b.LeftLeg && b.LeftFoot) this.leg = b.LeftLeg.position.length() + b.LeftFoot.position.length();
    if (b.LeftForeArm && b.LeftHand) this.arm = b.LeftForeArm.position.length() + b.LeftHand.position.length();
    if (b.Hips) this.hipsY = b.Hips.position.y;
  }

  get ok(): boolean {
    return !!(this.bone.Hips && this.bone.LeftUpLeg && this.bone.LeftArm && this.leg > 0 && this.arm > 0);
  }

  /**
   * Pose him: `root` is moved so his hips sit where they should, `model` turned with the vehicle (it holds the rig,
   * which faces the other way: hence the half turn).
   */
  apply(root: THREE.Object3D, model: THREE.Object3D, p: RidePose): void {
    const seat = SEATS[p.kind];
    if (!seat || !this.ok) return;
    const F = p.frame, b = this.bone;
    const w = smooth(p.w);
    F.decompose(_v0, _q0, _v1);
    model.quaternion.copy(_q0).multiply(_qHalf);
    const at = (v: V | THREE.Vector3, out: THREE.Vector3) => (Array.isArray(v) ? out.set(v[0], v[1], v[2]) : out.copy(v)).applyMatrix4(F);
    const mirror = (v: V): V => [2 * seat.hips[0] - v[0], v[1], v[2]];
    const right = _v2.set(-1, 0, 0).transformDirection(F);   // the vehicle's right, up and forward in the world
    const up = _v3.set(0, 1, 0).transformDirection(F);
    const fwd = _v4.set(0, 0, 1).transformDirection(F);

    // ---- the feet's targets on the vehicle (vehicle frame)
    const feet: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3()];
    let hips = new THREE.Vector3(...seat.hips);
    if ('pedals' in seat.feet) {
      const P = seat.feet, th = p.dist / P.ratio;
      SIDES.forEach((_, i) => {
        const a = th + i * Math.PI, sx = (i ? -1 : 1) * P.x;
        feet[i].set(sx, P.pedals[1] + P.r * Math.cos(a) + ANKLE, P.pedals[2] + P.r * Math.sin(a));
      });
      // too small for the saddle: he stands on the pedals, as high as the lower one lets his leg reach, over the cranks
      const low = feet[0].y < feet[1].y ? feet[0] : feet[1];
      const reachY = low.y + this.leg * 0.94 + 0.06;
      if (reachY < hips.y) hips.set(hips.x, reachY, P.pedals[2] - 0.08);
    } else {
      const r = seat.feet.rest;
      feet[0].set(r[0], r[1] + ANKLE, r[2]);
      feet[1].set(...mirror(r)).y += ANKLE;
    }

    // ---- hips: from beside the vehicle (standing) to the seat; a leg swung over a bike's saddle on the way
    const stand = _v5.set(p.sx, this.hipsY, p.sz);
    const seated = at(hips, _v6);
    const hw = new THREE.Vector3().lerpVectors(stand, seated, w);
    hw.y += Math.sin(Math.PI * w) * (seat.bike ? 0.12 : 0.04);
    const now = this.world(b.Hips, _v7);           // (read before moving the root: it depends on it)
    root.position.add(hw.sub(now));
    root.updateMatrixWorld(true);

    // ---- spine: lean so the hands reach (worked out once per kind)
    let lean = this.leanOf.get(p.kind);
    if (lean === undefined) lean = this.findLean(p, seat, F);
    this.turn(b.Spine, _q1.setFromAxisAngle(right, -lean * 0.55 * w));
    this.turn(b.Spine1 ?? b.Spine, _q1.setFromAxisAngle(right, -lean * 0.45 * w));

    // ---- legs
    SIDES.forEach((s, i) => {
      const foot = b[s + 'Foot'];
      const keep = foot.getWorldQuaternion(new THREE.Quaternion());
      const hip = this.world(b[s + 'UpLeg'], new THREE.Vector3());
      const ground = new THREE.Vector3(hip.x, ANKLE, hip.z);
      const t = at(feet[i], new THREE.Vector3()).lerp(ground, 1 - w);
      // knees ahead and a little out (on a bike's tank: in)
      const side = (i ? 1 : -1);
      const pole = hip.clone().addScaledVector(fwd, 0.6).addScaledVector(up, 0.25).addScaledVector(right, side * (seat.bike ? 0.04 : 0.12));
      this.ik(b[s + 'UpLeg'], b[s + 'Leg'], foot, t, pole);
      this.setWorldQ(foot, keep);     // the foot flat, as it was standing
    });

    // ---- arms
    const grips = this.grips(p, seat, mirror);
    SIDES.forEach((s, i) => {
      const sh = this.world(b[s + 'Arm'], new THREE.Vector3());
      // the wrist a hand's length short of the grip; hanging at his side while he gets on
      const g = at(grips[i], new THREE.Vector3()).addScaledVector(fwd, -0.07);
      const hang = sh.clone().addScaledVector(up, -this.arm * 0.95).addScaledVector(right, (i ? 1 : -1) * 0.04);
      const t = hang.lerp(g, w);
      const side = (i ? 1 : -1);
      const pole = sh.clone().addScaledVector(right, side * 0.4).addScaledVector(up, -0.5).addScaledVector(fwd, -0.3);
      this.ik(b[s + 'Arm'], b[s + 'ForeArm'], b[s + 'Hand'], t, pole);
    });

    // ---- head: up to look along the road (against the lean), and into the turn
    if (b.Neck) this.turn(b.Neck, _q1.setFromAxisAngle(right, lean * 0.45 * w));
    if (b.Head) this.turn(b.Head, _q1.setFromAxisAngle(right, lean * 0.3 * w));
    if (b.Neck) this.turn(b.Neck, _q1.setFromAxisAngle(up, p.steer * 0.7 * w));
  }

  /**
   * Picking a lock (after the mixer has set the standing idle, or the crouch for a low lock): bent toward it, the left
   * hand holding the tension tool steady in it, the right working the pick: small quick rakes and a twist of the wrist,
   * a pause now and then to feel, and every few seconds the pick drawn out a little and set again. Head down, watching.
   * `t`: seconds at it; `w`: 0..1, how far into the pose (eases in as he settles).
   */
  pick(model: THREE.Object3D, lock: THREE.Vector3, t: number, low: boolean, w: number): void {
    if (!this.ok) return;
    const b = this.bone;
    model.updateMatrixWorld(true);
    const e = smooth(w);
    const hips = this.world(b.Hips, _v0);
    const fwd = _v1.set(lock.x - hips.x, 0, lock.z - hips.z);
    if (fwd.lengthSq() < 1e-6) return;
    fwd.normalize();
    const up = _v2.set(0, 1, 0), side = _v3.crossVectors(fwd, up).normalize();     // his right
    const tilt = _v4.crossVectors(up, fwd).normalize();                               // turning about this leans him forward
    // bend over to it: as far as the hands need, more for a lock down by a wheel
    const lean = (low ? 0.55 : 0.32) * e;
    this.turn(b.Spine, _q1.setFromAxisAngle(tilt, lean * 0.5));
    this.turn(b.Spine1 ?? b.Spine, _q1.setFromAxisAngle(tilt, lean * 0.5));
    // the pick's motion: raking strokes (9 a second) in bursts, a pause to feel, a reset every ~3.4 s
    const burst = 0.5 + 0.5 * Math.sin(t * 1.7), rake = Math.sin(t * 2 * Math.PI * 4.5) * 0.012 * burst;
    const cycle = t % 3.4, reset = cycle > 3.0 ? Math.sin(((cycle - 3.0) / 0.4) * Math.PI) : 0;
    const along = _v5.crossVectors(up, fwd).normalize();          // along the vehicle (across his front)
    const pickAt = _v6.copy(lock).addScaledVector(along, -0.035).addScaledVector(up, rake).addScaledVector(fwd, -0.02 - reset * 0.06);
    const holdAt = _v7.copy(lock).addScaledVector(along, 0.04).addScaledVector(up, -0.03).addScaledVector(fwd, -0.03);
    SIDES.forEach((s, i) => {
      const sh = this.world(b[s + 'Arm'], new THREE.Vector3());
      const hang = sh.clone().addScaledVector(up, -this.arm * 0.95).addScaledVector(side, (i ? 1 : -1) * 0.04);
      const target = hang.lerp(i ? pickAt : holdAt, e);
      // elbows out to the side and down
      const pole = sh.clone().addScaledVector(side, (i ? 1 : -1) * 0.45).addScaledVector(up, -0.45).addScaledVector(fwd, -0.15);
      this.ik(b[s + 'Arm'], b[s + 'ForeArm'], b[s + 'Hand'], target.addScaledVector(fwd, -0.06), pole);
    });
    // the right wrist turns the pick (a twist about the forearm), the left holds its turn on the wrench
    const fa = this.world(b.RightHand, _v8).sub(this.world(b.RightForeArm, _v9)).normalize();
    this.turn(b.RightHand, _q1.setFromAxisAngle(fa, (0.25 + Math.sin(t * 2 * Math.PI * 1.3) * 0.35 * burst) * e));
    const fl = this.world(b.LeftHand, _v8).sub(this.world(b.LeftForeArm, _v9)).normalize();
    this.turn(b.LeftHand, _q1.setFromAxisAngle(fl, -0.3 * e));
    // head down, on the lock (and a glance round now and then, in case somebody is watching)
    const glance = Math.max(0, Math.sin(t * 0.55) - 0.82) * 4;     // 0 most of the time, up to ~0.7
    if (b.Neck) this.turn(b.Neck, _q1.setFromAxisAngle(tilt, (low ? 0.25 : 0.35) * e * (1 - glance)));
    if (b.Head) this.turn(b.Head, _q1.setFromAxisAngle(up, glance * 0.9 * e));
  }

  /** where the hands hold (vehicle frame): the grips turned about the steering pivot, or on the wheel's rim */
  private grips(p: RidePose, seat: Seat, mirror: (v: V) => V): THREE.Vector3[] {
    const h = seat.hands;
    if ('bars' in h) {
      const pv = new THREE.Vector3(...h.pivot);
      const rot = new THREE.Matrix4().makeRotationY(p.steer);
      return [h.bars, mirror(h.bars)].map((g) => new THREE.Vector3(...g).sub(pv).applyMatrix4(rot).add(pv));
    }
    // the wheel: its face toward the driver, tilted back; the hands at ten to two, turned with it (up to a quarter turn)
    const c = new THREE.Vector3(...h.wheel);
    const u = new THREE.Vector3(1, 0, 0), v = new THREE.Vector3(0, Math.cos(h.tilt), Math.sin(h.tilt));
    const turn = Math.max(-1.5, Math.min(1.5, p.steer * 3.2));
    return [1, -1].map((s) => {
      const a = s * 1.05 + turn;
      return c.clone().addScaledVector(u, h.r * Math.sin(a)).addScaledVector(v, h.r * Math.cos(a));
    });
  }

  /** the least forward lean (0..0.9 rad) that brings both grips within his reach */
  private findLean(p: RidePose, seat: Seat, F: THREE.Matrix4): number {
    const b = this.bone, sp = b.Spine, sp1 = b.Spine1 ?? b.Spine;
    const q0 = sp.quaternion.clone(), q1 = sp1.quaternion.clone();
    const right = new THREE.Vector3(-1, 0, 0).transformDirection(F);
    const grips = this.grips({ ...p, steer: 0 }, seat, (v) => [2 * seat.hips[0] - v[0], v[1], v[2]]).map((g) => g.applyMatrix4(F));
    let lean = 0.9;
    for (let l = 0; l <= 0.9; l += 0.05) {
      sp.quaternion.copy(q0);
      sp1.quaternion.copy(q1);
      this.turn(sp, _q1.setFromAxisAngle(right, -l * 0.55));
      this.turn(sp1, _q1.setFromAxisAngle(right, -l * 0.45));
      const ok = SIDES.every((s, i) => this.world(b[s + 'Arm'], _v8).distanceTo(grips[i]) < this.arm + 0.04);
      if (ok) { lean = l + 0.05; break; }
    }
    sp.quaternion.copy(q0);
    sp1.quaternion.copy(q1);
    sp.updateMatrixWorld(true);
    this.leanOf.set(p.kind, lean);
    return lean;
  }

  private world(o: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
    return o.getWorldPosition(out);
  }

  /** turn a bone by a world-space rotation */
  private turn(bone: THREE.Bone, q: THREE.Quaternion): void {
    const qw = bone.getWorldQuaternion(_q2);
    this.setWorldQ(bone, _q3.copy(q).multiply(qw));
  }

  private setWorldQ(bone: THREE.Bone, qw: THREE.Quaternion): void {
    const qp = bone.parent!.getWorldQuaternion(_q4);
    bone.quaternion.copy(qp.invert().multiply(qw));
    bone.updateMatrixWorld(true);
  }

  /** turn `bone` so the point `from` (world, on its child) goes toward `to` */
  private aim(bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3): void {
    const p = this.world(bone, _v9);
    const a = from.clone().sub(p).normalize(), c = to.clone().sub(p).normalize();
    if (a.lengthSq() < 1e-8 || c.lengthSq() < 1e-8) return;
    this.turn(bone, _q5.setFromUnitVectors(a, c));
  }

  /** two-bone IK: upper / lower / end, the end onto `target`, the middle joint bending toward `pole` */
  private ik(a: THREE.Bone, b: THREE.Bone, c: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3): void {
    const pa = this.world(a, new THREE.Vector3()), pb = this.world(b, new THREE.Vector3()), pc = this.world(c, new THREE.Vector3());
    const l1 = pa.distanceTo(pb), l2 = pb.distanceTo(pc);
    const dir = target.clone().sub(pa);
    const d = Math.max(Math.abs(l1 - l2) + 1e-3, Math.min((l1 + l2) * 0.999, dir.length()));
    dir.normalize();
    const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    const perp = pole.clone().sub(pa);
    perp.addScaledVector(dir, -perp.dot(dir));
    if (perp.lengthSq() < 1e-8) perp.set(0, 1, 0);
    perp.normalize();
    const knee = pa.clone().addScaledVector(dir, x).addScaledVector(perp, h);
    this.aim(a, pb, knee);
    this.aim(b, this.world(c, new THREE.Vector3()), pa.clone().addScaledVector(dir, d));
  }
}

function smooth(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

const _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3(), _v7 = new THREE.Vector3();
const _v8 = new THREE.Vector3(), _v9 = new THREE.Vector3();
const _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _q4 = new THREE.Quaternion(), _q5 = new THREE.Quaternion();
const _qHalf = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
