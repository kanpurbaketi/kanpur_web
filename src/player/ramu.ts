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
  /** total jumps (for statistics) */
  jumps = 0;
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

  /**
   * Ramu: swept-back black hair, stubble and moustache, red open-collar shirt, gold chain, jeans.
   * Faces -Z; limbs hang from pivots so they can swing.
   */
  private buildBody(): void {
    const mat = (color: string, roughness = 0.85) => new THREE.MeshStandardMaterial({ color, roughness });
    const skin = mat(SKIN, 0.6), shirt = mat('#d02027', 0.8), collar = mat('#b0171d', 0.8);
    const jeans = mat('#2c3646', 0.9), hair = mat('#0d0c0f', 0.4), sandal = mat('#3a2518', 0.7);
    const gold = new THREE.MeshStandardMaterial({ color: '#e0b040', roughness: 0.3, metalness: 0.9 });
    const part = (geo: THREE.BufferGeometry, m: THREE.Material, pos: number[], parent: THREE.Object3D = this.model,
                  scale?: number[]) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(pos[0], pos[1], pos[2]);
      if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const pivot = (x: number, y: number) => {
      const g = new THREE.Group();
      g.position.set(x, y, 0);
      this.model.add(g);
      return g;
    };
    const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 4, 10).translate(0, -len / 2 - r, 0);

    // legs (pivot at the hip): jeans, sandals
    const legs = [-0.1, 0.1].map((x) => {
      const p = pivot(x, 0.9);
      part(capsule(0.078, 0.7), jeans, [0, 0, 0], p);
      part(new THREE.BoxGeometry(0.11, 0.035, 0.26), sandal, [0, -0.88, -0.04], p);
      part(new THREE.SphereGeometry(0.05, 8, 6), skin, [0, -0.85, -0.07], p, [1, 0.6, 1.6]); // foot
      return p;
    });
    part(new THREE.CylinderGeometry(0.2, 0.18, 0.16, 14), jeans, [0, 0.88, 0], this.model, [1, 1, 0.7]); // hips
    // shirt: untucked, slightly flattened torso + shoulders
    part(new THREE.CylinderGeometry(0.2, 0.235, 0.64, 14), shirt, [0, 1.2, 0], this.model, [1, 1, 0.68]);
    part(new THREE.SphereGeometry(0.21, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), shirt, [0, 1.5, 0], this.model, [1.06, 0.5, 0.72]);
    // open collar: a V of skin following the chest, collar flaps either side, gold chain
    part(openCollar(), new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.6, side: THREE.DoubleSide }), [0, 0, 0]);
    for (const sx of [-1, 1]) {
      const c = part(new THREE.BoxGeometry(0.085, 0.014, 0.05), collar, [sx * 0.072, 1.578, -0.1]);
      c.rotation.set(0.75, sx * -0.35, sx * -0.5);
    }
    const chain = part(new THREE.TorusGeometry(0.07, 0.007, 6, 24).rotateX(Math.PI / 2), gold, [0, 1.553, -0.05], this.model, [1, 1, 1.6]);
    chain.rotation.x = -0.42;
    // arms (pivot at the shoulder): red half sleeve, bare forearm, hand
    const arms = [-0.235, 0.235].map((x) => {
      const p = pivot(x, 1.49);
      part(capsule(0.057, 0.26), shirt, [0, 0, 0], p);
      part(capsule(0.048, 0.26), skin, [0, -0.32, 0], p);
      part(new THREE.SphereGeometry(0.055, 8, 6), skin, [0, -0.66, 0], p, [0.8, 1.1, 1]);
      return p;
    });
    this.limbs.push(legs[0], legs[1], arms[1], arms[0]); // arms swing opposite to the legs
    // neck, then the head as one group (slightly enlarged so the face reads at gameplay distance)
    part(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8), skin, [0, 1.58, 0]);
    const head = new THREE.Group();
    head.position.set(0, 1.6, 0);
    head.scale.setScalar(1.14);
    this.model.add(head);
    const faceMat = new THREE.MeshStandardMaterial({ map: faceTexture(), roughness: 0.6 });
    part(new THREE.SphereGeometry(0.115, 24, 18), faceMat, [0, 0.11, 0], head, [0.95, 1.12, 1]);
    for (const sx of [-1, 1]) part(new THREE.SphereGeometry(0.025, 8, 6), skin, [sx * 0.108, 0.1, 0.005], head, [0.5, 1, 0.8]);
    part(new THREE.SphereGeometry(0.019, 8, 6), skin, [0, 0.1, -0.114], head, [0.8, 1.2, 0.8]); // nose
    // hair: cap tilted back off the forehead, with a full swept-up top and extra volume behind
    part(new THREE.SphereGeometry(0.124, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5).rotateX(0.62), hair,
      [0, 0.128, 0.012], head, [0.99, 1.12, 1.05]);
    const quiff = part(new THREE.SphereGeometry(0.075, 16, 10), hair, [0.012, 0.228, -0.03], head, [1.45, 0.72, 1.3]);
    quiff.rotation.set(0.25, 0, 0.12);
    part(new THREE.SphereGeometry(0.065, 12, 8), hair, [0, 0.2, 0.065], head, [1.55, 0.95, 1.2]);
  }
}

