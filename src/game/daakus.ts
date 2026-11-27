import * as THREE from 'three';
import { makeActors, rigHeight, type Actor, type RigName } from '../world/actors';
import { Rider } from '../player/rider';
import type { Ramu } from '../player/ramu';
import type { CollisionWorld } from '../player/collide';
import { gltfLoader } from '../world/gltf';
import { findBone } from '../world/handProp';
import { gunInFist, type Targets } from '../player/gun';
import { KUAN } from '../world/melaSite';

/*
 The daakus (Explore world's mission): a gang with revolvers about Moti Jheel, on the way to the mela and in its aisles,
 and their leader hiding down in the maut ka kuan with two of his men. Each stands guard at his place until he sees Ramu
 (in range, nothing in between) or hears a shot near him; then he comes for him: runs to where Ramu was last seen, and
 where he can see him, stops and shoots: a TOZ-34 shotgun at the shoulder (models/toz.glb; "Firing Rifle", rifle_fire,
 its kick played with each shot; the chest turned so the barrels point at him). A shot hits more often near, less when Ramu runs. The men in the well stay down there and shoot up at the
 gallery. Ramu's bullets find them as they find anybody (Targets): a head shot kills, else two to the body (the leader
 three). The leader down: the mission is done (onLeaderDown).
 They wear their own models (faces covered; tools/blender/build_ramu_rig.py --char daaku_member / daaku_leader): the
 men in black, the leader in a red checked gamchha.
*/

/** the rigs the daakus wear */
export const DAAKU_RIG: RigName = 'daaku_member';
export const LEADER_RIG: RigName = 'daaku_leader';

const SIGHT = 42;              // m a daaku sees Ramu from (nothing in the way)
const SHOOT_RANGE = 34;        // ... and shoots from
const RUN = 4.3;               // m/s, coming for him
const ALERT = 14;              // s a daaku keeps after him once he has seen or heard him
const UP = new THREE.Vector3(0, 1, 0);
/** models/toz.glb (tools/blender/build_props.py build_toz): its origin in the right fist, barrels along +z; the muzzle */
const TOZ_MUZZLE = new THREE.Vector3(0, 0.044, 0.837);
/** carried, not aimed: the barrels this far below level, ahead of him (rad) */
const CARRY_DIP = 0.6;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();

interface Daaku {
  a: Actor;
  rig: Rider;
  gun: THREE.Object3D;
  hand: THREE.Object3D | null; index: THREE.Object3D | null; arm: THREE.Object3D | null; spine: THREE.Object3D | null;
  left: THREE.Object3D | null; leftTip: THREE.Object3D | null;   // the left hand, under the fore-end
  head: THREE.Object3D | null; top: THREE.Object3D | null;
  x: number; y: number; z: number; heading: number;
  post: [number, number]; postHeading: number;
  leader: boolean; inWell: boolean;
  alert: number;                  // s left of being after Ramu
  seen: [number, number];         // where he was last seen or heard
  sees: boolean; lookT: number;   // can see him (checked every so often)
  fireT: number;                  // s to his next shot
  aimW: number;
  flinch: number;
  hits: number;
  out: boolean; fwd: boolean; sweep: boolean; kvx: number; kvz: number;
  key: number;                    // a count for the one-shot clips' keys
  shots: number;                  // his shots so far (each one plays the kick: the clip's key)
}

export class Daakus implements Targets {
  readonly group = new THREE.Group();
  private men: Daaku[] = [];
  /** a bullet of theirs hit Ramu: how hard */
  onHurt: (dmg: number) => void = () => {};
  /** their shot: the flash, the streak, the bang (Gun.shotFx) */
  onShot: (muzzle: THREE.Vector3, end: THREE.Vector3, loud: number, flesh: boolean) => void = () => {};
  /** the leader is dead */
  onLeaderDown: () => void = () => {};

  private constructor(private world: CollisionWorld, private ramu: Ramu) {}

