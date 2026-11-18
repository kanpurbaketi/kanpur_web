import * as THREE from 'three';
import { Ramu } from './ramu';
import { Traffic, Vehicle } from '../world/props';
import { NIGHT } from '../world/night';
import { VehicleAudio } from '../game/audio';
import { Pedestrians } from '../world/pedestrians';

/** how far from a vehicle's body Ramu can be to get on it, m */
const REACH = 2.4;
/** seconds to get on, and off */
const MOUNT = 0.75, DISMOUNT = 0.55;
/** seconds to pick a parked vehicle's lock: a car, a two-wheeler with an engine; a cycle has none worth the name */
const PICK_CAR = 15, PICK_BIKE = 5;
/** how far Ramu can shift while picking before he has let go of it, m */
const PICK_STILL = 0.6;
/** the owner, if they are about: within this of their vehicle when he starts; how likely it is that they are; how long they keep after him */
const OWNER_NEAR = 25, OWNER_CHANCE = 0.55, OWNER_GRUDGE = 25;

interface Picking { car: Vehicle; t: number; need: number; x: number; z: number; owner: number; notice: number; seen: boolean; hits: number }

/**
 * Ramu takes vehicles. The get-on key on foot: onto the nearest vehicle within reach; whoever was on it is thrown off
 * (one of the street crowd lands where they fall, gets up and runs). On it, the movement keys drive it (forward / back:
 * throttle, brake and reverse; left / right: steer; jump: hand brake) and the camera follows; the key again: off, beside
 * the seat, and the vehicle rolls to a stop and stays there.
 */
export class Driving {
  car: Vehicle | null = null;
  private tip = document.getElementById('use-tip');
  private btn = document.getElementById('btn-use');
  private tipText = '';
  /** night: the two beams of the vehicle Ramu drives (always in the scene, so no shader recompiles; dark when unused) */
  private beams: THREE.SpotLight[] = [];
  /** headlights on (L) */
  lights = true;
  /** the horn is held (H) */
  horn = false;
  /** how far on he is: 0 beside it .. 1 on it; going up while getting on, down while getting off */
  private w = 0;
  private leaving = false;
  /** where he stood when he got on, in the vehicle's frame (he climbs on from there) */
  private from: [number, number] = [0, 0];
  /** the vehicle's body matrix, for the rider */
  private frame = new THREE.Matrix4();
  private audio = new VehicleAudio();
  /** seconds since the last knock was heard (scraping along a wall is not a thud every frame) */
  private sinceThud = 0;
  /** picking a lock: which vehicle, how far along, where he stands, the owner (a crowd handle, -1: nobody) and when they notice */
  private pick: Picking | null = null;
  /** a line shown in the tip for a while (the owner shouting), and how long it stays */
  private shout = '';
  private shoutT = 0;

  constructor(scene: THREE.Scene, private traffic: Traffic, private ramu: Ramu, private peds: Pedestrians, private key: () => string) {
    ramu.onUse = () => this.use();
    ramu.onKey = (a, down) => {
      if (a === 'horn') this.horn = down && !!this.car;
      else if (this.car) this.lights = !this.lights;
    };
    if (NIGHT) {
      for (let i = 0; i < 2; i++) {
        const l = new THREE.SpotLight('#fff1d6', 0, 42, 0.42, 0.55, 1.6);
        l.castShadow = false;
        scene.add(l, l.target);
        this.beams.push(l);
      }
    }
  }

  get driving(): boolean {
    return this.car !== null;
  }

