import * as THREE from 'three';
import { Ramu } from './ramu';
import { Traffic, Vehicle } from '../world/props';
import { NIGHT } from '../world/night';
import { Pedestrians } from '../world/pedestrians';

/** how far from a vehicle's body Ramu can be to get on it, m */
const REACH = 2.4;

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
      this.car.dark = !this.lights;           // left as it was: lamps on or off
      this.horn = false;
      const [x, z] = this.traffic.leave(this.car);
      this.car = null;
      this.ramu.stepDown(x, z);
      return;
    }
    const p = this.ramu.position;
    if (p.y > 0.6) return;                          // up on a roof or a stair: no vehicle up there
    const c = this.traffic.nearest(p.x, p.z, REACH);
    if (!c) return;
    for (const t of this.traffic.board(c)) this.peds.throwOut(t.x, t.z, t.vx, t.vz, t.driver);
    this.car = c;
    this.lights = !c.dark;
    this.place();
  }

  /** Knocked out on it: he comes off. */
  drop(): void {
    if (!this.car) return;
    this.car.dark = false;
    this.traffic.leave(this.car);
    this.car = null;
    this.ramu.ride = null;
  }

  update(dt: number): void {
    if (this.car) {
      const s = this.ramu.stick();
      this.traffic.drive(this.car, dt, -s.y, -s.x, this.ramu.braking);
      this.place();
    }
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
    const [x, z] = this.traffic.toWorld(c, seat.at[0], seat.at[2]);
    this.ramu.ride = {
      x, y: 0.05 + seat.at[1], z, heading: c.heading, pose: seat.pose,
      cx: c.x, cz: c.z, speed: c.v, cam: seat.cam, camH: seat.camH,
    };
  }

  /** "E — get on" near a vehicle, "E — get off" on one */
  private showTip(): void {
    let text = '';
    if (this.car) text = Math.abs(this.car.v) < 0.5 ? `${this.key()} — get off` : '';
    else {
      const p = this.ramu.position;
      const c = !this.ramu.knockedOut && p.y < 0.6 ? this.traffic.nearest(p.x, p.z, REACH) : null;
      if (c) text = `${this.key()} — ${this.traffic.seatOf(c).pose === 'ride' ? 'get on' : 'get in'}`;
    }
    if (text === this.tipText) return;
    this.tipText = text;
    if (this.tip) {
      this.tip.textContent = text;
      this.tip.style.display = text ? 'block' : 'none';
    }
    if (this.btn) this.btn.textContent = this.car ? 'GET OFF' : 'GET IN';
  }
}
