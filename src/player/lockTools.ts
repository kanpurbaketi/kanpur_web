import * as THREE from 'three';

/*
 Picking a car's lock, in four parts, each with its own clip (made in Katpootli, tools/katpootli/clips.mjs):
   try    a hand to the handle: a tug, a harder one, let go (it is locked)
   start  the tools out of the bag at his hip, a look at them, bent to the lock and in
   lock   at it (the loop): the left hand holds the tension wrench in the bottom of the keyhole, the right rakes the pick
   open   the turn; the tools out and back in the bag; a hand to the handle
 and the two tools, drawn in his hands: a tension wrench (a flat L of steel) and a pick with a green handle.
*/

export const PICK_TRY = 1.4, PICK_START = 1.3, PICK_OPEN = 1.1;
/** the shortest a car's lock can take with all four parts and a little raking */
export const PICK_MIN = PICK_TRY + PICK_START + PICK_OPEN + 1.5;

export type ToolsAt = 'none' | 'hand' | 'lock';
export interface PickPhase {
  clip: 'pick_try' | 'pick_start' | 'pick_lock' | 'pick_open';
  /** seconds into the clip (the loop's: seconds at it) */
  at: number;
  /** 0..1: the hands on the lock (the game's IK over the clip) */
  ik: number;
  /** 0..1: the right hand on the door's handle */
  handle: number;
  tools: ToolsAt;
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => { const c = clamp(x); return c * c * (3 - 2 * c); };

export function pickPhase(t: number, need: number): PickPhase {
  if (t < PICK_TRY) {
    // the hand on the handle from 0.3 s to 1.0 s (the two tugs are in the clip)
    const handle = smooth((t - 0.15) / 0.2) * (1 - smooth((t - 0.95) / 0.2));
    return { clip: 'pick_try', at: t, ik: 0, handle, tools: 'none' };
  }
  const open = Math.max(PICK_TRY + PICK_START, need - PICK_OPEN);
  if (t < PICK_TRY + PICK_START) {
    const at = t - PICK_TRY;
    return { clip: 'pick_start', at, ik: smooth((at - 0.85) / 0.4), handle: 0, tools: at > 0.42 ? (at > 1.15 ? 'lock' : 'hand') : 'none' };
  }
  if (t < open) return { clip: 'pick_lock', at: t - PICK_TRY - PICK_START, ik: 1, handle: 0, tools: 'lock' };
  const at = t - open;
  return { clip: 'pick_open', at, ik: 1 - smooth((at - 0.2) / 0.25), handle: smooth((at - 0.85) / 0.25), tools: at < 0.3 ? 'lock' : at < 0.78 ? 'hand' : 'none' };
}

const UP = new THREE.Vector3(0, 1, 0);
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3();
const q = new THREE.Quaternion(), q2 = new THREE.Quaternion();

function steel(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xc4c8cc, metalness: 0.85, roughness: 0.3 });
}

/** the pick: its tip at the origin, the shaft and then the handle up +y (13 cm in all) */
function makePick(): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.06, 0.0012), steel());
  shaft.position.y = 0.03;
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.0022, 0.004, 0.0009), steel());
  hook.position.set(0.0015, 0.001, 0);
  hook.rotation.z = 0.9;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.006, 0.08, 8), new THREE.MeshStandardMaterial({ color: 0x3f7a32, roughness: 0.55 }));
  handle.position.y = 0.06 + 0.04;
  g.add(shaft, hook, handle);
  return g;
}

/** the tension wrench: the short leg (1.6 cm) in the lock from the origin along -z, the long leg (6 cm) up +y */
function makeWrench(): THREE.Group {
  const g = new THREE.Group();
  const long = new THREE.Mesh(new THREE.BoxGeometry(0.0055, 0.065, 0.0016), steel());
  long.position.y = 0.03;
  const short = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.0012, 0.016), steel());
  short.position.z = -0.008;
  g.add(long, short);
  return g;
}

