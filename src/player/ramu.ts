import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CollisionWorld } from './collide';

const WALK = 4.0, RUN = 8.5, ACCEL = 12, JUMP = 5, GRAVITY = 9.8, TURN = 10, RADIUS = 0.35;
const CAM_DIST = 3.2, EYE = 1.35;

/** Ramu: third-person walk / run / jump with an orbit camera. Port of kanpur/game/scripts/player/ramu.gd. */
export class Ramu {
  readonly root = new THREE.Group();
  readonly model = new THREE.Group();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = -0.3;
  enabled = true;
  /** total jumps (for statistics) */
  jumps = 0;
  private grounded = true;
  private keys = new Set<string>();
  private touchMove = new THREE.Vector2();
  private touchRun = false;
  private jumpQueued = false;
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Record<string, THREE.AnimationAction> = {};
  private current: THREE.AnimationAction | null = null;
  private wasGrounded = true;

  constructor(private camera: THREE.PerspectiveCamera, private world: CollisionWorld, dom: HTMLElement) {
    this.buildBody();
    this.root.add(this.model);
    this.bindInput(dom);
  }

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  /** horizontal speed, m/s */
  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  /** forget held keys (e.g. when a menu takes focus) */
  releaseKeys(): void {
    this.keys.clear();
    this.touchMove.set(0, 0);
  }

