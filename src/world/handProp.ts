import * as THREE from 'three';
import { Rider } from '../player/rider';

/*
 A thing held in somebody's right hand (the anchor's mic, the lota, a fruit), put there every frame after their clip has
 moved the hand. The hand bone points along the fingers; `GRIP` up it is the middle of the closed fist.
   'mic'   held as a stand-up comic holds one: the fist just under the chin, the elbow down by the ribs, the fingers round
           the handle and the handle nearly upright, its head (the object's +y) at the mouth. The clip's arm is moved
           there (grab_mic's pose when the rig has it, else the hold's own IK); a clip that has the hand down at the chest keeps it there (the mic at the chest), and
           one that holds the arm out (handing it over) keeps its own. `grip`: metres of the handle below the fist
   'hang'  carried by its top, upright (a lota by its neck): `grip` is the height of the neck above its origin
   'palm'  sitting in the fist, the object's origin at the grip, turned with the hand (a fruit)
   'stick' a stick held in the fist (candy floss): the fingers closed round it, the thumb round from the other side, the
           stick (the object's +y) up through the ring they make; `grip`: metres of the stick below the fist
 Rigs without a right hand (none of ours) leave the object where it is. The object lives in `parent` (any frame).
*/

export type HoldMode = 'mic' | 'hang' | 'palm' | 'stick';
const GRIP = 0.06;
const UP = new THREE.Vector3(0, 1, 0);
const v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), f = new THREE.Vector3();
const q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), e = new THREE.Euler();

export function findBone(root: THREE.Object3D, suffix: string): THREE.Object3D | null {
  let out: THREE.Object3D | null = null;
  root.traverse((o) => { if (!out && (o as THREE.Bone).isBone && o.name.endsWith(suffix)) out = o; });
  return out;
}

/**
 * The mic hold, from the grab_mic clip (assets/anims/grabbing_mic.fbx: one pose of the right arm and hand, the fist at the
 * chin round an upright mic): its first frame, kept on the loaded model (userData.micPose) for HandProp to put the arm in.
 */
export function storeMicPose(scene: THREE.Object3D, clips: THREE.AnimationClip[]): void {
  const clip = clips.find((c) => c.name === 'grab_mic');
  if (!clip) return;
  const pose: Record<string, number[]> = {};
  for (const t of clip.tracks) {
    const [node, prop] = t.name.split('.');
    if (prop !== 'quaternion' || !/Right(Arm|ForeArm|Hand)/.test(node)) continue;
    pose[node] = Array.from(t.values.slice(0, 4));
  }
  scene.userData.micPose = pose;
}

export class HandProp {
  private root: THREE.Object3D | null = null;
  private hand: THREE.Object3D | null = null;
  private head: THREE.Object3D | null = null;
  private rig: Rider | null = null;
  /** the holder's mic hold (storeMicPose), if their rig has one: the bones and the turn of each */
  private pose: { bone: THREE.Object3D; q: THREE.Quaternion }[] = [];

  /** `grip`: for 'mic', the handle below the fist; for 'hang', the height of the part held above the object's origin */
  /** 'mic': true while the clip's own arm holds it (handing it over); the hold at the mouth eases off and back */
  own = false;
  private hold = 1;
  /** 'stick': the way the stick points, eased */
  private stickDir = new THREE.Vector3();

  constructor(readonly object: THREE.Object3D, public mode: HoldMode, readonly grip = 0.07) {}

  /** in `root`'s right hand from now on (null: let go, the object stays where it was) */
  holder(root: THREE.Object3D | null): void {
    if (root !== this.root) this.hold = 0;            // a new hand: from where its clip has it (a stick eases on from the old)
    this.root = root;
    this.hand = root ? findBone(root, 'RightHand') : null;
    this.head = root ? findBone(root, 'Head') : null;
    this.rig = root ? new Rider(root) : null;
    this.pose = [];
    let stored: Record<string, number[]> | undefined;
    root?.traverse((o) => { stored ??= o.userData.micPose; });
    if (root && stored) {
      for (const [name, v] of Object.entries(stored)) {
        const bone = root.getObjectByName(name);
        if (bone) this.pose.push({ bone, q: new THREE.Quaternion().fromArray(v) });
      }
    }
  }

  get held(): boolean { return this.hand !== null; }

