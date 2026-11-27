import * as THREE from 'three';
import type { Director } from './director';
import type { Ramu } from '../../player/ramu';
import type { Daakus } from '../daakus';
import { BULLET_SPEED } from '../../player/gun';
import { GALLERY } from '../../world/mautKuan';
import { KUAN } from '../../world/melaSite';

/*
 Explore world's mission, the scripted parts (the daakus themselves: src/game/daakus.ts):
 - the ambush: Ramu climbs to the top of the maut ka kuan, where the leader is said to hide; a shot from the kavi
   sammelan's stage hits him, he turns, and the camera finds the leader on the stage with a man either side, aiming at
   him (a cutscene: Skip lands in the same place, the three awake and shooting);
 - the bullet cam: a shot of Ramu's that will hit the leader is followed from just behind the bullet, in slow motion,
   all the way to him, and a moment after it lands.
*/

/** Ramu up on the well's gallery (its floor is the wall's top) */
export const onGallery = (r: Ramu): boolean =>
  r.position.y > GALLERY.y - 1.5 && Math.hypot(r.position.x - KUAN.x, r.position.z - KUAN.z) < KUAN.r + 2;

/** waits for Ramu on the gallery, then springs the ambush; resolves once he has control again */
export async function exploreAmbush(d: Director, ramu: Ramu, daakus: Daakus): Promise<void> {
  await d.until(() => onGallery(ramu) && !ramu.knockedOut);
  daakus.holdFire = true;
  daakus.ambush(true);                                  // the leader's shot: it hits him
  await d.wait(0.45);                                    // (the flinch)
  await d.scene(async () => {
    const L = daakus.leader, sp = L.position, R = ramu.position;
    // he turns to where it came from
    ramu.faceTowards(sp.x, sp.z);
    ramu.yaw = Math.atan2(R.x - sp.x, R.z - sp.z);
    ramu.pitch = -0.08;
    const to = new THREE.Vector3(sp.x - R.x, 0, sp.z - R.z).normalize();
    const right = new THREE.Vector3(-to.z, 0, to.x);
    const stageLook = new THREE.Vector3(sp.x, sp.y + 1.4, sp.z);
    // over his shoulder, out across the mela to the stage
    d.shot({ pos: R.clone().addScaledVector(to, -2.4).addScaledVector(right, 0.75).setY(R.y + 2.0), look: stageLook, fov: 40 }, 0.6);
    await d.wait(1.6);
    // the zoom: from far down the line to the leader's face and his gun
    const far = d.front(L, { dist: 9, side: 0.8, up: 0.9, drop: 0.2, fov: 36 });   // (inside the sammelan: its gate's banners are further out)
    d.shot(far, 0);
    await d.wait(0.15);
    d.shot(d.front(L, { dist: 3.2, side: 0.5, up: 0.05, drop: 0.25, fov: 30 }), 1.1);
    await d.wait(1.9);
    // the three of them, aiming
    const heads = daakus.stageHeads();
    const mid = heads.reduce((a, h) => a.add(h), new THREE.Vector3()).divideScalar(Math.max(1, heads.length));
    const wide = d.front(L, { dist: 5, side: -0.6, up: -0.1, drop: 0.3, fov: 52 });   // (under the sammelan's banners)
    wide.look.copy(mid).setY(mid.y - 0.35);
    d.shot(wide, 0.7);
    await d.wait(1.8);
  });
  daakus.holdFire = false;
}

/**
 * The bullet cam: Gun.onHitting hands it a shot at the leader; the game's clock slowed (Director.timeScale) so the
 * flight takes about FLIGHT s, the camera rides just behind and beside the bullet, the hit lands when it gets there, then
 * a beat at a quarter speed on him before it all comes back.
 */
const FLIGHT = 1.8;           // s (real time) the bullet takes to get there
const AFTER = 1.5;            // s (real) held on him after it lands

export class BulletCam {
  private on = false;
  private t = 0;
  private hold = 0;
  private landed = false;
  private from = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private side = new THREE.Vector3();
  private len = 0;
  private land: () => void = () => {};
  private bullet: THREE.Group;