  /**
   * The gang: `street` places to stand on the way (footpath corners), `aisles` in the mela; the leader and two of his
   * men down in the well. `from`: where Ramu starts (nobody stands right on top of him).
   */
  static async create(world: CollisionWorld, ramu: Ramu, street: [number, number][], aisles: [number, number][], from: [number, number]): Promise<Daakus> {
    const g = new Daakus(world, ramu);
    const gate: [number, number] = [-151, 330];
    // on the way: footpath corners within 45 m of the line from his start to the mela's gate, past the first 50 m
    const onWay = street.filter(([x, z]) => {
      const ax = gate[0] - from[0], az = gate[1] - from[1], l2 = ax * ax + az * az;
      const k = Math.max(0, Math.min(1, ((x - from[0]) * ax + (z - from[1]) * az) / l2));
      return Math.hypot(x - from[0] - ax * k, z - from[1] - az * k) < 45 && Math.hypot(x - from[0], z - from[1]) > 50;
    });
    const places = [...spread(onWay, 12, 22), ...spread(aisles, 8, 16)];
    // the well: the leader a little off the middle, his two men either side (the sand floor is 12 m across)
    const well: [number, number][] = [[KUAN.x + 1.5, KUAN.z - 1], [KUAN.x - 3.5, KUAN.z + 3], [KUAN.x + 4, KUAN.z + 3.5]];
    const n = places.length + well.length;
    const [men, boss, gunScene] = await Promise.all([makeActors(DAAKU_RIG, n - 1), makeActors(LEADER_RIG, 1),
      gltfLoader().loadAsync('models/toz.glb').then((x) => x.scene)]);
    const actors = [...men.slice(0, places.length), boss[0], ...men.slice(places.length)];   // the leader first in the well
    actors.forEach((a, i) => {
      const inWell = i >= places.length, leader = i === places.length;
      const [x, z] = inWell ? well[i - places.length] : places[i];
      const heading = inWell ? Math.atan2(x - KUAN.x, z - KUAN.z) + Math.PI : Math.random() * Math.PI * 2;
      const body = a.root.children[0];
      const rig = new Rider(body);
      const gun = gunScene.clone();
      gun.traverse((o) => { o.castShadow = true; });
      g.group.add(a.root, gun);
      const y = world.floorAt(x, z, 0.6);
      const d: Daaku = {
        a, rig, gun,
        hand: findBone(body, 'RightHand'), index: findBone(body, 'RightHandIndex1'), arm: findBone(body, 'RightArm'),
        spine: findBone(body, 'Spine1') ?? findBone(body, 'Spine'), head: findBone(body, 'Head'), top: findBone(body, 'HeadTop_End'),
        left: findBone(body, 'LeftHand'), leftTip: findBone(body, 'LeftHandMiddle1'),
        x, y, z, heading, post: [x, z], postHeading: heading, leader, inWell,
        alert: 0, seen: [x, z], sees: false, lookT: Math.random() * 0.3, fireT: 1 + Math.random() * 2, aimW: 0, flinch: 0,
        hits: 0, out: false, fwd: false, sweep: false, kvx: 0, kvz: 0, key: 0, shots: 0,
      };
      a.play('idle', 0.9 + Math.random() * 0.2, 0);
      a.update(Math.random() * 3);
      g.men.push(d);
    });
    return g;
  }

  /** how many are still standing */
  get left(): number { return this.men.filter((d) => !d.out).length; }
  /** where the leader is (or lies) */
  get leaderAt(): [number, number] {
    const l = this.men.find((d) => d.leader);
    return l ? [l.x, l.z] : [KUAN.x, KUAN.z];
  }

  /** Ramu knocked out and back at the start: they lose him */
  calm(): void { for (const d of this.men) { d.alert = 0; d.sees = false; } }

