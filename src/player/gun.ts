import * as THREE from 'three';
import type { Ramu } from './ramu';
import type { Controls } from '../game/controls';
import type { CollisionWorld } from './collide';
import type { Rider } from './rider';
import type { Blood } from '../world/blood';
import { gltfLoader } from '../world/gltf';
import { findBone } from '../world/handProp';
import { playSfx } from '../game/story/sfx';
import { t, onLang } from '../i18n';

/*
 Weapons (Explore world): his fists or the revolver (public/models/revolver.glb, tools/blender/build_props.py
 build_revolver), changed with the weapon key (Q), 1 / 2 or the mouse wheel. With the revolver the punch key (click)
 shoots and the aim key (right click) brings it up over his shoulder; bullets never run out.
 A shot goes where the crosshair (the middle of the screen) points: from the game's camera (Ramu.aimFrom, aimDir), past Ramu, to the first person or
 wall in the way. A person hit bleeds (src/world/blood.ts) and, mostly, dies (Pedestrians.shot); a wall throws up dust.
 Everybody near runs; the guards come for him.
 The arm: while he aims (or just after a shot) the right arm is put straight out at the target (Rider.reach, the elbow
 down), the wrist turned so the barrel lies along the shot, the fingers closed on the handle; otherwise the gun just
 rides in his fist as the clip swings it.
*/

export type Weapon = 'fists' | 'revolver';
const WEAPONS: Weapon[] = ['fists', 'revolver'];
/** where the muzzle is on the model, from its origin (the fist): build_revolver prints it */
export const MUZZLE = new THREE.Vector3(0, 0.069, 0.24);
/** the barrel lies this far above the line from wrist to knuckles (radians): how a hand closes on a pistol's grip */
const GRIP_TILT = 0.45;
/** the handle this far down the knuckle line (index toward little finger) from the index knuckle: the middle of the fist */
const FIST_DOWN = 0.035;
export const BULLET_SPEED = 260;     // m/s the streak flies at (slower than a real bullet, so the eye catches it)
const STREAK = 2.4;            // m long, the streak
const TRAIL_LIFE = 0.9;        // s the trail hangs in the air
/** the clips' moments: gun_point held with the arm out (frame 25), gun_aim's shot from its frame 7 to its end */
const POINT_T = 24 / 30, AIM_CLIP_KICK = 6 / 30, AIM_CLIP_END = 35 / 30;
const RANGE = 120;             // m a bullet carries
const COOLDOWN = 0.32;         // s between shots (a revolver: as fast as the hammer comes back)
const RECOIL = 0.16;           // radians the arm kicks up, easing back over a fraction of a second
const SCARE = 70;              // m within which a shot sends people running

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _t = new THREE.Vector3();

/** bone turned by `q` in the world (about its own joint) */
function turnWorld(bone: THREE.Object3D, q: THREE.Quaternion): void {
  const parent = bone.parent!.getWorldQuaternion(_q3);
  const world = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(q);
  bone.quaternion.copy(parent.invert().multiply(world));
  bone.updateMatrixWorld(true);
}