  use(): void {
    if (this.ramu.knockedOut || this.ramu.stun > 0) return;
    if (this.car) {
      this.leaving = true;                    // he climbs off (update), then steps down
      this.horn = false;
      return;
    }
    const p = this.ramu.position;
    if (p.y > 0.6) return;                          // up on a roof or a stair: no vehicle up there
    if (this.pick) { this.pick = null; return; }             // the key again: he gives up on the lock
    const c = this.traffic.nearest(p.x, p.z, REACH);
    if (!c) return;
    if (c.locked) {
      const need = this.pickTime(c);
      if (need > 0) {
        // the owner may be about: they notice him at it a few seconds in (if he is still at it)
        const owner = Math.random() < OWNER_CHANCE ? this.peds.ownerNear(c.x, c.z, OWNER_NEAR) : -1;
        this.pick = { car: c, t: 0, need, x: p.x, z: p.z, owner, notice: Math.min(need * 0.5, 2) + Math.random() * Math.max(0.5, Math.min(8, need - 4)), seen: false, hits: this.ramu.hits };
        this.ramu.faceTowards(c.x, c.z);
        return;
      }
    }
    this.take(c);
  }

  /** seconds to pick the lock of this vehicle */
  private pickTime(c: Vehicle): number {
    const kind = this.traffic.kindOf(c);
    return kind === 'cycle' || kind === 'rickshaw' ? 0 : this.traffic.seatOf(c).pose === 'ride' ? PICK_BIKE : PICK_CAR;
  }

  /** the lock is open (or there was none): on it, whoever was on it thrown off */
  private take(c: Vehicle): void {
    const p = this.ramu.position;
    for (const t of this.traffic.board(c)) this.peds.throwOut(t.x, t.z, t.vx, t.vz, t.driver);
    this.car = c;
    this.lights = !c.dark;
    this.w = 0;
    const dx = p.x - c.x, dz = p.z - c.z, co = Math.cos(c.heading), sn = Math.sin(c.heading);
    this.from = [dx * co - dz * sn, dx * sn + dz * co];
    this.leaving = false;
    this.place();
  }

  /** Knocked out on it: he comes off. */
  drop(): void {
    if (!this.car) return;
    this.car.dark = false;
    this.traffic.leave(this.car);
    this.car = null;
    this.leaving = false;
    this.ramu.ride = null;
  }

  /** picking a lock (null when he is not) for tests / the HUD: seconds done and needed */
  get picking(): { t: number; need: number } | null {
    return this.pick ? { t: this.pick.t, need: this.pick.need } : null;
  }

  /** at the lock: it opens in time if he keeps still; moving off, being hit or knocked out stops him */
  private picking_(dt: number): void {
    const k = this.pick!, p = this.ramu.position;
    if (this.ramu.knockedOut || this.ramu.stun > 0 || this.ramu.hits !== k.hits || Math.hypot(p.x - k.x, p.z - k.z) > PICK_STILL || k.car.player || !k.car.locked) {
      this.pick = null;
      return;
    }
    k.t += dt;
    if (!k.seen && k.owner >= 0 && k.t >= k.notice) {
      k.seen = true;
      if (this.peds.where(k.owner)) {
        this.peds.comeFor(k.owner, OWNER_GRUDGE);
        this.say('"Oye! Meri gaadi!" The owner saw you');
      }
    }
    if (k.t >= k.need) {
      this.pick = null;
      k.car.locked = false;
      this.take(k.car);
    }
  }

  private say(text: string): void {
    this.shout = text;
    this.shoutT = 3;
  }

