import * as THREE from 'three';
import { CollisionWorld } from './collide';

const WALK = 4.0, RUN = 8.5, ACCEL = 12, JUMP = 5, GRAVITY = 9.8, TURN = 10, RADIUS = 0.35;
const CAM_DIST = 4.5, EYE = 1.6;

/** Ramu: third-person walk / run / jump with an orbit camera. Port of kanpur/game/scripts/player/ramu.gd. */
export class Ramu {
  readonly root = new THREE.Group();
  readonly model = new THREE.Group();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = -0.3;
  enabled = true;
  private grounded = true;
  private keys = new Set<string>();
  private touchMove = new THREE.Vector2();
  private touchRun = false;
  private jumpQueued = false;
  private limbs: THREE.Object3D[] = [];
  private stride = 0;

  constructor(private camera: THREE.PerspectiveCamera, private world: CollisionWorld, dom: HTMLElement) {
    this.buildBody();
    this.root.add(this.model);
    this.bindInput(dom);
  }

  get position(): THREE.Vector3 {
    return this.root.position;
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
    const swing = Math.sin(this.stride) * Math.min(1, hs / WALK) * 0.6;
    this.limbs.forEach((l, i) => (l.rotation.x = (i % 2 ? 1 : -1) * swing));

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

  private buildBody(): void {
    const skin = '#9e6b47';
    const part = (geo: THREE.BufferGeometry, size: number[], pos: number[], color: string, parent: THREE.Object3D = this.model) => {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
      m.scale.set(size[0], size[1], size[2]);
      m.position.set(pos[0], pos[1], pos[2]);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    const box = new THREE.BoxGeometry(1, 1, 1);
    const ball = new THREE.SphereGeometry(0.5, 10, 8);
    const limb = (x: number, y: number, len: number, w: number, color: string) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      this.model.add(pivot);
      const g = box.clone();
      g.translate(0, -0.5, 0);
      part(g, [w, len, w], [0, 0, 0], color, pivot);
      this.limbs.push(pivot);
    };
    part(box, [0.5, 0.65, 0.28], [0, 1.2, 0], '#f2992a');      // saffron kurta
    part(box, [0.52, 0.12, 0.3], [0, 0.84, 0], '#f2f2e6');     // kurta hem
    limb(-0.13, 0.8, 0.8, 0.18, '#ebebdf');                     // pyjama legs
    limb(0.13, 0.8, 0.8, 0.18, '#ebebdf');
    limb(-0.33, 1.5, 0.6, 0.14, skin);                          // arms
    limb(0.33, 1.5, 0.6, 0.14, skin);
    part(ball, [0.3, 0.34, 0.3], [0, 1.72, 0], skin);           // head
    part(box, [0.32, 0.1, 0.32], [0, 1.88, 0], '#1a1411');      // hair
    part(box, [0.62, 0.08, 0.06], [0, 1.48, 0], '#cc1a1a');     // red gamcha
    part(box, [0.2, 0.06, 0.02], [0, 1.68, -0.15], '#1a1411');  // moustache (faces -Z)
  }
}

function moveToward(v: number, target: number, step: number): number {
  return Math.abs(target - v) <= step ? target : v + Math.sign(target - v) * step;
}
