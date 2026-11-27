import * as THREE from 'three';

/*
 Blood (Explore world, src/player/gun.ts): a bullet into somebody throws a spray of drops out along its way (and a few back
 toward the shooter) that fall, and each that reaches the ground leaves a spot; under a body a pool spreads for a few
 seconds. Drops are one instanced mesh, the spots and pools another (flat discs a little over the ground), each a ring
 buffer: the oldest go first. Spots and pools dry up (shrink away) after a while.
*/

const DROPS = 260;           // drops in the air at most
const MARKS = 140;           // spots and pools on the ground at most
const GRAVITY = 9.8;
const POOL_GROW = 7;         // seconds a pool takes to spread
const MARK_LIFE = 150;       // seconds a spot or a pool stays (then fades over the last 10)
const LIFT = 0.012;          // a mark this far over the ground (no flicker with it)

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const FLAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

/** a soft-edged, blotchy disc: the spots' and pools' picture */
function blotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = (x: number, y: number, r: number, a: number) => {
    const k = g.createRadialGradient(x, y, 0, x, y, r);
    k.addColorStop(0, `rgba(255,255,255,${a})`);
    k.addColorStop(0.7, `rgba(255,255,255,${a * 0.9})`);
    k.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = k;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  };
  grad(64, 64, 46, 1);
  for (let i = 0; i < 9; i++) {                       // lobes, so it is not a perfect circle
    const a = (i / 9) * Math.PI * 2 + (i % 3) * 0.4, d = 28 + (i * 7) % 14;
    grad(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 14 + (i * 5) % 10, 0.95);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Drop { x: number; y: number; z: number; vx: number; vy: number; vz: number; s: number; live: boolean }
interface Mark { x: number; y: number; z: number; size: number; age: number; grow: number; rot: number; live: boolean }

export class Blood {
  readonly group = new THREE.Group();
  private drops: Drop[] = [];
  private marks: Mark[] = [];
  private dropMesh: THREE.InstancedMesh;
  private markMesh: THREE.InstancedMesh;
  private nextDrop = 0;
  private nextMark = 0;
  /** pools waiting for their body to come down: seconds left, and where */
  private pending: { t: number; where: () => { x: number; y: number; z: number }; size: number }[] = [];

  /** `ground(x, z, y)`: the height of whatever is under (x, z) at about height y */
  constructor(private ground: (x: number, z: number, y: number) => number) {
    this.dropMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: '#6a0606', roughness: 0.35, emissive: '#200000' }), DROPS);
    this.markMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: '#4a0303', roughness: 0.25, metalness: 0, map: blotTexture(), transparent: true,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), MARKS);
    for (const m of [this.dropMesh, this.markMesh]) {
      m.frustumCulled = false;
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }
    this.markMesh.renderOrder = 2;
    for (let i = 0; i < DROPS; i++) this.drops.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 0, live: false });
    for (let i = 0; i < MARKS; i++) this.marks.push({ x: 0, y: 0, z: 0, size: 0, age: 0, grow: 0, rot: 0, live: false });
  }

  /** a bullet in at `at`, travelling along `dir`: drops out the far side, fewer back toward the shooter; `head`: more */
  spray(at: THREE.Vector3, dir: THREE.Vector3, head: boolean): void {
    const n = head ? 34 : 22;
    for (let k = 0; k < n; k++) {
      const back = k % 5 === 0;
      const sp = (back ? 1.2 : 2.2) + Math.random() * (back ? 1.5 : 3.2);
      const d = this.drops[this.nextDrop];
      this.nextDrop = (this.nextDrop + 1) % DROPS;
      const sx = (Math.random() - 0.5) * 0.9, sy = (Math.random() - 0.2) * 0.9, sz = (Math.random() - 0.5) * 0.9;
      const f = back ? -0.6 : 1;
      d.x = at.x; d.y = at.y; d.z = at.z;
      d.vx = (dir.x * f + sx) * sp; d.vy = (dir.y * f + sy) * sp + 0.6; d.vz = (dir.z * f + sz) * sp;
      d.s = 0.008 + Math.random() * 0.014;
      d.live = true;
    }
  }

  /** a pool to spread under a body once it is down (`delay` s from now): `where` says then where it lies (x, z) and the
   height a little over the ground there (the ground is looked for under it) */
  pool(where: () => { x: number; y: number; z: number }, size: number, delay: number): void {
    this.pending.push({ t: delay, where, size });
  }

  private mark(x: number, y: number, z: number, size: number, grow: number): void {
    const m = this.marks[this.nextMark];
    this.nextMark = (this.nextMark + 1) % MARKS;
    Object.assign(m, { x, y, z, size, age: 0, grow, rot: Math.random() * Math.PI * 2, live: true });
  }

  update(dt: number): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if ((p.t -= dt) > 0) continue;
      const w = p.where();
      this.mark(w.x, this.ground(w.x, w.z, w.y + 0.5), w.z, p.size, POOL_GROW);
      this.pending.splice(i, 1);
    }
    let n = 0;
    for (const d of this.drops) {
      if (!d.live) continue;
      d.vy -= GRAVITY * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      const g = this.ground(d.x, d.z, d.y + 0.3);
      if (d.y <= g) {                                    // down: a spot where it landed
        d.live = false;
        if (Math.random() < 0.6) this.mark(d.x, g, d.z, 0.04 + d.s * 6 + Math.random() * 0.05, 0);
        continue;
      }
      _s.setScalar(d.s);
      _q.identity();
      this.dropMesh.setMatrixAt(n++, _m.compose(_p.set(d.x, d.y, d.z), _q, _s));
    }
    this.dropMesh.count = n;
    this.dropMesh.instanceMatrix.needsUpdate = true;
    n = 0;
    for (const m of this.marks) {
      if (!m.live) continue;
      m.age += dt;
      if (m.age > MARK_LIFE) { m.live = false; continue; }
      const grown = m.grow > 0 ? 1 - Math.pow(1 - Math.min(1, m.age / m.grow), 2.2) : 1;
      const fade = Math.min(1, (MARK_LIFE - m.age) / 10);        // at the end it dries up: shrinks away
      const size = m.size * (m.grow > 0 ? 0.15 + 0.85 * grown : 1) * fade;
      _q.copy(FLAT).premultiply(new THREE.Quaternion().setFromAxisAngle(_p.set(0, 1, 0), m.rot));
      _s.set(size, size, 1);
      this.markMesh.setMatrixAt(n, _m.compose(_p.set(m.x, m.y + LIFT, m.z), _q, _s));
      n++;
    }
    this.markMesh.count = n;
    this.markMesh.instanceMatrix.needsUpdate = true;
  }
}