/** the upper body of a clip (spine, neck, head, shoulders, arms, hands: not the legs, not the fingers), laid over a pose */
const UPPER = /(Spine\d?|Neck|Head|(Left|Right)(Shoulder|Arm|ForeArm|Hand))$/;
class UpperClip {
  private parts: { bone: THREE.Object3D; f: THREE.Interpolant }[] = [];
  /** the clip's hips: not laid over (the legs stay as they are), but their lean carried into the spine above them */
  private hips: { bone: THREE.Object3D; f: THREE.Interpolant } | null = null;
  constructor(clip: THREE.AnimationClip, root: THREE.Object3D) {
    for (const tr of clip.tracks) {
      const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(tr.name);
      if (propertyName !== 'quaternion') continue;
      const bone = THREE.PropertyBinding.findNode(root, nodeName) as THREE.Object3D | null;
      // (each track makes its own interpolant: for a quaternion track, a slerp between keys)
      const f = (tr as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant();
      if (bone && /Hips$/.test(nodeName)) this.hips = { bone, f };
      else if (bone && UPPER.test(nodeName)) this.parts.push({ bone, f });
    }
  }
  /** the pose at `t` s, `w` of the way from the one there now */
  apply(t: number, w: number): void {
    if (w <= 0.001) return;
    for (const p of this.parts) {
      _q.fromArray(p.f.evaluate(t) as unknown as number[]);
      // the bone on the hips: as the clip's hips would hold it, under the hips there now
      if (this.hips && p.bone.parent === this.hips.bone) {
        _q2.fromArray(this.hips.f.evaluate(t) as unknown as number[]);
        _q.premultiply(_q2).premultiply(_q3.copy(this.hips.bone.quaternion).invert());
      }
      p.bone.quaternion.slerp(_q, w);
    }
  }
}
const UP = new THREE.Vector3(0, 1, 0);

/** whoever can be shot: the street crowd and the mela's (Pedestrians), the daakus (src/game/daakus.ts) */
export interface Targets {
  /** the first of them a shot from `o` along `d` hits within `max` m: who, how far along, in the head or not */
  shoot(o: THREE.Vector3, d: THREE.Vector3, max: number): { i: number; t: number; head: boolean } | null;
  /** person `i` hit by a bullet travelling along `d` */
  shot(i: number, d: THREE.Vector3, head: boolean): 'dead' | 'hurt';
  /** where person `i`'s chest is now (a body: where it lies) */
  chestOf(i: number, out: THREE.Vector3): THREE.Vector3;
  /** a gunshot at (x, z), heard `r` m round */
  scare(x: number, z: number, r: number): void;
}

/**
 * A revolver in a right fist as the hand is now (Rider: the hand's bones): where its handle sits (the origin of
 * models/revolver.glb) and which way it points (its barrel, its top). Ramu's and the daakus'.
 */
export function gunInFist(rig: Rider, hand: THREE.Object3D, index: THREE.Object3D | null): { fist: THREE.Vector3; fwd: THREE.Vector3; up: THREE.Vector3 } | null {
  const along = new THREE.Vector3(), palm = new THREE.Vector3();
  if (!rig.hand('Right', along, palm)) return null;
  const across = new THREE.Vector3().crossVectors(palm, along).normalize();      // index to little finger
  const fist = hand.getWorldPosition(new THREE.Vector3());
  if (index) fist.lerp(index.getWorldPosition(new THREE.Vector3()), 0.8); else fist.addScaledVector(along, 0.07);
  // into the fist: the skinned fingers close lower than the knuckle bones (a rig may have one finger bone for all four)
  fist.addScaledVector(palm, 0.022).addScaledVector(across, FIST_DOWN).addScaledVector(along, 0.025);
  const up = across.clone().negate();
  const fwd = along.clone().multiplyScalar(Math.cos(GRIP_TILT)).addScaledVector(up, Math.sin(GRIP_TILT)).normalize();
  return { fist, fwd, up };
}

export function glowTexture(inner: string, outer: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, inner);
  r.addColorStop(0.35, outer);
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const ICON: Record<Weapon, string> = {
  fists: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11V7a1.5 1.5 0 0 1 3 0v3M10 10V6a1.5 1.5 0 0 1 3 0v4M13 10V6.5a1.5 1.5 0 0 1 3 0V11M16 11V8.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L5 14.5a1.6 1.6 0 0 1 2.4-2L9 14"/></svg>',
  revolver: '<svg viewBox="0 0 24 24" width="24" height="22" fill="currentColor"><path d="M2 7h13l1-1h2v2h4v3H12l-1 1v1H9.5L8 19H4.5l1.8-7H4.5L4 10H2z"/></svg>',
};

export class Gun {
  weapon: Weapon = 'fists';
  private model: THREE.Object3D | null = null;
  private readonly holder = new THREE.Group();
  private cool = 0;
  private aimW = 0;
  private kick = 0;
  private flash: THREE.Sprite;
  private light: THREE.PointLight;
  private flashT = 0;
  /** the bullets in flight: a bright streak running from the muzzle to where it hit, and a faint trail left behind */
  private bullets: { streak: THREE.Mesh; trail: THREE.Mesh; from: THREE.Vector3; dir: THREE.Vector3; len: number; t: number; bare: boolean }[] = [];
  private puffs: { s: THREE.Sprite; t: number }[] = [];
  /** others' muzzle flashes (shotFx) */
  private flashes: { s: THREE.Sprite; t: number }[] = [];
  private hud = document.createElement('div');
  private cross = document.createElement('div');
  private hitT = 0;
  /** where the crosshair's line meets the first thing in its way (world), this frame */
  private aimPoint = new THREE.Vector3();
  private bones: { arm: THREE.Object3D; fore: THREE.Object3D; hand: THREE.Object3D; index: THREE.Object3D | null } | null = null;
  private reach = 0;
  /** the gun clips (baked into the rig: gun_aim two-handed, gun_point one-handed), false if the rig has none */
  private clips: { aim: UpperClip; point: UpperClip } | false | null = null;
  private twoW = 0;
  /** where the two-handed clip is: 0 held steady, else playing a shot's recoil through */
  private shootT = 0;
  /** the turn of the chest that lays the barrel along the shot (eased) */
  private corr = new THREE.Quaternion();
  private spine: THREE.Object3D | null = null;
  private fingers: { bone: THREE.Bone; q: THREE.Quaternion }[] | null = null;
  private wasDrawn = false;
  /** what the shots have done (tests read it) */
  readonly tally = { shots: 0, hits: 0, kills: 0 };