  update(): void {
    const { root, hand, head } = this;
    const o = this.object, parent = o.parent;
    if (!root || !hand || !parent) return;
    root.updateMatrixWorld(true);
    if (this.mode === 'mic' && head && this.rig?.ok) {
      this.micArm(root, hand, head);
      root.updateMatrixWorld(true);
    }
    hand.getWorldPosition(a);
    hand.getWorldQuaternion(q);
    b.set(0, 1, 0).applyQuaternion(q);
    const grip = a.addScaledVector(b, GRIP);
    if (this.mode === 'stick' && this.rig?.ok) {
      this.rig.grip('Right', 0.95, 0, -1);
      root.updateMatrixWorld(true);
    }
    // in a closed fist (the IK's mic hold) the handle is in the curl of the fingers: in from the knuckles, on the palm's side
    if ((this.mode === 'mic' || this.mode === 'stick') && this.rig?.hand('Right', m1, m2)) {
      hand.getWorldPosition(grip).addScaledVector(m1, 0.075).addScaledVector(m2, 0.03);
    }
    parent.updateWorldMatrix(true, false);
    const pq = parent.getWorldQuaternion(q2).invert();
    if (this.mode === 'mic' && head) {
      // the handle pointing at the mouth: 10 cm in front of the head bone and a little up
      head.getWorldPosition(v);
      facing(root, f);
      const mouth = v.addScaledVector(f, MOUTH_F).addScaledVector(UP, MOUTH_UP);
      const dir = mouth.sub(grip).normalize();
      if (this.pose.length && this.rig?.hand('Right', m1, m2)) {
        // up through the ring of the fingers (across the knuckles, index side up), leaning a little to the mouth
        const through = m3.crossVectors(m1, m2).normalize();
        if (through.y < 0) through.negate();
        dir.multiplyScalar(0.25).addScaledVector(through, 0.75).normalize();
      }
      o.position.copy(parent.worldToLocal(grip.clone().addScaledVector(dir, -this.grip)));
      o.quaternion.setFromUnitVectors(UP, dir).premultiply(pq);
    } else if (this.mode === 'stick' && this.rig?.hand('Right', m1, m2)) {
      // up through the ring of the fingers: across the knuckles toward the index's side (along x palm: always that side,
      // so it never flips over as the fist turns level, holding it out), leaned upright as a hand holds a stick, and
      // eased frame to frame
      const through = m3.crossVectors(m1, m2).normalize().addScaledVector(UP, 0.9).normalize();
      if (this.stickDir.lengthSq() < 0.5) this.stickDir.copy(through);
      this.stickDir.lerp(through, 0.35).normalize();
      o.position.copy(parent.worldToLocal(grip.clone().addScaledVector(this.stickDir, -this.grip)));
      o.quaternion.setFromUnitVectors(UP, this.stickDir).premultiply(pq);
    } else if (this.mode === 'hang') {
      // upright, turned as the holder is
      o.position.copy(parent.worldToLocal(grip.addScaledVector(UP, -this.grip)));
      e.setFromQuaternion(root.getWorldQuaternion(q), 'YXZ');
      o.quaternion.setFromAxisAngle(UP, e.y).premultiply(pq);
    } else {
      o.position.copy(parent.worldToLocal(grip));
      o.quaternion.copy(q).premultiply(pq);
    }
  }

