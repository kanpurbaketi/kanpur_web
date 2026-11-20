import * as THREE from 'three';
import { NIGHT } from '../../world/night';

/*
 The cutscene camera: it takes the camera from Ramu's orbit (ramu.cinematic), eases to a shot (a place to stand, a
 point to look at, a field of view) or cuts to it, can drift slowly through a shot, and eases back to the orbit when
 the scene is over (Ramu sets the camera again each frame; this blends from where the shot left it).
 update() runs after ramu.update() in the frame.
 At night a soft warm key light rides beside the camera through a shot (faces are lit by the stalls behind them, or not
 at all: a guard's eyes under his cap's brim read as shut); it is always in the scene, dark between shots, so turning it
 on recompiles nothing.
*/

const KEY = 5;

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export interface Shot { pos: THREE.Vector3; look: THREE.Vector3; fov: number }

export class CutCam {
  private fromPos = new THREE.Vector3();
  private fromQ = new THREE.Quaternion();
  private fromFov = 70;
  private shot: Shot | null = null;
  private drift = new THREE.Vector3();
  private t = 1;
  private secs = 1;
  private releasing = false;
  private baseFov: number;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private key = new THREE.PointLight('#ffe4c4', 0, 4.5, 2);
  private side = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera, private ramu: { cinematic: boolean }) {
    this.baseFov = camera.fov;
    this.key.castShadow = false;
  }

  /** the scene the camera is in (the light goes in it) */
  attach(scene: THREE.Object3D): void { if (NIGHT && !this.key.parent) scene.add(this.key); }

  get active(): boolean { return this.shot !== null || this.releasing; }

  /** ease to a shot over `secs` (0: cut); `drift` moves the camera slowly through it (m/s) */
  to(shot: Shot, secs = 0.9, drift?: THREE.Vector3): void {
    if (!this.shot && !this.releasing) this.baseFov = this.camera.fov;
    this.ramu.cinematic = true;
    this.releasing = false;
    this.fromPos.copy(this.camera.position);
    this.fromQ.copy(this.camera.quaternion);
    this.fromFov = this.camera.fov;
    this.shot = { pos: shot.pos.clone(), look: shot.look.clone(), fov: shot.fov };
    this.drift.copy(drift ?? new THREE.Vector3());
    this.t = 0;
    this.secs = Math.max(0, secs);
    if (this.secs === 0) this.t = 1;
  }

  /** back to Ramu's orbit camera, easing over `secs` */
  release(secs = 0.8): void {
    if (!this.shot) { this.ramu.cinematic = false; return; }
    this.fromPos.copy(this.camera.position);
    this.fromQ.copy(this.camera.quaternion);
    this.fromFov = this.camera.fov;
    this.shot = null;
    this.ramu.cinematic = false;
    this.releasing = secs > 0;
    this.t = 0;
    this.secs = secs;
    if (!this.releasing) this.setFov(this.baseFov);
  }

  update(dt: number): void {
    const c = this.camera;
    if (this.shot) {
      this.t = this.secs ? Math.min(1, this.t + dt / this.secs) : 1;
      const k = ease(this.t), s = this.shot;
      s.pos.addScaledVector(this.drift, dt);
      this.m.lookAt(s.pos, s.look, c.up);
      this.q.setFromRotationMatrix(this.m);
      c.position.lerpVectors(this.fromPos, s.pos, k);
      c.quaternion.slerpQuaternions(this.fromQ, this.q, k);
      this.setFov(this.fromFov + (s.fov - this.fromFov) * k);
      this.light(k);
    } else if (this.releasing) {
      // Ramu has just put the camera where his orbit wants it: blend from the shot to there
      this.t = Math.min(1, this.t + dt / this.secs);
      const k = ease(this.t);
      c.position.lerpVectors(this.fromPos, c.position.clone(), k);
      this.q.copy(c.quaternion);
      c.quaternion.slerpQuaternions(this.fromQ, this.q, k);
      this.setFov(this.fromFov + (this.baseFov - this.fromFov) * k);
      this.light(1 - k);
      if (this.t >= 1) this.releasing = false;
    } else if (this.key.intensity) this.key.intensity = 0;
  }

  /** the key light: up and to the right of the camera, `k` of its strength */
  private light(k: number): void {
    if (!this.key.parent) return;
    const c = this.camera;
    this.side.set(0.45, 0.35, 0.1).applyQuaternion(c.quaternion);
    this.key.position.copy(c.position).add(this.side);
    this.key.intensity = KEY * k;
  }

  private setFov(f: number): void {
    if (Math.abs(this.camera.fov - f) < 1e-3) return;
    this.camera.fov = f;
    this.camera.updateProjectionMatrix();
  }
}
