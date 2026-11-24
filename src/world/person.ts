import * as THREE from 'three';
import type { Actor } from './actors';

/*
 A rigged person the story places and moves (a cart's keeper, the guard at the gate, people in the line): where they are,
 which way they face (0: -z, as everyone's), their head (for the cutscene camera), one-shot gestures, and walking
 to a point at a steady pace (the clip paced to it).
*/
export class Person {
  readonly actor: Actor;
  private head: THREE.Object3D | null = null;
  private neck: THREE.Object3D | null = null;
  /** looking at somebody (their head) or a point while they sit or stand: the head and neck turned to it; null: as the clip has it */
  private look: Person | { headPosition(out: THREE.Vector3): boolean } | THREE.Vector3 | null = null;
  /** how far the look is turned on (eases in and out) */
  private lookW = 0;
  private lookT = 0;
  /** walking to here (null: standing) */
  private goal: THREE.Vector2 | null = null;
  private speed = 1.2;
  private turnTo: number | null = null;
  private gestureT = 0;
  /** a looping clip held while not walking or gesturing (sitting in a chair, eating): null stands */
  pose: string | null = null;
  private poseScale = 1;
  /** moved by somebody else (the story's chase sets where they are): the pace their walk or run is played at; null: on
   * their own */
  driven: number | null = null;
  /** what walking looks like for them just now (with a mic in the hand: mic_walk) */
  walkClip = 'walk';
  /** the ground under them while walking (the stage, its stairs): null keeps their height */
  floor: ((x: number, z: number) => number) | null = null;

  constructor(actor: Actor, x: number, y: number, z: number, ry: number) {
    this.actor = actor;
    actor.root.position.set(x, y, z);
    actor.root.rotation.y = ry;
    actor.root.traverse((o) => {
      if (!(o as THREE.Bone).isBone) return;
      if (!this.head && /Head$/.test(o.name)) this.head = o;
      if (!this.neck && /Neck$/.test(o.name)) this.neck = o;
    });
    actor.face.blinking = true;
  }

  get position(): THREE.Vector3 { return this.actor.root.position; }
  get facing(): number { return this.actor.root.rotation.y; }
  set facing(r: number) { this.actor.root.rotation.y = r; this.turnTo = null; }
  get face() { return this.actor.face; }
  get visible(): boolean { return this.actor.root.visible; }
  set visible(v: boolean) { this.actor.root.visible = v; }
  get walking(): boolean { return this.goal !== null; }
  /** a gesture is playing */
  get busy(): boolean { return this.gestureT > 0; }

  headPosition(out: THREE.Vector3): boolean {
    if (!this.head) return false;
    this.actor.root.updateWorldMatrix(true, true);
    this.head.getWorldPosition(out);
    return true;
  }

  /** the heading that looks at (x, z) */
  towards(x: number, z: number): number {
    const p = this.position;
    return Math.atan2(-(x - p.x), -(z - p.z));
  }

  faceTowards(x: number, z: number): void { this.facing = this.towards(x, z); }

  /** look at somebody (their head: a Person, Ramu) or a point, turning the head and neck to them; null: stop */
  lookAt(at: Person | { headPosition(out: THREE.Vector3): boolean } | THREE.Vector3 | null): void { this.look = at; }