/** the two tools; `update` after the hands have been put where they go */
export class LockTools {
  readonly pick = makePick();
  readonly wrench = makeWrench();
  private rh: THREE.Object3D | null = null;
  private lh: THREE.Object3D | null = null;
  private rm: THREE.Object3D | null = null;
  private lm: THREE.Object3D | null = null;

  constructor(body: THREE.Object3D) {
    const find = (s: string) => { let o: THREE.Object3D | null = null; body.traverse((x) => { if (!o && (x as THREE.Bone).isBone && x.name.endsWith(s)) o = x; }); return o; };
    this.rh = find('RightHand'); this.lh = find('LeftHand');
    this.rm = find('RightHandMiddle1'); this.lm = find('LeftHandMiddle1');
    for (const o of [this.pick, this.wrench]) { o.visible = false; o.traverse((m) => { m.castShadow = false; m.frustumCulled = false; }); }
  }

  /** in `parent` (the scene), so they are sized in metres whatever the rig's scale */
  addTo(parent: THREE.Object3D): void {
    parent.add(this.pick, this.wrench);
  }

  hide(): void { this.pick.visible = this.wrench.visible = false; }

  /**
   * `at`: where they are. 'hand': both in the right hand, a look at them; 'lock': the wrench's short leg in the bottom of the
   * keyhole and its long leg under the left thumb, the pick's tip in the keyhole (`stroke` m drawn out) and its handle in the
   * right fist. `lock`: the keyhole; `fwd`: from him toward the door, level.
   */
  update(at: ToolsAt, lock: THREE.Vector3, fwd: THREE.Vector3, stroke = 0): void {
    const { rh, lh, rm, lm } = this;
    if (at === 'none' || !rh || !lh || !rm || !lm || !this.pick.parent) { this.hide(); return; }
    this.pick.visible = this.wrench.visible = true;
    const parent = this.pick.parent;
    parent.updateWorldMatrix(true, false);
    const pq = parent.getWorldQuaternion(q2).invert();
    // the fist: between the wrist and the knuckles, a little further
    const fist = (h: THREE.Object3D, m: THREE.Object3D, out: THREE.Vector3) => {
      h.getWorldPosition(out); m.getWorldPosition(d);
      return out.lerp(d, 1.35);
    };
    const place = (o: THREE.Object3D, pos: THREE.Vector3, dir: THREE.Vector3, face?: THREE.Vector3) => {
      o.position.copy(parent.worldToLocal(pos.clone()));
      q.setFromUnitVectors(UP, dir.clone().normalize());
      if (face) {
        // turn about the tool's length so its -z (the wrench's short leg) points along `face`
        const z = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        const f = face.clone().addScaledVector(dir, -face.dot(dir)).normalize();
        const ang = Math.atan2(c.crossVectors(z, f).dot(dir), z.dot(f));
        q.premultiply(new THREE.Quaternion().setFromAxisAngle(dir, ang));
      }
      o.quaternion.copy(q).premultiply(pq);
    };
    if (at === 'hand') {
      // held up in the right fist, pointing on along the fingers
      const g = fist(rh, rm, a);
      const along = b.copy(g).sub(rh.getWorldPosition(c)).normalize();
      place(this.pick, g.clone().addScaledVector(along, 0.09), along.clone().negate());
      place(this.wrench, g.clone().addScaledVector(along, 0.05).addScaledVector(UP, -0.008), along.clone().negate());
      return;
    }
    // in the lock: the tips at the keyhole, each tool's length back toward the hand that holds it
    const pickTip = a.copy(lock).addScaledVector(UP, 0.004).addScaledVector(fwd, -stroke);
    const rf = fist(rh, rm, b);
    place(this.pick, pickTip, rf.sub(pickTip));
    const wTip = c.copy(lock).addScaledVector(UP, -0.006).addScaledVector(fwd, -0.014);
    const lf = fist(lh, lm, new THREE.Vector3());
    place(this.wrench, wTip, lf.sub(wTip), fwd);
  }
}