const SKIN = '#a9714b';

/** Skin-coloured V at the open collar, bent to sit just outside the shirt's chest and shoulder curve. */
function openCollar(): THREE.BufferGeometry {
  const rows = [[1.588, -0.103, 0.05], [1.53, -0.152, 0.04], [1.47, -0.162, 0.022], [1.4, -0.156, 0.001]]; // y, z, half width
  const pos: number[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const [y0, z0, w0] = rows[i], [y1, z1, w1] = rows[i + 1];
    pos.push(-w0, y0, z0, w0, y0, z0, w1, y1, z1, -w0, y0, z0, w1, y1, z1, -w1, y1, z1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Face painted for the head sphere (equirectangular; the face is centred at u = 0.75, i.e. -Z). */
function faceTexture(): THREE.CanvasTexture {
  const W = 512, H = 256, cx = W * 0.75;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = SKIN;
  g.fillRect(0, 0, W, H);
  // warm cheeks
  for (const s of [-1, 1]) {
    const r = g.createRadialGradient(cx + s * 40, 146, 2, cx + s * 40, 146, 22);
    r.addColorStop(0, 'rgba(150,70,50,.28)');
    r.addColorStop(1, 'rgba(150,70,50,0)');
    g.fillStyle = r;
    g.fillRect(cx + s * 40 - 24, 122, 48, 48);
  }
  // stubble: jaw, chin and upper lip, fading out toward the cheeks
  const st = g.createLinearGradient(0, 132, 0, 176);
  st.addColorStop(0, 'rgba(38,32,40,0)');
  st.addColorStop(1, 'rgba(38,32,40,.4)');
  g.fillStyle = st;
  g.beginPath();
  g.moveTo(cx - 122, 110);
  g.quadraticCurveTo(cx - 70, 150, cx - 30, 150);
  g.quadraticCurveTo(cx, 140, cx + 30, 150);
  g.quadraticCurveTo(cx + 70, 150, cx + 122, 110);
  g.lineTo(cx + 122, H);
  g.lineTo(cx - 122, H);
  g.closePath();
  g.fill();
  // eyes
  for (const s of [-1, 1]) {
    const ex = cx + s * 27, ey = 127;
    g.fillStyle = '#f3efe8';
    g.beginPath();
    g.ellipse(ex, ey, 11, 5.6, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2a1a12';
    g.beginPath();
    g.arc(ex, ey, 5.2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.fillRect(ex + 1, ey - 3, 2, 2);
    g.strokeStyle = '#1a1210'; // upper lash line
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(ex - 11, ey - 1);
    g.quadraticCurveTo(ex, ey - 7, ex + 11, ey - 1);
    g.stroke();
    // thick eyebrows, higher at the outer end
    g.strokeStyle = '#120f10';
    g.lineWidth = 5.5;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(ex - s * 13, ey - 11);
    g.quadraticCurveTo(ex, ey - 17, ex + s * 15, ey - 13);
    g.stroke();
  }
  // moustache
  g.strokeStyle = 'rgba(20,16,18,.9)';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(cx - 22, 163);
  g.quadraticCurveTo(cx, 153, cx + 22, 163);
  g.stroke();
  // smile with teeth
  g.fillStyle = '#f5f1e8';
  g.strokeStyle = '#6a342a';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(cx - 20, 168);
  g.quadraticCurveTo(cx, 171, cx + 20, 168);
  g.quadraticCurveTo(cx, 186, cx - 20, 168);
  g.closePath();
  g.fill();
  g.stroke();
  // soul patch
  g.fillStyle = 'rgba(20,16,18,.7)';
  g.beginPath();
  g.ellipse(cx, 189, 5, 3.5, 0, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function moveToward(v: number, target: number, step: number): number {
  return Math.abs(target - v) <= step ? target : v + Math.sign(target - v) * step;
}