  /** the head and neck turned to what they look at (over the clip's pose), nodding a little as they talk */
  private looking(dt: number): void {
    this.lookW = Math.max(0, Math.min(1, this.lookW + (this.look ? dt * 3 : -dt * 3)));
    if (this.lookW <= 0 || !this.head || !this.neck) return;
    this.lookT += dt;
    if (this.look) {
      if (this.look instanceof THREE.Vector3) _lt.copy(this.look);
      else if (!this.look.headPosition(_lt)) return;
      this.lastLook.copy(_lt);
    } else _lt.copy(this.lastLook);
    this.actor.root.updateWorldMatrix(true, true);
    const h = this.head.getWorldPosition(_lh);
    const ry = this.actor.root.rotation.y;
    const to = _lt.sub(h);
    if (to.lengthSq() < 1e-4) return;
    to.normalize();
    // no further round than a person turns their head (~70 degrees each way), nor further up or down than ~25
    const d = Math.atan2(-to.x, -to.z) - ry;                                // the heading to it, from the body's (+: to the left)
    const yaw = Math.max(-1.2, Math.min(1.2, Math.atan2(Math.sin(d), Math.cos(d))));
    const pitch = Math.max(-0.45, Math.min(0.45, Math.asin(Math.max(-1, Math.min(1, to.y)))));
    const talk = this.actor.face.talking ? 1 : 0;
    const nod = talk * (Math.sin(this.lookT * 6.3) * 0.05 + Math.sin(this.lookT * 2.1) * 0.04);
    const sway = talk * Math.sin(this.lookT * 1.7) * 0.07;
    const k = this.lookW * this.lookW * (3 - 2 * this.lookW);
    const right = _lr.set(Math.cos(ry), 0, -Math.sin(ry));                  // the body's right
    for (const [bone, share] of [[this.neck, 0.4], [this.head, 0.6]] as const) {
      _lq.setFromAxisAngle(_up, (yaw + sway) * share * k);
      _lq2.setFromAxisAngle(right, (pitch + nod) * share * k);       // (about the right: + tips the face up)
      turnWorld(bone, _lq.multiply(_lq2));
    }
  }
  private lastLook = new THREE.Vector3();

  /** turn (over a few frames) to a heading */
  turn(ry: number): void { this.turnTo = ry; }

  /** play a one-shot clip once (`key` names the occasion), then stand */
  gesture(name: string, key: string, secs = 1.6): void {
    this.actor.once(name, key);
    this.gestureT = secs;
  }

  idle(): void { this.gestureT = 0; this.pose = null; this.actor.play('idle'); }

  /** hold a looping clip (sitting, eating, reciting) */
  hold(clip: string, timeScale = 1, fade = 0.25): void {
    this.gestureT = 0; this.pose = clip; this.poseScale = timeScale;
    this.actor.play(clip, timeScale, fade);
  }

  /** walk to (x, z) at `speed` m/s, then stand */
  walkTo(x: number, z: number, speed = 1.2): void {
    if (!this.goal) this.goal = new THREE.Vector2();
    this.goal.set(x, z);
    this.speed = speed;
  }

  /** put them somewhere at once, standing */
  place(x: number, z: number, ry?: number): void {
    this.position.set(x, this.position.y, z);
    this.goal = null;
    if (ry !== undefined) this.facing = ry;
  }

  update(dt: number): void {
    const p = this.position;
    if (this.driven !== null && this.gestureT <= 0) this.actor.move(this.driven);
    else if (this.goal) {
      const dx = this.goal.x - p.x, dz = this.goal.y - p.z, d = Math.hypot(dx, dz);
      if (d < 0.04) { this.goal = null; this.actor.move(0); }
      else {
        const step = Math.min(d, this.speed * dt);
        p.x += (dx / d) * step;
        p.z += (dz / d) * step;
        if (this.floor) p.y = this.floor(p.x, p.z);
        this.turnTo = Math.atan2(-dx, -dz);
        this.actor.move(d < 0.15 ? 0.6 : this.speed, 'idle', this.walkClip);
      }
    } else if (this.gestureT > 0) {
      if ((this.gestureT -= dt) <= 0 && this.driven === null) this.actor.play(this.pose ?? 'idle', this.pose ? this.poseScale : 1);
    } else if (this.pose) this.actor.play(this.pose, this.poseScale);
    else this.actor.move(0);
    if (this.turnTo !== null) {
      const r = this.actor.root.rotation, a = Math.atan2(Math.sin(this.turnTo - r.y), Math.cos(this.turnTo - r.y));
      r.y += a * Math.min(1, dt * 8);
      if (Math.abs(a) < 0.01) { r.y = this.turnTo; this.turnTo = null; }
    }
    if (this.actor.update(dt)) this.looking(dt);
  }
}

/** turn a bone by a rotation given in the world's frame */
function turnWorld(bone: THREE.Object3D, q: THREE.Quaternion): void {
  const parent = bone.parent!;
  parent.getWorldQuaternion(_pq);
  bone.getWorldQuaternion(_bq);
  bone.quaternion.copy(_pq.invert().multiply(q.multiply(_bq)));
  bone.updateMatrixWorld(true);
}

const _lt = new THREE.Vector3(), _lh = new THREE.Vector3(), _lr = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _lq = new THREE.Quaternion(), _lq2 = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _bq = new THREE.Quaternion();