  update(dt: number): void {
    const R = this.ramu.position, chestY = R.y + 1.3;
    for (const d of this.men) {
      if (d.out) { this.lying(d, dt); continue; }
      const dx = R.x - d.x, dz = R.z - d.z, dh = Math.hypot(dx, dz), d3 = Math.hypot(dh, chestY - (d.y + 1.4));
      // can he see Ramu? (every so often: a ray from his eyes to Ramu's chest)
      if ((d.lookT -= dt) <= 0) {
        d.lookT = 0.25 + Math.random() * 0.1;
        d.sees = d3 < SIGHT && this.clear(d.x, d.y + 1.55, d.z, R.x, chestY, R.z) && !this.ramu.knockedOut;
        if (d.sees) { d.alert = ALERT; d.seen = [R.x, R.z]; }
      }
      if (d.alert > 0) d.alert -= dt;
      d.flinch = Math.max(0, d.flinch - dt);

      let speed = 0, aiming = false, face = d.heading;
      if (d.alert > 0 && d.sees && d3 < SHOOT_RANGE) {
        // he can see him, near enough: stand, face him, shoot
        aiming = true;
        face = Math.atan2(-dx, -dz) + Math.PI;            // (a heading h faces -sin h, -cos h)
        if ((d.fireT -= dt) <= 0 && d.flinch <= 0 && Math.abs(wrap(face - d.heading)) < 0.35 && d.aimW > 0.8) {
          this.fire(d, d3);
          d.fireT = (d.leader ? 1.0 : 1.4) + Math.random() * 1.3;
        }
      } else if (d.alert > 0 && !d.inWell) {
        // after him: to where he was last seen (or heard)
        const tx = d.seen[0] - d.x, tz = d.seen[1] - d.z, l = Math.hypot(tx, tz);
        if (l > 2.5) {
          speed = d.flinch > 0 ? 0 : RUN;
          face = Math.atan2(-tx, -tz) + Math.PI;
          const s = Math.min(speed * dt, l);
          let nx = d.x + (tx / l) * s, nz = d.z + (tz / l) * s;
          [nx, nz] = this.world.resolve(nx, nz, 0.3, d.y);
          d.x = nx; d.z = nz;
          d.y = this.world.floorAt(d.x, d.z, d.y + 0.6);
        } else d.alert = Math.min(d.alert, 3);           // nobody there: a look round, then back to waiting
      } else if (d.alert > 0) {
        face = Math.atan2(-dx, -dz) + Math.PI;            // (in the well: turned toward him, waiting for a sight of him)
      } else if (!d.inWell && Math.hypot(d.post[0] - d.x, d.post[1] - d.z) > 1.5) {
        // nothing going on: back to his place, walking
        const tx = d.post[0] - d.x, tz = d.post[1] - d.z, l = Math.hypot(tx, tz);
        speed = 1.4;
        face = Math.atan2(-tx, -tz) + Math.PI;
        let nx = d.x + (tx / l) * speed * dt, nz = d.z + (tz / l) * speed * dt;
        [nx, nz] = this.world.resolve(nx, nz, 0.3, d.y);
        d.x = nx; d.z = nz;
        d.y = this.world.floorAt(d.x, d.z, d.y + 0.6);
      } else face = d.postHeading;
      d.heading += wrap(face - d.heading) * Math.min(1, dt * (aiming ? 9 : 6));
      d.aimW += ((aiming ? 1 : 0) - d.aimW) * Math.min(1, dt * 8);
      this.keepApart(d);

      // the body
      if (d.flinch > 0) d.a.once('hit2', 'hit' + d.key, 1.4);
      else if (aiming) d.a.once('rifle_fire', 'rifle' + d.shots, 1, 0.15);   // up to the shoulder, then held; a shot: the kick again
      else d.a.move(speed);
      this.place(d);
      const posed = d.a.update(dt);
      if (posed && d.aimW > 0.05) this.aimChest(d, R.x, chestY, R.z);
      // the fingers closed on the gun: the right round the stock's wrist, the left (aimed) cradling the fore-end. Only on
      // a frame the clip set them (it keys every finger), else the turn would build up frame on frame
      if (posed) { d.rig.grip('Right', 1); if (d.aimW > 0.05) d.rig.grip('Left', 0.75 * d.aimW); }
      this.hold(d, R.x, chestY, R.z);
    }
  }

  // ---- Targets: Ramu's bullets ----

  shoot(o: THREE.Vector3, dir: THREE.Vector3, max: number): { i: number; t: number; head: boolean } | null {
    let best: { i: number; t: number; head: boolean } | null = null;
    const h2 = dir.x * dir.x + dir.z * dir.z;
    if (h2 < 1e-6) {
      // straight down (from the well's gallery): whoever is right under it
      this.men.forEach((d, i) => {
        if (d.out || Math.hypot(d.x - o.x, d.z - o.z) > 0.25) return;
        const t = (o.y - (d.y + this.tall(d))) / -dir.y;
        if (t > 0 && t < max && (!best || t < best.t)) best = { i, t, head: true };
      });
      return best;
    }
    const R = 0.26;
    this.men.forEach((d, i) => {
      if (d.out) return;
      const cx = d.x - o.x, cz = d.z - o.z;
      const tc = (cx * dir.x + cz * dir.z) / h2;
      if (tc < 0) return;
      const mx = cx - dir.x * tc, mz = cz - dir.z * tc, m2 = mx * mx + mz * mz;
      // a steep shot (down into the well) meets the body's top first: its way through the cylinder, top to bottom
      if (m2 > R * R) return;
      const half = Math.sqrt((R * R - m2) / h2);
      const tall = this.tall(d);
      // head or body by where the line passes the body's middle (what the crosshair was on), not where it first touches
      // (from above, steeply, that is always the top of the head)
      const yMid = o.y + dir.y * tc - d.y;
      for (const t of [tc - half, tc, tc + half]) {
        if (t < 0 || t > max || (best && t >= best.t)) continue;
        const y = o.y + dir.y * t - d.y;
        if (y < 0 || y > tall) continue;
        best = { i, t, head: (yMid >= 0 && yMid <= tall ? yMid : y) > tall * 0.85 };
        break;
      }
    });
    return best;
  }