  constructor(private scene: THREE.Scene, private ramu: Ramu, private controls: Controls,
              private world: CollisionWorld, private crowds: Targets[], private blood: Blood) {
    scene.add(this.holder);
    this.holder.visible = false;
    gltfLoader().loadAsync('models/revolver.glb').then((g) => {
      g.scene.traverse((o) => { o.castShadow = true; });
      this.model = g.scene;
      this.holder.add(g.scene);
    }).catch((e) => console.error('revolver failed to load', e));

    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,250,220,1)', 'rgba(255,170,40,.85)'),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.scale.setScalar(0.16);
    this.flash.visible = false;
    this.light = new THREE.PointLight('#ffc46a', 0, 7, 2);
    scene.add(this.flash, this.light);
    for (let k = 0; k < 4; k++) {
      const s = new THREE.Sprite(this.flash.material.clone());
      s.scale.setScalar(0.22);
      s.visible = false;
      scene.add(s);
      this.flashes.push({ s, t: 0 });
    }
    // the bullets' streaks and trails: a unit tube along +z (0..1), stretched from the muzzle to the end
    const tube = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    for (let k = 0; k < 14; k++) {
      const streak = new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ color: '#ffd889', transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      const trail = new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ color: '#e8e2d6', transparent: true, opacity: 0,
        depthWrite: false }));
      for (const m of [streak, trail]) { m.frustumCulled = false; m.visible = false; scene.add(m); }
      this.bullets.push({ streak, trail, from: new THREE.Vector3(), dir: new THREE.Vector3(), len: 0, t: TRAIL_LIFE, bare: false });
    }

    this.hud.id = 'weapon';
    this.cross.id = 'crosshair';
    this.cross.innerHTML = '<i></i><i></i><i></i><i></i><b></b>';
    document.body.append(this.hud, this.cross);
    this.drawHud();
    onLang(() => this.drawHud());

    addEventListener('keydown', (e) => {
      if (e.repeat || !this.ramu.enabled) return;
      if (this.controls.matches('weapon', e.code)) this.choose(WEAPONS[(WEAPONS.indexOf(this.weapon) + 1) % WEAPONS.length]);
      else if (e.code === 'Digit1') this.choose('fists');
      else if (e.code === 'Digit2') this.choose('revolver');
    });
    addEventListener('wheel', (e) => {
      if (!document.pointerLockElement || !this.ramu.enabled || Math.abs(e.deltaY) < 4) return;
      const k = WEAPONS.indexOf(this.weapon) + (e.deltaY > 0 ? 1 : -1);
      this.choose(WEAPONS[(k + WEAPONS.length) % WEAPONS.length]);
    }, { passive: true });
    this.hud.addEventListener('click', () => this.choose(WEAPONS[(WEAPONS.indexOf(this.weapon) + 1) % WEAPONS.length]));
  }

  /** more people who can be shot (the daakus, once they are in) */
  addTargets(t: Targets): void { this.crowds.push(t); }

  /**
   * A shot that will hit someone, offered before it lands (Explore world: the bullet cam, for the daakus' leader): true
   * takes it, and `land` is then called when the bullet gets there (the hit, the blood, the fall); false: it lands now.
   */
  onHitting: ((crowd: Targets, i: number, muzzle: THREE.Vector3, end: THREE.Vector3, land: () => void) => boolean) | null = null;

  choose(w: Weapon): void {
    if (w === this.weapon) return;
    this.weapon = w;
    if (w === 'revolver') void playSfx('cock', 0.8);
    this.drawHud();
  }

  private drawHud(): void {
    this.hud.innerHTML = `${ICON[this.weapon]}<span>${t(this.weapon === 'fists' ? 'weapon.fists' : 'weapon.revolver')}</span>` +
      (this.weapon === 'revolver' ? `<em>${t('weapon.ammo')}</em>` : '');
    this.hud.dataset.w = this.weapon;
  }

  /** after Ramu's update (his clip has posed him), before the frame is drawn */
  update(dt: number): void {
    const r = this.ramu;
    const sk = r.skeleton;
    const drawn = this.weapon === 'revolver' && !!sk && !r.ride;
    r.armed = this.weapon === 'revolver' && !r.ride;
    this.holder.visible = drawn && !!this.model;
    document.body.classList.toggle('gun-out', r.armed && !r.cinematic);
    this.cross.classList.toggle('aim', r.aimHeld);
    this.cross.classList.toggle('hit', this.hitT > 0);
    this.hitT = Math.max(0, this.hitT - dt);
    this.cool = Math.max(0, this.cool - dt);
    this.kick = Math.max(0, this.kick - dt * 7);
    this.effects(dt);
    // the right hand's fingers back as they were before they are closed on the handle: the clips do not move them on every
    // rig (the adult's), and the grip turns them on from where they are, so they would go on turning frame after frame
    if (sk && !this.fingers) {
      this.fingers = [];
      sk.traverse((o) => {
        if ((o as THREE.Bone).isBone && /RightHand(Index|Middle|Ring|Pinky|Thumb)\d/.test(o.name)) this.fingers!.push({ bone: o as THREE.Bone, q: o.quaternion.clone() });
      });
    }
    if (this.fingers && (drawn || this.wasDrawn)) for (const f of this.fingers) f.bone.quaternion.copy(f.q);
    this.wasDrawn = drawn;
    if (!drawn || !sk) { r.takeShots(); return; }
    if (!this.bones) {
      const arm = findBone(sk, 'RightArm'), fore = findBone(sk, 'RightForeArm'), hand = findBone(sk, 'RightHand');
      if (!arm || !fore || !hand) return;
      this.bones = { arm, fore, hand, index: findBone(sk, 'RightHandIndex1') };
      sk.updateMatrixWorld(true);
      const p0 = arm.getWorldPosition(new THREE.Vector3()), p1 = fore.getWorldPosition(new THREE.Vector3()), p2 = hand.getWorldPosition(new THREE.Vector3());
      this.reach = (p0.distanceTo(p1) + p1.distanceTo(p2)) * 0.96;
    }
    const b = this.bones;

    // the crosshair's line: from the camera, past Ramu, to the first thing in the way
    const dir = r.aimDir(new THREE.Vector3());
    const o = this.rayStart(dir);
    const hit = this.trace(o, dir);
    this.aimPoint.copy(o).addScaledVector(dir, hit.t);

    // the arm up at it while aiming (or just after a shot): two-handed while aimed (right click), one-handed from the hip
    const want = r.aimingPose ? 1 : 0;
    this.aimW += (want - this.aimW) * Math.min(1, dt * (want ? 14 : 6));
    this.twoW += ((r.aimHeld ? 1 : 0) - this.twoW) * Math.min(1, dt * 10);
    if (this.shootT > 0 && (this.shootT += dt) >= AIM_CLIP_END) this.shootT = 0;   // a shot's recoil played through: held again
    const rig = r.rider;
    if (!this.clips) {
      const aimC = r.clip('gun_aim'), pointC = r.clip('gun_point');
      this.clips = aimC && pointC ? { aim: new UpperClip(aimC, sk), point: new UpperClip(pointC, sk) } : false;
    }
    sk.updateMatrixWorld(true);
    const shoulder = b.arm.getWorldPosition(_v);
    const aim = _w.copy(this.aimPoint).sub(shoulder).normalize();
    const gunUp = _b.copy(UP).addScaledVector(aim, -UP.dot(aim)).normalize();
    // the recoil: the gun's muzzle flips up (the two-handed clip has its own kick in the arms)
    const kickAxis = _a.crossVectors(aim, UP).normalize();
    const kicked = aim.clone().applyAxisAngle(kickAxis, RECOIL * this.kick * (1 - 0.5 * this.twoW)).normalize();
    if (this.clips && rig && this.aimW > 0.01) {
      // the clips' arms and chest over whatever the legs are doing
      this.clips.point.apply(POINT_T, this.aimW * (1 - this.twoW));
      this.clips.aim.apply(this.shootT, this.aimW * this.twoW);
      sk.updateMatrixWorld(true);
      // then the chest turned so the arm (shoulder to hand: the clips aim along it) points at the crosshair's mark (eased:
      // a clip's recoil still shows)
      const sh = b.arm.getWorldPosition(new THREE.Vector3()), hand = b.hand.getWorldPosition(new THREE.Vector3());
      const goal = _q.setFromUnitVectors(hand.sub(sh).normalize(), _t.copy(this.aimPoint).sub(sh).normalize());
      this.corr.slerp(goal, Math.min(1, dt * 18));
      const spine = this.spine ?? (this.spine = findBone(sk, 'Spine1') ?? findBone(sk, 'Spine'));
      if (spine) turnWorld(spine, _q2.identity().slerp(this.corr, this.aimW));
      // from the hip: the forearm flicks up with the shot
      if (this.kick > 0 && this.twoW < 0.5) turnWorld(b.fore, _q2.setFromAxisAngle(kickAxis, RECOIL * 1.6 * this.kick * this.aimW));
    } else if (!this.clips && rig && this.aimW > 0.01) {
      // (no gun clips in this rig: the arm reached up at it)
      const right = new THREE.Vector3().crossVectors(aim, UP).normalize();
      const target = shoulder.clone().addScaledVector(kicked, this.reach);
      const pole = shoulder.clone().addScaledVector(UP, -1).addScaledVector(right, 0.6);
      rig.reach('Right', target, pole, this.aimW);
      const along = kicked.clone().multiplyScalar(Math.cos(GRIP_TILT)).addScaledVector(gunUp, -Math.sin(GRIP_TILT));
      const palm = new THREE.Vector3().crossVectors(UP, kicked).normalize();
      rig.handTo('Right', along, palm, this.aimW);
    }
    if (this.aimW <= 0.01) this.corr.identity();
    rig?.grip('Right', 1);
    sk.updateMatrixWorld(true);

    // the gun in the fist: aimed, along the shot; carried, as the hand holds it
    const f = rig && gunInFist(rig, b.hand, b.index);
    if (!f) return;
    const fwd = f.fwd.clone().lerp(kicked, this.aimW).normalize();
    const up = f.up.clone().lerp(gunUp, this.aimW);
    up.addScaledVector(fwd, -up.dot(fwd)).normalize();
    const x = new THREE.Vector3().crossVectors(up, fwd);
    _m.makeBasis(x, up, fwd);
    this.holder.position.copy(f.fist);
    this.holder.quaternion.setFromRotationMatrix(_m);

    // shots
    const n = r.takeShots();
    if (n > 0 && this.cool <= 0) this.fire(o, dir);
  }

  /** where a shot's line starts: on the camera's line, level with Ramu (nothing between him and the camera is hit) */
  private rayStart(dir: THREE.Vector3): THREE.Vector3 {
    const c = this.ramu.aimFrom, p = this.ramu.position;
    const along = Math.max(0, (p.x - c.x) * dir.x + (p.y + 1.3 - c.y) * dir.y + (p.z - c.z) * dir.z);
    return c.clone().addScaledVector(dir, along);
  }

  /** how far down the line from `o` it meets the floor under it (walked in steps, finer near), or `max` */
  private groundAlong(o: THREE.Vector3, dir: THREE.Vector3, max: number): number {
    let prev = 0;
    for (let t = 0.5; t < max; t += t < 30 ? 0.5 : 1.5) {
      const x = o.x + dir.x * t, y = o.y + dir.y * t, z = o.z + dir.z * t;
      if (y < -1) return t;
      if (y <= this.world.floorAt(x, z, y + 0.4)) {
        // between the last step above and this one
        for (let k = 0; k < 5; k++) {
          const m = (prev + t) / 2, ym = o.y + dir.y * m;
          if (ym <= this.world.floorAt(o.x + dir.x * m, o.z + dir.z * m, ym + 0.4)) t = m; else prev = m;
        }
        return t;
      }
      prev = t;
    }
    return max;
  }

  /** the first thing along the line: a person (which crowd, who, head or body) or a wall / the ground, `t` m along */
  private trace(o: THREE.Vector3, dir: THREE.Vector3): { t: number; crowd: Targets | null; i: number; head: boolean; wall: boolean } {
    let tw = RANGE, wall = false;
    const f = this.world.fireLine(o.x, o.y, o.z, o.x + dir.x * RANGE, o.y + dir.y * RANGE, o.z + dir.z * RANGE);
    if (f < 1) { tw = f * RANGE; wall = true; }
    if (dir.y < -0.01) {                                  // the ground (the floor under each point of the way: down into the well too)
      const tg = this.groundAlong(o, dir, tw);
      if (tg < tw) { tw = tg; wall = true; }
    }
    let best: { t: number; crowd: Targets | null; i: number; head: boolean; wall: boolean } = { t: tw, crowd: null, i: -1, head: false, wall };
    for (const c of this.crowds) {
      const h = c.shoot(o, dir, best.t);
      if (h && h.t < best.t) best = { t: h.t, crowd: c, i: h.i, head: h.head, wall: false };
    }
    return best;
  }

  private fire(o: THREE.Vector3, dir: THREE.Vector3): void {
    this.cool = COOLDOWN;
    this.kick = 1;
    this.shootT = AIM_CLIP_KICK;
    this.tally.shots++;
    void playSfx('shot', 1);
    const muzzle = this.holder.localToWorld(MUZZLE.clone());
    // the flash and its light, the bullet's streak
    this.flash.position.copy(muzzle);
    this.flash.material.rotation = Math.random() * Math.PI;
    this.flash.visible = true;
    this.light.position.copy(muzzle);
    this.light.intensity = 12;
    this.flashT = 0.05;
    const hit = this.trace(o, dir);
    const end = o.clone().addScaledVector(dir, hit.t);
    const shot = this.launch(muzzle, end);
    for (const c of this.crowds) c.scare(this.ramu.position.x, this.ramu.position.z, SCARE);
    if (hit.crowd) {
      const crowd = hit.crowd, i = hit.i, head = hit.head;
      const land = () => {
        this.tally.hits++;
        this.hitT = 0.25;
        const what = crowd.shot(i, dir, head);
        this.blood.spray(end, dir, head);
        void playSfx('flesh', 0.9);
        if (what === 'dead') {
          this.tally.kills++;
          // a pool under the body once it is down, spreading from the chest
          this.blood.pool(() => crowd.chestOf(i, new THREE.Vector3()).addScaledVector(UP, -0.4), 1.1 + Math.random() * 0.5, 1.6);
        }
      };
      // (taken by the bullet cam: it flies its own round, the streak would only blaze past the camera beside it)
      if (this.onHitting?.(crowd, i, muzzle, end, land)) shot.bare = true;
      else land();
    } else if (hit.wall && hit.t < RANGE) {
      this.puff(end);
      if (Math.random() < 0.35) void playSfx('ricochet', 0.5);
    }
  }

  /** dust where a bullet strikes */
  /** a bullet's streak and trail, from the muzzle to `end` (the oldest one reused) */
  private launch(muzzle: THREE.Vector3, end: THREE.Vector3): Gun['bullets'][number] {
    const b = this.bullets.reduce((a, c) => (c.t > a.t ? c : a));
    b.from.copy(muzzle);
    b.len = Math.max(0.01, muzzle.distanceTo(end));
    b.dir.copy(end).sub(muzzle).divideScalar(b.len);
    b.t = 0;
    b.bare = false;
    for (const m of [b.streak, b.trail]) {
      m.position.copy(muzzle);
      m.lookAt(end);
      m.scale.set(0.001, 0.001, 0.001);
    }
    b.streak.visible = true;
    return b;
  }

  /**
   * Somebody else's shot (a daaku's): its flash at `muzzle`, its streak to `end`, the bang (`loud`: 0..1, by how far off),
   * dust where it strikes unless it struck a person (`flesh`); no streak (`streak` false) for one the bullet cam follows
   */
  shotFx(muzzle: THREE.Vector3, end: THREE.Vector3, loud: number, flesh: boolean, streak = true): void {
    const f = this.flashes.find((x) => x.t <= 0) ?? this.flashes[0];
    f.s.position.copy(muzzle);
    f.s.material.rotation = Math.random() * Math.PI;
    f.s.visible = true;
    f.t = 0.06;
    this.launch(muzzle, end).bare = !streak;
    if (loud > 0.02) void playSfx('shot', loud);
    if (!flesh) this.puff(end);
  }

  private puff(at: THREE.Vector3): void {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: PUFF, color: '#b8ab95', transparent: true, depthWrite: false, opacity: 0.9 }));
    s.position.copy(at);
    s.scale.setScalar(0.15);
    this.scene.add(s);
    this.puffs.push({ s, t: 0 });
  }

  private effects(dt: number): void {
    if (this.flashT > 0 && (this.flashT -= dt) <= 0) { this.flash.visible = false; this.light.intensity = 0; }
    for (const f of this.flashes) if (f.t > 0 && (f.t -= dt) <= 0) f.s.visible = false;
    for (const b of this.bullets) {
      if (b.t >= TRAIL_LIFE) continue;
      b.t += dt;
      // the streak: STREAK m long, its head at BULLET_SPEED from the muzzle, gone once it has arrived
      const run = b.t * BULLET_SPEED, head = Math.min(b.len, run), tail = Math.min(b.len, Math.max(0, run - STREAK));
      b.streak.visible = !b.bare && tail < b.len - 0.01;
      if (b.streak.visible) {
        b.streak.position.copy(b.from).addScaledVector(b.dir, tail);
        b.streak.scale.set(0.011, 0.011, head - tail);
      }
      // the trail: from the muzzle to the head, thinning out and widening as it fades
      const age = b.t / TRAIL_LIFE;
      b.trail.visible = b.t < TRAIL_LIFE && head > 0.05;
      (b.trail.material as THREE.MeshBasicMaterial).opacity = 0.32 * (1 - age) * (1 - age);
      const r = 0.006 + age * 0.03;
      b.trail.scale.set(r, r, head);
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.t += dt;
      p.s.scale.setScalar(0.15 + p.t * 1.2);
      p.s.position.y += dt * 0.3;
      (p.s.material as THREE.SpriteMaterial).opacity = Math.max(0, 0.9 - p.t * 1.8);
      if (p.t > 0.5) { this.scene.remove(p.s); p.s.material.dispose(); this.puffs.splice(i, 1); }
    }
  }
}

const PUFF = glowTexture('rgba(255,255,255,.9)', 'rgba(255,255,255,.45)');