  /** the mic arm: the clip's, moved to the hold (see 'mic') */
  private micArm(root: THREE.Object3D, hand: THREE.Object3D, head: THREE.Object3D): void {
    const rig = this.rig!;
    const f = facing(root, m1);
    const right = m2.crossVectors(f, UP).normalize();
    const mouth = head.getWorldPosition(m3).addScaledVector(f, MOUTH_F).addScaledVector(UP, MOUTH_UP);
    // where the clip has the fist
    hand.getWorldQuaternion(q2);
    const fist = hand.getWorldPosition(m4).addScaledVector(m5.set(0, 1, 0).applyQuaternion(q2), GRIP);
    // up at the mouth (talking), or down at the chest, as high as the clip holds it
    const atMouth = m5.copy(mouth).addScaledVector(f, 0.015).addScaledVector(UP, -0.14).addScaledVector(right, 0.015);
    const atChest = m6.copy(mouth).addScaledVector(f, 0.15).addScaledVector(UP, -0.42).addScaledVector(right, 0.07);
    const high = smooth((fist.y - (mouth.y - 0.45)) / 0.25);
    const target = atChest.lerp(atMouth, high);
    // held out (handing it over, taking it): the clip's own arm
    const out = fist.clone().sub(mouth).dot(f);
    this.hold += Math.max(-0.07, Math.min(0.07, (this.own ? 0 : 1) - this.hold));
    const w = (1 - smooth((out - 0.3) / 0.12)) * smooth(this.hold);
    // the rig's own mic hold (grab_mic) when it has one: the right arm and fingers put in it, over whatever the body does
    if (this.pose.length) {
      for (const { bone, q: pq } of this.pose) bone.quaternion.slerp(pq, w);
      root.updateMatrixWorld(true);
      // then the hold as a singer's: the fist below the chin and out in front, the elbow low by the ribs, the forearm
      // angled up, the wrist straight; the back of the hand to the front, knuckles to his left, the fingers round the
      // handle and the thumb over them, so the mic stands up through the fist (see update)
      const fistAt = m5.copy(mouth).addScaledVector(f, 0.09).addScaledVector(UP, -0.21).addScaledVector(right, 0.03);
      const along = m6.copy(right).multiplyScalar(-0.85).addScaledVector(UP, 0.3).addScaledVector(f, 0.15).normalize();
      const wrist = fistAt.addScaledVector(along, -0.075).addScaledVector(f, 0.03);
      const shoulder = findBoneCached(root, 'RightArm', m7);
      const pole = shoulder.addScaledVector(UP, -0.5).addScaledVector(right, 0.15).addScaledVector(f, -0.05);
      rig.reach('Right', wrist, pole, w);
      rig.palmTo('Right', m8.copy(f).negate(), w);
      rig.handTo('Right', along, m8.copy(f).negate().addScaledVector(right, -0.2), w);
      rig.grip('Right', 0.95, 0, -1);                 // the thumb round from the far side of the handle
      return;
    }
    // the fist is where the hand closes, a little past the wrist: the wrist goes that much short of it
    target.addScaledVector(UP, -0.05).addScaledVector(f, -0.02);
    const shoulder = findBoneCached(root, 'RightArm', m7);
    const pole = shoulder.addScaledVector(UP, -0.55).addScaledVector(right, 0.28).addScaledVector(f, -0.12);
    rig.reach('Right', target, pole, w);
    // the palm to the mouth's side (knuckles out), the fingers round the handle
    rig.palmTo('Right', m8.copy(f).multiplyScalar(-0.55).addScaledVector(right, -0.85).normalize(), w);
    // a fist round an upright handle: the knuckles forward and a little in and up, the palm toward the body's middle
    const along = m3.copy(f).multiplyScalar(0.8).addScaledVector(right, -0.35).addScaledVector(UP, 0.15);
    rig.handTo('Right', along, m8.copy(right).multiplyScalar(-0.9).addScaledVector(f, -0.3), w);
    rig.grip('Right', 0.95, 0);
  }
}

/** the mouth from the head bone (the base of the skull): forward, up */
const MOUTH_F = 0.1, MOUTH_UP = 0.075;
const smooth = (x: number): number => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };
const m1 = new THREE.Vector3(), m2 = new THREE.Vector3(), m3 = new THREE.Vector3(), m4 = new THREE.Vector3();
const m5 = new THREE.Vector3(), m6 = new THREE.Vector3(), m7 = new THREE.Vector3(), m8 = new THREE.Vector3();
const bones = new WeakMap<THREE.Object3D, Map<string, THREE.Object3D | null>>();
function findBoneCached(root: THREE.Object3D, suffix: string, out: THREE.Vector3): THREE.Vector3 {
  let m = bones.get(root);
  if (!m) { m = new Map(); bones.set(root, m); }
  let b = m.get(suffix);
  if (b === undefined) { b = findBone(root, suffix); m.set(suffix, b); }
  return b ? b.getWorldPosition(out) : root.getWorldPosition(out);
}
/** which way the body faces, level: from the shoulders (a rig's root can be turned round from its model) */
const fl = new THREE.Vector3(), fr = new THREE.Vector3();
function facing(root: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
  const right = findBoneCached(root, 'RightArm', fr).sub(findBoneCached(root, 'LeftArm', fl)).setY(0);
  if (right.lengthSq() < 1e-6) return out.set(0, 0, 1).applyQuaternion(root.getWorldQuaternion(q)).setY(0).normalize();
  return out.crossVectors(UP, right).normalize();
}