  shot(i: number, dir: THREE.Vector3, head: boolean): 'dead' | 'hurt' {
    const d = this.men[i];
    d.hits++;
    d.alert = ALERT;
    d.seen = [this.ramu.position.x, this.ramu.position.z];
    const fx = -Math.sin(d.heading), fz = -Math.cos(d.heading);
    const fromBehind = fx * dir.x + fz * dir.z > 0.2;
    if (head || d.hits >= (d.leader ? 3 : 2)) {
      d.out = true;
      d.fwd = fromBehind;
      d.sweep = !head && !fromBehind;
      if (!fromBehind) d.heading = Math.atan2(dir.x, dir.z);
      d.kvx = dir.x * 0.6; d.kvz = dir.z * 0.6;
      d.aimW = 0;
      if (d.leader) this.onLeaderDown();
      return 'dead';
    }
    d.flinch = 0.55;
    d.key++;
    d.fireT = Math.max(d.fireT, 0.9);
    return 'hurt';
  }

  chestOf(i: number, out: THREE.Vector3): THREE.Vector3 { return this.men[i].a.chest(out); }

  scare(x: number, z: number, r: number): void {
    for (const d of this.men) {
      if (d.out || Math.hypot(d.x - x, d.z - z) > r) continue;
      d.alert = ALERT;
      if (!d.sees) d.seen = [x, z];
    }
  }

  // ---- inside ----

  private tall(d: Daaku): number { return rigHeight(d.leader ? LEADER_RIG : DAAKU_RIG) * (d.a.root.children[0]?.scale.y ?? 1); }

  /** nothing solid between the two points */
  private clear(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
    return this.world.fireLine(x0, y0, z0, x1, y1, z1) >= 0.98;
  }

  private place(d: Daaku): void {
    d.a.root.position.set(d.x, d.y, d.z);
    d.a.root.quaternion.setFromAxisAngle(UP, d.heading);
  }

  /** a body: the fall (face down if shot in the back, swept off the feet if in the chest, else knocked out), then still */
  private lying(d: Daaku, dt: number): void {
    if (Math.hypot(d.kvx, d.kvz) > 0.05) {
      [d.x, d.z] = this.world.resolve(d.x + d.kvx * dt, d.z + d.kvz * dt, 0.3, d.y);
      d.kvx *= Math.exp(-3 * dt); d.kvz *= Math.exp(-3 * dt);
    }
    if (d.fwd) d.a.once('fall2', 'out', 1.1);
    else if (d.sweep && d.a.has('fall_sweep')) d.a.once('fall_sweep', 'out', 1.3, 0.06);
    else d.a.once('fall', 'out', 1.25);
    this.place(d);
    d.a.update(dt);
    this.hold(d, 0, 0, 0);
  }

  /** the chest turned so the barrels (his right fist to his left hand, under the fore-end) point at Ramu's chest */
  private aimChest(d: Daaku, tx: number, ty: number, tz: number): void {
    if (!d.hand || !d.left || !d.spine) return;
    d.a.root.updateMatrixWorld(true);
    const fist = d.hand.getWorldPosition(_v), fore = this.leftGrip(d, _w);
    const want = new THREE.Vector3(tx, ty, tz).sub(fist).normalize();
    _q.setFromUnitVectors(fore.sub(fist).normalize(), want);
    _q2.identity().slerp(_q, d.aimW);
    const parent = d.spine.parent!.getWorldQuaternion(new THREE.Quaternion());
    const world = d.spine.getWorldQuaternion(new THREE.Quaternion()).premultiply(_q2);
    d.spine.quaternion.copy(parent.invert().multiply(world));
    d.spine.updateMatrixWorld(true);
  }

