import * as THREE from 'three';

/*
 A thing held in somebody's right hand (the anchor's mic, the lota, a fruit), put there every frame after their clip has
 moved the hand. The hand bone points along the fingers; `GRIP` up it is the middle of the closed fist.
   'mic'   the handle (the object's +y) from the fist toward the mouth, `grip` metres of it below the fist
   'hang'  carried by its top, upright (a lota by its neck): `grip` is the height of the neck above its origin
   'palm'  sitting in the fist, the object's origin at the grip, turned with the hand (a fruit)
 Rigs without a right hand (none of ours) leave the object where it is. The object lives in `parent` (any frame).
*/

export type HoldMode = 'mic' | 'hang' | 'palm';
const GRIP = 0.06;
const UP = new THREE.Vector3(0, 1, 0);
const v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), f = new THREE.Vector3();
const q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), e = new THREE.Euler();

export function findBone(root: THREE.Object3D, suffix: string): THREE.Object3D | null {
  let out: THREE.Object3D | null = null;
  root.traverse((o) => { if (!out && (o as THREE.Bone).isBone && o.name.endsWith(suffix)) out = o; });
  return out;
}

export class HandProp {
  private root: THREE.Object3D | null = null;
  private hand: THREE.Object3D | null = null;
  private head: THREE.Object3D | null = null;

  /** `grip`: for 'mic', the handle below the fist; for 'hang', the height of the part held above the object's origin */
  constructor(readonly object: THREE.Object3D, public mode: HoldMode, readonly grip = 0.07) {}

  /** in `root`'s right hand from now on (null: let go, the object stays where it was) */
  holder(root: THREE.Object3D | null): void {
    this.root = root;
    this.hand = root ? findBone(root, 'RightHand') : null;
    this.head = root ? findBone(root, 'Head') : null;
  }

  get held(): boolean { return this.hand !== null; }

  update(): void {
    const { root, hand, head } = this;
    const o = this.object, parent = o.parent;
    if (!root || !hand || !parent) return;
    root.updateMatrixWorld(true);
    hand.getWorldPosition(a);
    hand.getWorldQuaternion(q);
    b.set(0, 1, 0).applyQuaternion(q);
    const grip = a.addScaledVector(b, GRIP);
    parent.updateWorldMatrix(true, false);
    const pq = parent.getWorldQuaternion(q2).invert();
    if (this.mode === 'mic' && head) {
      // the handle pointing at the mouth: 10 cm in front of the head bone and a little up
      head.getWorldPosition(v);
      f.set(0, 0, 1).applyQuaternion(root.getWorldQuaternion(q));
      const mouth = v.addScaledVector(f, 0.1).addScaledVector(UP, 0.075);
      const dir = mouth.sub(grip).normalize();
      o.position.copy(parent.worldToLocal(grip.clone().addScaledVector(dir, -this.grip)));
      o.quaternion.setFromUnitVectors(UP, dir).premultiply(pq);
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
}
