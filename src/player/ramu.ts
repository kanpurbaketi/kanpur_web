import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CollisionWorld } from './collide';

const WALK = 4.0, RUN = 8.5, ACCEL = 12, JUMP = 5, GRAVITY = 9.8, TURN = 10, RADIUS = 0.35;
const CAM_DIST = 3.2, EYE = 1.3;

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
  private limb: { thigh: THREE.Object3D[]; shin: THREE.Object3D[]; arm: THREE.Object3D[]; fore: THREE.Object3D[] } | null = null;
  private stride = 0;

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
    this.stride += hs * dt * 2.2;
    if (this.limb) {
      const g = gait(this.stride, Math.min(1, hs / WALK));
      for (const k of ['thigh', 'shin', 'arm', 'fore'] as const) this.limb[k].forEach((o, i) => (o.rotation.x = g[k][i]));
    }

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
   * Ramu, modelled in Blender to match assets/ramu-3d.png (tools/blender/build_ramu.py -> public/models/ramu.glb).
   * One textured material; limbs are separate nodes with pivots at hip / knee / shoulder / elbow, so they can swing.
   * The model faces +Z in the file, the game faces -Z, hence the half turn.
   */
  private buildBody(): void {
    const tex = new THREE.TextureLoader().load('models/ramu_atlas.png');
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
    new GLTFLoader().loadAsync('models/ramu.glb').then((gltf) => {
      const node = (n: string) => gltf.scene.getObjectByName(n)!;
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.material = mat;
        m.castShadow = true;
      });
      gltf.scene.rotation.y = Math.PI;
      this.limb = {
        thigh: [node('thigh_L'), node('thigh_R')], shin: [node('shin_L'), node('shin_R')],
        arm: [node('arm_L'), node('arm_R')], fore: [node('fore_L'), node('fore_R')],
      };
      this.model.add(gltf.scene);
    }).catch((e) => console.error('Ramu model failed to load', e));
  }
}

/** Swing angles (radians) for each limb at a point in the stride; pure so it is easy to tune. */
function gait(stride: number, amount: number) {
  const swing = Math.sin(stride) * amount * 0.6, vel = Math.cos(stride) * amount;
  // model faces +Z, so a negative x rotation swings forward; knees bend while a leg comes through
  const knee = (side: number) => Math.max(0, -side * vel) * 0.9;
  return {
    thigh: [swing, -swing], shin: [knee(1), knee(-1)],
    arm: [-swing * 0.8, swing * 0.8], fore: [-0.12 - amount * 0.3, -0.12 - amount * 0.3],
  };
}

function moveToward(v: number, target: number, step: number): number {
  return Math.abs(target - v) <= step ? target : v + Math.sign(target - v) * step;
}
