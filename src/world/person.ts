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
  /** walking to here (null: standing) */
  private goal: THREE.Vector2 | null = null;
  private speed = 1.2;
  private turnTo: number | null = null;
  private gestureT = 0;
  /** a looping clip held while not walking or gesturing (sitting in a chair, eating): null stands */
  pose: string | null = null;
  private poseScale = 1;
  /** the ground under them while walking (the stage, its stairs): null keeps their height */
  floor: ((x: number, z: number) => number) | null = null;

  constructor(actor: Actor, x: number, y: number, z: number, ry: number) {
    this.actor = actor;
    actor.root.position.set(x, y, z);
    actor.root.rotation.y = ry;
    actor.root.traverse((o) => { if (!this.head && (o as THREE.Bone).isBone && /Head$/.test(o.name)) this.head = o; });
    actor.face.blinking = true;
  }

  get position(): THREE.Vector3 { return this.actor.root.position; }
  get facing(): number { return this.actor.root.rotation.y; }
  set facing(r: number) { this.actor.root.rotation.y = r; this.turnTo = null; }
  get face() { return this.actor.face; }
  get visible(): boolean { return this.actor.root.visible; }
  set visible(v: boolean) { this.actor.root.visible = v; }
  get walking(): boolean { return this.goal !== null; }

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
    if (this.goal) {
      const dx = this.goal.x - p.x, dz = this.goal.y - p.z, d = Math.hypot(dx, dz);
      if (d < 0.04) { this.goal = null; this.actor.move(0); }
      else {
        const step = Math.min(d, this.speed * dt);
        p.x += (dx / d) * step;
        p.z += (dz / d) * step;
        if (this.floor) p.y = this.floor(p.x, p.z);
        this.turnTo = Math.atan2(-dx, -dz);
        this.actor.move(d < 0.15 ? 0.6 : this.speed);
      }
    } else if (this.gestureT > 0) {
      if ((this.gestureT -= dt) <= 0) this.actor.play(this.pose ?? 'idle', this.pose ? this.poseScale : 1);
    } else if (this.pose) this.actor.play(this.pose, this.poseScale);
    else this.actor.move(0);
    if (this.turnTo !== null) {
      const r = this.actor.root.rotation, a = Math.atan2(Math.sin(this.turnTo - r.y), Math.cos(this.turnTo - r.y));
      r.y += a * Math.min(1, dt * 8);
      if (Math.abs(a) < 0.01) { r.y = this.turnTo; this.turnTo = null; }
    }
    this.actor.update(dt);
  }
}