  update(dt: number): void {
    const input = new THREE.Vector2();
    if (this.enabled) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) input.y -= 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) input.y += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) input.x -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) input.x += 1;
      input.add(this.touchMove);
      if (this.jumpQueued && this.grounded) {
        this.vel.y = JUMP;
        this.grounded = false;
        this.jumps++;
      }
    }
    this.jumpQueued = false;
    if (input.lengthSq() > 1) input.normalize();
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const dir = new THREE.Vector3(input.x * cos + input.y * sin, 0, -input.x * sin + input.y * cos);
    const running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchRun;
    const speed = running ? RUN : WALK;
    const step = ACCEL * speed * dt;
    this.vel.x = moveToward(this.vel.x, dir.x * speed, step);
    this.vel.z = moveToward(this.vel.z, dir.z * speed, step);
    this.vel.y -= GRAVITY * dt;

    const p = this.root.position;
    p.x += this.vel.x * dt;
    p.z += this.vel.z * dt;
    p.y += this.vel.y * dt;
    if (p.y <= 0) {
      p.y = 0;
      this.vel.y = 0;
      this.grounded = true;
    }
    [p.x, p.z] = this.world.resolve(p.x, p.z, RADIUS, p.y);

    // face movement direction + simple limb swing
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (dir.lengthSq() > 0.0025) {
      const want = Math.atan2(-dir.x, -dir.z);
      let d = want - this.model.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.model.rotation.y += d * Math.min(1, TURN * dt);
    }
    this.animate(dt, hs);

    this.updateCamera();
  }

  private updateCamera(): void {
    const p = this.root.position;
    const px = p.x, py = p.y + EYE, pz = p.z;
    const cp = Math.cos(this.pitch);
    const bx = Math.sin(this.yaw) * cp, by = -Math.sin(this.pitch), bz = Math.cos(this.yaw) * cp;
    const t = this.world.raycast(px, py, pz, px + bx * CAM_DIST, py + by * CAM_DIST, pz + bz * CAM_DIST);
    const d = Math.max(0.4, CAM_DIST * t - 0.25);
    this.camera.position.set(px + bx * d, Math.max(0.3, py + by * d), pz + bz * d);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  private bindInput(dom: HTMLElement): void {
    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space') this.jumpQueued = true;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('click', () => {
      if (matchMedia('(pointer: fine)').matches) dom.requestPointerLock?.();
    });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== dom) return;
      this.look(e.movementX, e.movementY);
    });
    this.bindTouch(dom);
  }

  private look(dx: number, dy: number, k = 0.0025): void {
    this.yaw -= dx * k;
    this.pitch = Math.max(-1.2, Math.min(0.5, this.pitch - dy * k));
  }

  /** Left half: virtual joystick. Right half: drag to look. Buttons: run toggle, jump. */
  private bindTouch(dom: HTMLElement): void {
    const stick = document.getElementById('stick')!;
    const knob = document.getElementById('knob')!;
    let moveId = -1, lookId = -1;
    let sx = 0, sy = 0, lx = 0, ly = 0;
    dom.addEventListener('touchstart', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX < innerWidth / 2 && moveId < 0) {
          moveId = t.identifier;
          sx = t.clientX;
          sy = t.clientY;
          stick.style.display = 'block';
          stick.style.left = `${sx - 60}px`;
          stick.style.top = `${sy - 60}px`;
        } else if (lookId < 0) {
          lookId = t.identifier;
          lx = t.clientX;
          ly = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    dom.addEventListener('touchmove', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === moveId) {
          const dx = t.clientX - sx, dy = t.clientY - sy;
          const len = Math.min(50, Math.hypot(dx, dy));
          const a = Math.atan2(dy, dx);
          knob.style.transform = `translate(${Math.cos(a) * len}px, ${Math.sin(a) * len}px)`;
          this.touchMove.set((Math.cos(a) * len) / 50, (Math.sin(a) * len) / 50);
        } else if (t.identifier === lookId) {
          this.look(t.clientX - lx, t.clientY - ly, 0.005);
          lx = t.clientX;
          ly = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === moveId) {
          moveId = -1;
          this.touchMove.set(0, 0);
          stick.style.display = 'none';
          knob.style.transform = '';
        } else if (t.identifier === lookId) lookId = -1;
      }
    };
    dom.addEventListener('touchend', end);
    dom.addEventListener('touchcancel', end);
    const runBtn = document.getElementById('btn-run')!;
    runBtn.addEventListener('touchstart', (e) => {
      this.touchRun = !this.touchRun;
      runBtn.classList.toggle('on', this.touchRun);
      e.preventDefault();
    });
    document.getElementById('btn-jump')!.addEventListener('touchstart', (e) => {
      this.jumpQueued = true;
      e.preventDefault();
    });
  }

  /**
   * Ramu: the generated teen model with a Mixamo skeleton (tools/blender/build_ramu_rig.py -> public/models/ramu_rig.glb),
   * with idle / walk / jog / run / jump clips. The file faces +Z, the game faces -Z, hence the half turn.
   */
  private buildBody(): void {
    new GLTFLoader().loadAsync('models/ramu_rig.glb').then((gltf) => {
      gltf.scene.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.frustumCulled = false;                 // the skinned bounds do not follow the animation
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.roughness = 0.82;
        mat.metalness = 0;
        if (mat.map) mat.map.anisotropy = 8;
      });
      gltf.scene.rotation.y = Math.PI;
      this.model.add(gltf.scene);
      this.mixer = new THREE.AnimationMixer(gltf.scene);
      for (const clip of gltf.animations) {
        const name = clip.name.replace(/^.*\|/, '');
        const a = this.mixer.clipAction(clip);
        if (name === 'jump') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
        this.actions[name] = a;
      }
      this.play('idle', 0);
    }).catch((e) => console.error('Ramu model failed to load', e));
  }

  /** Crossfade to a clip (no-op if it is already the current one). */
  private play(name: string, fade = 0.18): THREE.AnimationAction | null {
    const next = this.actions[name];
    if (!next) return null;
    if (this.current !== next) {
      next.reset().setEffectiveWeight(1).play();
      if (this.current) this.current.crossFadeTo(next, fade, false);
      this.current = next;
    }
    return next;
  }

  /** Pick the clip from what Ramu is doing and set its playback speed to match the ground speed. */
  private animate(dt: number, hs: number): void {
    if (!this.mixer) return;
    if (!this.grounded) {
      if (this.wasGrounded) { const j = this.play('jump', 0.08); if (j) { j.reset().play(); j.timeScale = 1.15; } }
    } else if (hs < 0.25) {
      this.play('idle');
    } else if (hs < 2.6) {
      this.play('walk')!.timeScale = hs / 1.5;
    } else if (hs < 6.0) {
      this.play('jog')!.timeScale = hs / 3.3;
    } else {
      this.play('run')!.timeScale = hs / 6.8;
    }
    this.wasGrounded = this.grounded;
    this.mixer.update(dt);
  }
}

function moveToward(v: number, target: number, step: number): number {
  return Math.abs(target - v) <= step ? target : v + Math.sign(target - v) * step;
}