  constructor(scene: THREE.Scene, private d: Director) {
    // a revolver round, larger than life so it reads on screen: a lead nose on a brass case, its long axis on +z
    this.bullet = new THREE.Group();
    const brass = new THREE.MeshStandardMaterial({ color: '#c9a24a', metalness: 0.85, roughness: 0.3, emissive: '#1a1205' });
    const lead = new THREE.MeshStandardMaterial({ color: '#8d8f94', metalness: 0.7, roughness: 0.35, emissive: '#202226' });
    const caseM = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.05, 16).rotateX(Math.PI / 2), brass);
    caseM.position.z = -0.025;
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 1.6), lead);
    // a faint streak of disturbed air behind it, so its path reads at a glance
    const trail = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.012, 1.6, 8, 1, true).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#fff4d8', transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }));
    trail.position.z = -0.05 - 0.8;
    this.bullet.add(caseM, nose, trail);
    this.bullet.visible = false;
    scene.add(this.bullet);
  }

  get active(): boolean { return this.on; }

  /** a shot at the leader: from `muzzle` to `end`; `land` when it gets there. False if one is already flying */
  start(muzzle: THREE.Vector3, end: THREE.Vector3, land: () => void): boolean {
    if (this.on) return false;
    this.on = true;
    this.t = 0; this.hold = 0; this.landed = false;
    this.from.copy(muzzle);
    this.len = Math.max(0.5, muzzle.distanceTo(end));
    this.dir.copy(end).sub(muzzle).divideScalar(this.len);
    this.side.set(-this.dir.z, 0, this.dir.x).normalize();
    this.land = land;
    this.d.timeScale = Math.max(0.012, Math.min(0.25, this.len / BULLET_SPEED / FLIGHT));
    this.d.locked = true;
    this.d.subs.cinema(true);
    this.bullet.visible = true;
    this.frame();
    return true;
  }

  /** `dt` the game's (slowed) time, `real` the wall clock's */
  update(dt: number, real: number): void {
    if (!this.on) return;
    this.t += dt;
    if (!this.landed && this.t * BULLET_SPEED >= this.len) {
      this.landed = true;
      this.bullet.visible = false;
      this.land();
      this.d.timeScale = 0.25;                           // the fall, slowed
    }
    if (this.landed && (this.hold += real) >= AFTER) {
      this.on = false;
      this.d.timeScale = 1;
      this.d.subs.cinema(false);
      this.d.cam.release(0.6);
      this.d.locked = false;
      return;
    }
    this.frame();
  }

  /** the camera just behind and beside the bullet, looking on down its way (after it lands: where it landed) */
  private frame(): void {
    const run = Math.min(this.len, this.t * BULLET_SPEED);
    const head = this.from.clone().addScaledVector(this.dir, run);
    this.bullet.position.copy(head);
    this.bullet.lookAt(head.clone().add(this.dir));
    // side-on at first (the round whole, its lead nose and brass case), swinging round behind it over the second half
    // of the flight, so the leader comes into view down the line ahead of it; once it lands, back a little on him
    const end = this.from.clone().addScaledVector(this.dir, this.len);
    const k = THREE.MathUtils.smoothstep(run / this.len, 0.3, 0.75);
    const back = this.landed ? 2.4 : THREE.MathUtils.lerp(0.12, 0.6, k);
    const side = this.landed ? 0.6 : THREE.MathUtils.lerp(0.3, 0.22, k);
    const pos = (this.landed ? end.clone() : head.clone())
      .addScaledVector(this.dir, -back).addScaledVector(this.side, side).add(new THREE.Vector3(0, this.landed ? 0.25 : 0.05, 0));
    const look = this.landed ? end : head.clone().addScaledVector(this.dir, THREE.MathUtils.lerp(0.12, 2, k));
    this.d.shot({ pos, look, fov: this.landed ? 38 : 32 }, 0);
  }
}