  update(dt: number): void {
    if (this.shoutT > 0) this.shoutT -= dt;
    if (this.pick) this.picking_(dt);
    if (this.car) {
      // getting on or off: the vehicle held still meanwhile; on it: the keys drive
      const busy = this.w < 1 || this.leaving;
      this.w = Math.max(0, Math.min(1, this.w + (this.leaving ? -dt / DISMOUNT : dt / MOUNT)));
      const s = busy ? { x: 0, y: 0 } : this.ramu.stick();
      this.traffic.drive(this.car, dt, -s.y, -s.x, !busy && this.ramu.braking, busy);
      this.place();
      const b = this.car.sim;
      if (b) {
        this.sinceThud += dt;
        if (b.knock > 2.5 || (b.knock > 0.8 && this.sinceThud > 0.35)) { this.audio.thud(b.knock); this.sinceThud = 0; }
        this.audio.update({
          kind: this.traffic.kindOf(this.car), rpm: b.rpm, throttle: Math.max(0, -s.y) * (busy ? 0 : 1), speed: b.vx,
          slip: b.locked ? Math.min(1, Math.abs(b.vx) / 5) : Math.max(b.slipR, b.slipF * 0.5), horn: this.horn,
          dead: this.car.damage >= 100,
        }, dt);
      }
      if (this.leaving && this.w <= 0) {
        this.car.dark = !this.lights;         // left as it was: lamps on or off
        const [x, z] = this.traffic.leave(this.car);
        this.car = null;
        this.leaving = false;
        this.ramu.stepDown(x, z);
      }
    }
    if (!this.car) this.audio.update(null, dt);
    this.aimBeams();
    document.body.classList.toggle('driving', !!this.car);
    this.showTip();
  }

  /** the headlights: from the lamps (one beam for a single lamp), dipped a little onto the road ahead */
  private aimBeams(): void {
    const c = this.car;
    if (c) c.dark = !this.lights;
    if (!this.beams.length) return;
    const lamps = c && this.lights ? this.traffic.headlamps(c) : [];
    this.beams.forEach((l, i) => {
      const at = lamps.length === 1 ? (i ? null : lamps[0]) : lamps[i];
      if (!c || !at) { l.intensity = 0; return; }
      const [x, z] = this.traffic.toWorld(c, at[0], at[2]);
      const [tx, tz] = this.traffic.toWorld(c, at[0] * 1.6, at[2] + 14);
      l.position.set(x, at[1] + 0.05, z);
      l.target.position.set(tx, 0, tz);
      l.intensity = lamps.length === 1 ? 240 : 170;
    });
  }

  /** Ramu on his seat */
  private place(): void {
    const c = this.car!, seat = this.traffic.seatOf(c);
    const [sx, sz] = this.leaving ? this.traffic.standPoint(c) : this.traffic.toWorld(c, this.from[0], this.from[1]);
    this.ramu.ride = {
      frame: this.traffic.bodyMatrix(c, this.frame), kind: this.traffic.kindOf(c), steer: c.steer, dist: c.dist, w: this.w, sx, sz,
      heading: c.heading, cx: c.x, cz: c.z, speed: c.v, cam: seat.cam, camH: seat.camH,
    };
  }

  /** "E — get on" near a vehicle, "E — get off" on one */
  private showTip(): void {
    let text = '';
    if (this.car) {
      const dead = this.car.damage >= 100 ? ' (engine dead)' : '';
      text = Math.abs(this.car.v) < 0.5 && this.w >= 1 && !this.leaving ? `${this.key()} — get off${dead}` : '';
    }
    else if (this.pick) {
      const k = this.pick, f = k.t / k.need, bar = 20;
      text = `Picking the lock  ${'█'.repeat(Math.round(f * bar))}${'░'.repeat(bar - Math.round(f * bar))}  ${Math.ceil(k.need - k.t)} s — keep still (${this.key()}: give up)`;
    }
    else {
      const p = this.ramu.position;
      const c = !this.ramu.knockedOut && p.y < 0.6 ? this.traffic.nearest(p.x, p.z, REACH) : null;
      const need = c?.locked ? this.pickTime(c) : 0;
      if (c) text = need ? `${this.key()} — pick the lock (${need} s)` : `${this.key()} — ${this.traffic.seatOf(c).pose === 'ride' ? 'get on' : 'get in'}`;
    }
    if (this.shoutT > 0) text = text ? `${this.shout}\n${text}` : this.shout;
    if (text === this.tipText) return;
    this.tipText = text;
    if (this.tip) {
      this.tip.textContent = text;
      this.tip.style.display = text ? 'block' : 'none';
    }
    if (this.btn) this.btn.textContent = this.car ? 'GET OFF' : this.pick ? 'STOP' : 'GET IN';
  }
}