  /** where the left hand closes under the fore-end: the palm's middle */
  private leftGrip(d: Daaku, out: THREE.Vector3): THREE.Vector3 {
    d.left!.getWorldPosition(out);
    if (d.leftTip) out.lerp(d.leftTip.getWorldPosition(new THREE.Vector3()), 0.5);
    return out;
  }

  /**
   * The TOZ in his right fist. Aimed: along the line to his left hand (the clip holds it at the shoulder, the left hand
   * under the fore-end), turned the rest of the way onto Ramu. Carried (standing, walking, running): pointed low ahead of
   * him, from the right fist.
   */
  private hold(d: Daaku, tx: number, ty: number, tz: number): void {
    d.a.root.updateMatrixWorld(true);
    d.gun.visible = d.a.root.visible && !d.out;
    if (!d.gun.visible || !d.hand) return;
    const f = gunInFist(d.rig, d.hand, d.index);
    if (!f) return;
    const ahead = new THREE.Vector3(-Math.sin(d.heading), 0, -Math.cos(d.heading));
    let fwd = ahead.clone().multiplyScalar(Math.cos(CARRY_DIP)).addScaledVector(UP, -Math.sin(CARRY_DIP));
    if (d.aimW > 0.01 && d.left) {
      const hands = this.leftGrip(d, new THREE.Vector3()).sub(f.fist).normalize();
      const aim = new THREE.Vector3(tx, ty, tz).sub(f.fist).normalize();
      fwd.lerp(hands.lerp(aim, 0.5), d.aimW).normalize();
    }
    const up = UP.clone().addScaledVector(fwd, -UP.dot(fwd)).normalize();
    _m.makeBasis(new THREE.Vector3().crossVectors(up, fwd), up, fwd);
    d.gun.position.copy(f.fist);
    d.gun.quaternion.setFromRotationMatrix(_m);
  }

  /** a shot at Ramu: a hit more often near (and from the leader), less when he runs; a miss goes past him */
  private fire(d: Daaku, dist: number): void {
    d.gun.updateMatrixWorld(true);
    const muzzle = d.gun.localToWorld(TOZ_MUZZLE.clone());
    d.shots++;
    const R = this.ramu.position, chest = new THREE.Vector3(R.x, R.y + 1.3, R.z);
    let p = Math.max(0.1, Math.min(0.7, 0.78 - dist * 0.017));
    if (this.ramu.speed > 3) p *= 0.55;
    if (d.leader) p *= 1.15;
    const hit = Math.random() < p;
    let end: THREE.Vector3;
    if (hit) end = chest;
    else {
      // past him: off to a side by half a metre or more, on until it meets something (at most 30 m on)
      const dir = chest.clone().sub(muzzle).normalize();
      const side = new THREE.Vector3().crossVectors(dir, UP).normalize();
      const off = chest.clone().addScaledVector(side, (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.8)).addScaledVector(UP, (Math.random() - 0.4) * 0.8);
      const way = off.sub(muzzle).normalize();
      const far = muzzle.clone().addScaledVector(way, dist + 30);
      const f = this.world.fireLine(muzzle.x, muzzle.y, muzzle.z, far.x, far.y, far.z);
      end = muzzle.clone().lerp(far, Math.min(1, f));
    }
    const loud = Math.max(0, Math.min(0.9, 1.2 - dist / 45));
    this.onShot(muzzle, end, loud, hit);
    if (hit) this.onHurt(d.leader ? 14 : 9 + Math.round(Math.random() * 4));
  }

  /** not inside one another */
  private keepApart(d: Daaku): void {
    for (const o of this.men) {
      if (o === d || o.out) continue;
      const dx = d.x - o.x, dz = d.z - o.z, l = Math.hypot(dx, dz);
      if (l > 0.01 && l < 0.75) { d.x += (dx / l) * (0.75 - l) * 0.5; d.z += (dz / l) * (0.75 - l) * 0.5; }
    }
  }
}

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** up to `n` of the places, each at least `gap` m from the others (in a random order) */
function spread(places: [number, number][], n: number, gap: number): [number, number][] {
  const out: [number, number][] = [];
  const pool = [...places].sort(() => Math.random() - 0.5);
  for (const p of pool) {
    if (out.length >= n) break;
    if (out.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) >= gap)) out.push(p);
  }
  return out;
}
