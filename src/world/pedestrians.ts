import { FOOTPATHS } from './footpaths';
import * as THREE from 'three';
import { MapData } from './types';
import { Actor, CLIP_SECS, KICK_LANDS, makeActors, PUNCH_LANDS, RigName } from './actors';

/*
 Random pedestrians.
 A fixed pool of people is kept around the player: they walk the street network (footpath where a road
 has one, otherwise the edge of the carriageway), pick a random turn at each junction, pause now and then,
 and some just stand around. Anyone left far behind is moved to a street ahead / out of sight.
 Meeting the player: brushed against, a person takes a step back and aside, waits a moment and walks on. Punched, they
 reel (take the punch), turn on him and hit back for a while. The third punch (the fifth, for a security guard) lays them
 out: they stay down, and are only put back on their feet somewhere else once the player is long gone.
 Everybody is a rigged model (see actors.ts): uncles, aunties, women in burqas, college girls and boys, and (in the mela only)
 security guards, each kind in several looks. Nobody starts a fight: the guards go for Ramu only where huntIf allows (inside
 the mela), anybody punched hits back, and an owner who catches him at their vehicle comes after him.
*/

const SPAWN_MIN = 60, SPAWN_MAX = 170, DESPAWN = 195; // metres from the player
const SIDEWALK_Y = 0.16;
// the guards run at the player and punch / kick (where huntIf allows)
const AGGRO = 14, CHASE = 3.4, REACH = 1.6, PUNCH_DMG = 8, KICK_DMG = 12;
// anybody else, once punched: hits back for a while (not as hard as a goon, and does not follow as far or as fast)
const ANGRY = 9, ANGRY_RANGE = 8, ANGRY_CHASE = 2.3, ANGRY_DMG = 0.6;
// somebody who caught Ramu at their vehicle: comes after him from far off, as fast and as hard as a guard
const GRUDGE_RANGE = 35;
/** who is in a crowd, as shares of it (the rest are uncles). No goons: nobody picks a fight with Ramu for nothing. */
export type Mix = Partial<Record<RigName, number>>;
export const STREET_MIX: Mix = { aunty: 0.14, girl: 0.18, boy: 0.16, burqa: 0.08 };
/** the mela's: the same, with its guards (they go for Ramu once he is in, see huntIf) */
export const MELA_MIX: Mix = { ...STREET_MIX, security: 0.12 };
const FLINCH = 0.95;          // seconds spent taking a punch
const TOUGH = 3;              // punches it takes to lay an ordinary person out
const OUT_SECS = 40, OUT_AWAY = 45;   // a laid-out person is put back on the streets after this long, once the player is this far off
// an attack: [the moment the blow lands, how long the whole thing takes], seconds. The rigged punch clip is played at
// ACTOR_PUNCH times its speed.
const ACTOR_PUNCH = 1.8, ACTOR_KICK = 1.5;
const ACTOR_ATK: [number, number] = [PUNCH_LANDS / ACTOR_PUNCH, CLIP_SECS.punch / ACTOR_PUNCH];
const ACTOR_KICK_ATK: [number, number] = [KICK_LANDS / ACTOR_KICK, CLIP_SECS.kick / ACTOR_KICK];
const BLOCK = 0.7;            // seconds a blocked punch holds them
// a rigged person thrown by a vehicle: the fall and a moment on the ground, then the get-up (seconds, and clip speeds)
const V_FALL = 2.6, V_FALL_SPEED = 1.7, V_GETUP_SPEED = 1.4, V_GETUP = CLIP_SECS.get_up / V_GETUP_SPEED;

interface Link { to: number; off: number; y: number }
interface Node { x: number; z: number; links: Link[] }

interface Ped {
  speed: number;
  jitter: number;     // personal sideways offset
  dodge: number;      // stepping round something in the way: to which side (±1), 0 when not
  a: number; b: number; link: Link; t: number; len: number;
  x: number; y: number; z: number; heading: number;
  moving: number; wait: number;
  fresh: boolean;     // not on a street yet
  hostile: boolean;   // a guard: goes for the player where huntIf allows
  grudge: number;     // seconds left of coming after him from far off (an owner who caught him at their vehicle)
  mode: number;       // 0 normal, 1 after the player
  atkKind: number;    // 0 none, 1 punch, 2 kick
  atkT: number; atkE: number; struck: boolean; cool: number; stun: number; guard: number;
  down: number; downT: number; kvx: number; kvz: number; panic: number;   // knocked down: time left, time since the fall, knock velocity, running away
  hits: number; tough: number;      // punches taken, and how many lay them out
  flinch: number;     // seconds left of reeling from a punch
  angry: number;      // seconds left of wanting to hit back
  out: boolean;       // laid out for good (until put back, far from the player)
  atkN: number;       // attacks thrown so far (names each punch for the rigged clip)
  block: number; blockN: number;    // seconds left of holding a block, and blocks so far
  fwd: boolean;       // laid out face down (hit from behind)
  falls: number; bumpN: number;     // times thrown by a vehicle / brushed against (name those clips)
  rig: RigName; idleClip: string;   // which kind of person, and how they are standing while they wait
  ox: number; oz: number; hold: number; bump: number;   // step back when brushed against: offset from their line, pause, time before the next
  linger: number;     // chance of stopping for a while at a junction
  actor: Actor;       // the rigged model
}

/** how the rigged kinds carry themselves: walking speed (m/s, from .. to) and how often they stop and stand */
const RIGGED: Record<RigName, { speed: [number, number]; linger: number; tough: number }> = {
  uncle: { speed: [0.95, 1.25], linger: 0.12, tough: TOUGH },
  security: { speed: [0.8, 1.0], linger: 0.45, tough: 5 },     // on his round until he sees Ramu, then after him; a harder man to put down
  goon: { speed: [1.05, 1.35], linger: 0.08, tough: TOUGH },
  burqa: { speed: [0.8, 1.05], linger: 0.25, tough: TOUGH },
  girl: { speed: [1.0, 1.3], linger: 0.15, tough: TOUGH },
  boy: { speed: [1.1, 1.45], linger: 0.12, tough: TOUGH },
  aunty: { speed: [0.8, 1.05], linger: 0.25, tough: TOUGH },     // in no hurry, and stops to talk
};
const ACTOR_RANGE = 95;
const BODY = 0.27;        // a person's radius, m
const RAMU = 0.33;        // Ramu's
const SOLID_RANGE = 60;   // m from the player within which people are kept out of each other and of things   // metres from the player beyond which a rigged person is not drawn or animated

export class Pedestrians {
  readonly group = new THREE.Group();
  private nodes: Node[] = [];
  private peds: Ped[] = [];
  private active = 0;
  /** called with the damage when a goon lands a punch or a kick on the player */
  onHurt: ((damage: number) => void) | null = null;
  /** where the player has to be for the guards to go for him (the mela: once he is inside); null: anywhere */
  huntIf: ((x: number, z: number) => boolean) | null = null;
  /** how far off a guard spots the player where huntIf allows, m */
  huntRange = AGGRO;
  /** collision (walls etc.) for goons on the run: returns the corrected [x, z] */
  resolve: ((x: number, z: number, y?: number) => [number, number]) | null = null;
  /** the vehicles: a person standing where one is is put beside it (the corrected [x, z]) */
  vehiclePush: ((x: number, z: number, r: number) => [number, number]) | null = null;
  /** where the nearest person hit by the last punch was (the puncher turns to face them) */
  lastHit: { x: number; z: number } | null = null;
  /** other people and keep-clear places the walkers step round ([x, z, r]: the story's keepers and line, a cutscene's ground) */
  obstacles: (() => [number, number, number][]) | null = null;
  /** a moving vehicle at a point, if one is there: its velocity (so a car can knock people over) */
  vehicleAt: ((x: number, z: number, r: number) => { vx: number; vz: number; speed: number } | null) | null = null;
  private rigged: number[] = [];     // indices of everybody (test scripts read it)
  private want = 0;
  private dt = 0;
  private fx = 0;
  /** the guards go for the player this frame (he is where huntIf says) */
  private hunt = false;
  private fz = 0;

  /** `local`: a fixed crowd on a small street graph (the mela): people stay on it and never get recycled around the player */
  constructor(map: MapData, private local = false) {
    this.buildGraph(map);
  }

  /** number of people currently on the streets */
  get count(): number {
    return this.active;
  }

  /** Change the crowd size (up to the number made by populate). Takes effect on the next update. */
  setCount(n: number): void {
    this.want = Math.max(0, Math.round(n) || 0);
    n = Math.min(this.want, this.peds.length);
    for (let i = this.active; i < n; i++) this.peds[i].fresh = true;
    this.active = n;
  }

  /**
   * Make the crowd: `n` people: uncles, aunties, college girls and boys, some security guards and a few goons, mixed up so that a smaller crowd
   * (setCount) keeps the same mix. The models load in the background; the people appear when they have.
   */
  async populate(n: number, mix: Mix = STREET_MIX): Promise<void> {
    if (n <= 0) return;
    try {
      const made: [RigName, Actor][] = [];
      const kinds = Object.entries(mix).map(([name, f]) => [name, Math.round(n * (f ?? 0))] as [RigName, number]);
      kinds.unshift(['uncle', Math.max(0, n - kinds.reduce((a, [, k]) => a + k, 0))]);
      for (const [name, k] of kinds) if (k > 0) for (const a of await makeActors(name, k)) made.push([name, a]);
      for (let i = made.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [made[i], made[j]] = [made[j], made[i]]; }
      for (const [name, actor] of made) {
        actor.root.visible = false;
        this.group.add(actor.root);
        this.rigged.push(this.peds.length);
        this.peds.push(this.makePerson(name, actor));
      }
      this.setCount(this.want);
    } catch (e) {
      console.error('crowd failed to load', e);
    }
  }

  /** Street network: one node per distinct road vertex, links along the roads. */
  private buildGraph(map: MapData): void {
    const index = new Map<string, number>();
    const nodeAt = (x: number, z: number) => {
      const k = `${x.toFixed(1)},${z.toFixed(1)}`;
      let i = index.get(k);
      if (i === undefined) {
        i = this.nodes.length;
        this.nodes.push({ x, z, links: [] });
        index.set(k, i);
      }
      return i;
    };
    for (const r of map.roads) {
      if (r.bridge) continue;
      const walk = r.sidewalk === 'both' || r.sidewalk === 'yes';
      // on the footpath where there is one, otherwise along the edge of the road
      const off = walk ? r.w / 2 + 1.0 : Math.max(0.5, r.w / 2 - 0.4);
      const y = walk ? SIDEWALK_Y : 0.05;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = nodeAt(r.pts[i][0], r.pts[i][1]), b = nodeAt(r.pts[i + 1][0], r.pts[i + 1][1]);
        if (a === b) continue;
        this.nodes[a].links.push({ to: b, off, y });
        this.nodes[b].links.push({ to: a, off, y });
      }
    }
  }

  private makePerson(rig: RigName, actor: Actor): Ped {
    const style = RIGGED[rig];
    return {
      speed: style.speed[0] + Math.random() * (style.speed[1] - style.speed[0]),
      jitter: (Math.random() - 0.5) * 0.7, dodge: 0,
      a: 0, b: 0, link: { to: 0, off: 0, y: 0 }, t: 0, len: 1,
      x: 0, y: 0, z: 0, heading: 0, moving: 1, wait: 0, fresh: true,
      hostile: rig === 'goon' || rig === 'security', grudge: 0, mode: 0, atkKind: 0, atkT: 0, atkE: 0, struck: false, cool: 0, stun: 0, guard: 0, down: 0, downT: 0, kvx: 0, kvz: 0, panic: 0,
      hits: 0, tough: style.tough, flinch: 0, angry: 0, out: false, atkN: 0, ox: 0, oz: 0, hold: 0, bump: 0,
      block: 0, blockN: 0, fwd: false, falls: 0, bumpN: 0, rig, idleClip: 'idle',
      linger: style.linger, actor,
    };
  }

  /** Put a person on a random street segment in the given distance band around (fx, fz). */
  private place(p: Ped, fx: number, fz: number, min: number, max: number, dirX: number, dirZ: number): boolean {
    const cands: number[] = [];
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (!n.links.length) continue;
      if (this.local) { cands.push(i); continue; }
      const dx = n.x - fx, dz = n.z - fz, d = Math.hypot(dx, dz);
      if (d < min || d > max) continue;
      // close ones only where the camera is not looking, so nobody pops into view
      if (d < 120 && dx * dirX + dz * dirZ > 0.2 * d) continue;
      cands.push(i);
    }
    if (!cands.length) return false;
    // a fresh start: whatever happened to them where they were is forgotten
    p.hits = 0; p.flinch = 0; p.angry = 0; p.grudge = 0; p.out = false; p.down = 0; p.mode = 0; p.atkKind = 0; p.atkE = 0; p.guard = 0; p.stun = 0; p.panic = 0;
    p.ox = 0; p.oz = 0; p.hold = 0; p.block = 0; p.fwd = false;
    p.a = cands[Math.floor(Math.random() * cands.length)];
    const links = this.nodes[p.a].links;
    this.setLink(p, links[Math.floor(Math.random() * links.length)]);
    p.t = Math.random() * p.len;
    p.wait = Math.random() < (p.rig === 'security' ? 0.85 : this.local ? 0.35 : 0.14) ? 8 + Math.random() * 40 : 0; // some people just stand around (a guard at his post, mostly)
    this.pickIdle(p);
    const [x, y, z, h] = this.target(p);
    p.x = x; p.y = y; p.z = z;
    p.heading = p.wait ? h + Math.PI / 2 + (Math.random() - 0.5) : h;
    p.moving = p.wait ? 0 : 1;
    return true;
  }

  /** How a person stands while they wait: a guard keeps looking about, an uncle looks about or holds forth. */
  private pickIdle(p: Ped): void {
    const r = Math.random();
    p.idleClip = p.rig === 'security' ? (r < 0.6 ? 'look_around' : 'idle') : p.rig === 'uncle' || p.rig === 'boy' || p.rig === 'aunty' ? (r < 0.4 ? 'look_around' : r < 0.6 ? 'argue' : 'idle') : p.rig === 'girl' ? (r < 0.5 ? 'look_around' : 'idle') : 'idle';
  }

  private setLink(p: Ped, l: Link): void {
    const A = this.nodes[p.a], B = this.nodes[l.to];
    p.b = l.to;
    p.link = l;
    p.len = Math.hypot(B.x - A.x, B.z - A.z) || 0.01;
    p.t = 0;
  }

  /** Where the person should be on their current segment: [x, y, z, heading]. */
  private target(p: Ped): [number, number, number, number] {
    const A = this.nodes[p.a], B = this.nodes[p.b];
    const dx = (B.x - A.x) / p.len, dz = (B.z - A.z) / p.len;
    const off = p.link.off + p.jitter;
    return [A.x + dx * p.t + dz * off, p.link.y, A.z + dz * p.t - dx * off, Math.atan2(-dx, -dz)];
  }

  /**
   * (fx, fz): the player (or camera) position; (dirX, dirZ): where the camera looks, on the ground plane;
   * (px, pz): somebody to make way for (the player), if any.
   */
  update(dt: number, fx: number, fz: number, dirX: number, dirZ: number, px = Infinity, pz = Infinity, py = 0): void {
    this.dt = dt; this.fx = fx; this.fz = fz;
    this.hunt = Number.isFinite(px) && (!this.huntIf || this.huntIf(px, pz));
    for (let i = 0; i < this.active; i++) {
      const p = this.peds[i];
      if (p.fresh) {
        // new arrivals fill the streets all around the player (nobody right on top of them)
        this.place(p, fx, fz, 6, SPAWN_MAX, 0, 0);
        p.fresh = false;
      }
      if (!this.local && Math.hypot(p.x - fx, p.z - fz) > DESPAWN) this.place(p, fx, fz, SPAWN_MIN, SPAWN_MAX, dirX, dirZ);
      if (p.out) {                            // laid out: lying where they fell
        p.downT += dt;
        if (Math.hypot(p.kvx, p.kvz) > 0.05) {
          let nx = p.x + p.kvx * dt, nz = p.z + p.kvz * dt;
          if (this.resolve) [nx, nz] = this.resolve(nx, nz);
          p.x = nx; p.z = nz;
          const f = Math.exp(-5 * dt);
          p.kvx *= f; p.kvz *= f;
        }
        p.moving += (0 - p.moving) * Math.min(1, dt * 10);
        // long after, with the player well away, they are back on their feet on some other street
        if (p.downT > OUT_SECS && Math.hypot(p.x - fx, p.z - fz) > OUT_AWAY) {
          const was = [p.x, p.z];
          for (let k = 0; k < 8; k++) if (this.place(p, fx, fz, SPAWN_MIN, SPAWN_MAX, dirX, dirZ) && Math.hypot(p.x - fx, p.z - fz) > OUT_AWAY * 0.7) break;
          if (p.out) { p.x = was[0]; p.z = was[1]; }      // nowhere to go yet: stay down
        }
        continue;
      }
      if (p.down > 0) {                       // lying where they fell, then getting up
        p.down -= dt;
        p.downT += dt;
        const sp = Math.hypot(p.kvx, p.kvz);
        if (sp > 0.05) {
          let nx = p.x + p.kvx * dt, nz = p.z + p.kvz * dt;
          if (this.resolve) [nx, nz] = this.resolve(nx, nz);
          p.x = nx; p.z = nz;
          const f = Math.exp(-3.2 * dt);
          p.kvx *= f; p.kvz *= f;
        }
        p.moving += (0 - p.moving) * Math.min(1, dt * 10);
        p.guard = 0; p.atkKind = 0; p.atkE = 0;
        if (p.down <= 0) {
          // on their feet where the fall left them, not where they stood
          const l = p.actor.lie, c = Math.cos(p.heading), s = Math.sin(p.heading);
          p.x += l.x * c + l.z * s;
          p.z += -l.x * s + l.z * c;
          p.mode = 0; p.stun = 0; if (!p.hostile) p.panic = 6; this.snapToGraph(p);
        }
        continue;
      }
      if (this.vehicleAt && !p.fresh) {
        const v = this.vehicleAt(p.x, p.z, 0.4);
        if (v && v.speed > 1.2) { this.knockDown(p, v.vx * 0.9, v.vz * 0.9, 3.6); continue; }
      }
      if (p.flinch > 0 || p.block > 0) {      // reeling from a punch, or holding a block against one
        p.flinch -= dt;
        p.block -= dt;
        p.moving += (0 - p.moving) * Math.min(1, dt * 10);
        if (Math.hypot(p.kvx, p.kvz) > 0.05) {
          let nx = p.x + p.kvx * dt, nz = p.z + p.kvz * dt;
          if (this.resolve) [nx, nz] = this.resolve(nx, nz);
          p.x = nx; p.z = nz;
          const f = Math.exp(-7 * dt);
          p.kvx *= f; p.kvz *= f;
        }
        continue;
      }
      if (p.angry > 0) p.angry -= dt;
      if (p.grudge > 0) p.grudge -= dt;
      if ((p.hostile || p.angry > 0 || p.grudge > 0) && this.fight(p, dt, px, pz, py)) continue;
      if (p.mode && !p.hostile) { p.mode = 0; p.atkKind = 0; p.atkE = 0; p.guard = 0; this.snapToGraph(p); }   // calmed down: back to their walk
      // brushed against by the player: a step back and aside, a moment's pause, then on their way
      p.bump = Math.max(0, p.bump - dt);
      const dP = Math.hypot(p.x - px, p.z - pz);
      if (dP < 0.75 && p.bump <= 0 && Math.abs(py - p.y) < 1.2) {
        const ax = dP > 1e-3 ? (p.x - px) / dP : -Math.sin(p.heading), az = dP > 1e-3 ? (p.z - pz) / dP : -Math.cos(p.heading);
        let sx = -Math.cos(p.heading), sz = Math.sin(p.heading);          // across their line of walk
        if (sx * ax + sz * az < 0) { sx = -sx; sz = -sz; }               // ... to the side away from him
        p.ox += ax * 0.55 + sx * 0.4;
        p.oz += az * 0.55 + sz * 0.4;
        p.hold = 0.95;                        // as long as the stumble takes
        p.bump = p.hold + 0.75;
        p.bumpN++;
      }
      let walking = false;
      if (p.wait > 0) p.wait -= dt;
      else if (p.hold > 0) p.hold -= dt;
      else {
        walking = true;
        if (p.panic > 0) p.panic -= dt;
        p.t += p.speed * (p.panic > 0 ? 1.8 : 1) * dt;
        if (p.t >= p.len) {
          // junction: any street except straight back, unless it is a dead end
          const here = p.b, from = p.a;
          const opts = this.nodes[here].links.filter((l) => l.to !== from);
          p.a = here;
          this.setLink(p, opts.length ? opts[Math.floor(Math.random() * opts.length)] : this.nodes[here].links[0]);
          if (Math.random() < p.linger) { p.wait = (2 + Math.random() * 6) * (p.linger > 0.2 ? 2.5 : 1); this.pickIdle(p); }
        }
      }
      const [tx, ty, tz, th] = this.target(p);
      const k = Math.min(1, dt * 5);
      // held up by something in the way (a pole, a cart, a parked bike): they step aside and go round it
      const lag = Math.hypot(tx + p.ox - p.x, tz + p.oz - p.z);
      if (walking && p.hold <= 0 && lag > 0.45) {
        if (!p.dodge) {
          // the side that is clear: try a step each way, take the one the walls and posts push least
          const cx = -Math.cos(th), cz = Math.sin(th), fx = -Math.sin(th) * 0.3, fz = -Math.cos(th) * 0.3;
          const cost = (s: number) => {
            if (!this.resolve) return 0;
            const wx = p.x + cx * s * 0.6 + fx, wz = p.z + cz * s * 0.6 + fz, [rx, rz] = this.resolve(wx, wz, p.y);
            return Math.hypot(rx - wx, rz - wz);
          };
          const a = cost(1), b = cost(-1);
          p.dodge = Math.abs(a - b) > 0.02 ? (a < b ? 1 : -1) : p.jitter >= 0 ? 1 : -1;
        }
        const sd = p.dodge, ax = -Math.cos(th) * sd, az = Math.sin(th) * sd;   // across their way
        p.ox += ax * dt * 2.4; p.oz += az * dt * 2.4;
        const o = Math.hypot(p.ox, p.oz);
        if (o > 1.4) { p.ox *= 1.4 / o; p.oz *= 1.4 / o; }
        if (lag > 1.2) p.t = Math.max(0, p.t - p.speed * dt);   // and the way does not run on without them
      } else if (p.hold <= 0) { if (lag < 0.2) p.dodge = 0; const f = Math.exp(-0.7 * dt); p.ox *= f; p.oz *= f; }   // drifting back onto their line as they go
      p.x += (tx + p.ox - p.x) * k;
      p.y += (ty - p.y) * k;
      p.z += (tz + p.oz - p.z) * k;
      if (p.wait <= 0) {
        const d = Math.atan2(Math.sin(th - p.heading), Math.cos(th - p.heading));
        p.heading += d * Math.min(1, dt * 6);
      }
      p.moving += ((walking ? 1 : 0) - p.moving) * Math.min(1, dt * 6);
    }
    this.solid(px, pz, py);
    this.write();
  }

  /**
   * Nobody walks through anybody or anything: people near the player are kept apart from each other (each gives way half),
   * out of the vehicles, and out of walls, posts and stalls. A walker pushed off their line drifts back onto it as they go.
   */
  private solid(px: number, pz: number, py: number): void {
    const near: Ped[] = [];
    for (let i = 0; i < this.active; i++) {
      const p = this.peds[i];
      if (p.fresh || p.out || p.down > 0) continue;            // lying on the ground: stepped round, or over
      if (Math.abs(p.x - this.fx) > SOLID_RANGE || Math.abs(p.z - this.fz) > SOLID_RANGE) continue;
      near.push(p);
    }
    for (let i = 0; i < near.length; i++) {
      const a = near[i];
      for (let j = i + 1; j < near.length; j++) {
        const b = near[j];
        if (Math.abs(a.y - b.y) > 1.2) continue;
        const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
        if (d2 >= BODY * BODY * 4) continue;
        let d = Math.sqrt(d2), nx = dx / (d || 1), nz = dz / (d || 1);
        if (d < 1e-4) { nx = Math.cos(i + j); nz = Math.sin(i + j); d = 0; }
        const push = (BODY * 2 - d) / 2;
        a.x -= nx * push; a.z -= nz * push;
        b.x += nx * push; b.z += nz * push;
      }
    }
    const obs = this.obstacles?.() ?? [];
    for (const p of near) {
      for (const [ox, oz, r] of obs) {
        const dx = p.x - ox, dz = p.z - oz, d = Math.hypot(dx, dz), need = BODY + r;
        if (d >= need) continue;
        const [nx, nz] = d > 1e-4 ? [dx / d, dz / d] : [-Math.sin(p.heading), -Math.cos(p.heading)];
        p.x = ox + nx * need;
        p.z = oz + nz * need;
      }
      // nor through Ramu (a goon or a guard at his throat stands off him, not in him)
      const dx = p.x - px, dz = p.z - pz, d = Math.hypot(dx, dz), need = BODY + RAMU;
      if (d < need && Math.abs(p.y - py) < 1.2) {
        const [nx, nz] = d > 1e-4 ? [dx / d, dz / d] : [-Math.sin(p.heading), -Math.cos(p.heading)];
        p.x = px + nx * need;
        p.z = pz + nz * need;
      }
      if (this.vehiclePush) [p.x, p.z] = this.vehiclePush(p.x, p.z, BODY);
      if (this.resolve) [p.x, p.z] = this.resolve(p.x, p.z, p.y);
    }
  }

  /** Keep Ramu (a circle of radius r at foot height y) out of the people: returns his corrected [x, z]. */
  pushOut(x: number, z: number, r: number, y: number): [number, number] {
    for (let i = 0; i < this.active; i++) {
      const p = this.peds[i];
      if (p.fresh || p.out || p.down > 0 || Math.abs(p.y - y) > 1.2) continue;
      const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz), need = r + BODY;
      if (d >= need) continue;
      if (d < 1e-4) { x += need; continue; }
      x = p.x + (dx / d) * need;
      z = p.z + (dz / d) * need;
    }
    return [x, z];
  }

  /** where the active goons are (for tests) */
  goons(): { x: number; z: number; mode: number; down: number }[] {
    return this.peds.slice(0, this.active).filter((p) => p.hostile).map((p) => ({ x: p.x, z: p.z, mode: p.mode, down: p.down }));
  }

  /**
   * The owner of a vehicle parked at (x, z), if they are about: somebody calm, on their feet, within `range` m (a man,
   * mostly: they own the cars). Returns a handle for comeFor, or -1.
   */
  ownerNear(x: number, z: number, range: number): number {
    let best = -1, bd = range;
    for (let i = 0; i < this.active; i++) {
      const p = this.peds[i];
      if (p.hostile || p.fresh || p.down > 0 || p.out || p.mode || p.grudge > 0) continue;
      const d = Math.hypot(p.x - x, p.z - z) + (p.rig === 'uncle' || p.rig === 'boy' ? 0 : 12);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /** The owner has seen Ramu at their vehicle: they come for him, for `secs`. */
  comeFor(i: number, secs: number): void {
    const p = this.peds[i];
    if (!p || p.out || p.fresh) return;
    p.grudge = secs;
    p.wait = 0; p.hold = 0; p.cool = 0.4;
  }

  /** the person behind an ownerNear handle is still up and about */
  where(i: number): { x: number; z: number; after: boolean } | null {
    const p = this.peds[i];
    return p && !p.out && !p.fresh && i < this.active ? { x: p.x, z: p.z, after: p.grudge > 0 } : null;
  }

  /**
   * Somebody thrown off a vehicle Ramu has taken: one of the crowd (not a goon or a guard, not anybody in the player's
   * sight: the one farthest from him) is put where they come off and knocked flying (vx, vz m/s); they fall, get up and
   * run. `men`: a driver, so a man if there is one. False if there was nobody to use.
   */
  throwOut(x: number, z: number, vx: number, vz: number, men = false): boolean {
    let best: Ped | null = null, bd = -1;
    for (let i = 0; i < this.active; i++) {
      const p = this.peds[i];
      if (p.hostile || p.rig === 'security' || p.fresh || p.down > 0 || p.out || p.mode) continue;
      const d = Math.hypot(p.x - this.fx, p.z - this.fz) + (men && (p.rig === 'girl' || p.rig === 'aunty') ? -1000 : 0);
      if (d > bd) { bd = d; best = p; }
    }
    if (!best) return false;
    const p = best;
    p.x = x; p.z = z; p.y = 0;
    p.ox = p.oz = 0; p.hold = 0; p.wait = 0; p.flinch = 0; p.block = 0; p.angry = 0;
    this.knockDown(p, vx, vz, 0);
    return true;
  }

  private knockDown(p: Ped, vx: number, vz: number, secs: number): void {
    secs = V_FALL + V_GETUP;                  // the fall goes backwards: their back to the way they are thrown
    p.heading = Math.atan2(vx, vz);
    p.falls++;
    p.flinch = 0; p.block = 0;
    p.down = secs;
    p.downT = 0;
    p.kvx = vx;
    p.kvz = vz;
    p.stun = secs;
    p.atkKind = 0;
    p.wait = 0;
  }

  /** The person a punch from (x, z) facing (fx, fz) would land on: the nearest one standing within arm's reach, not behind. */
  private inReach(x: number, z: number, fx: number, fz: number): { p: Ped; d: number } | null {
    let best: Ped | null = null, bd = Infinity;
    for (let i = 0; i < this.active; i++) {
      const p = this.peds[i];
      if (p.out || p.down > 0 || p.fresh) continue;
      const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz);
      if (d > 1.9 || d < 1e-3 || d >= bd) continue;
      if ((dx * fx + dz * fz) / d < -0.3) continue;      // anyone but directly behind
      best = p; bd = d;
    }
    return best ? { p: best, d: bd } : null;
  }

  /** Who a punch thrown now would land on (so the puncher can square up to them), and how far off they are. */
  aim(x: number, z: number, fx: number, fz: number): { x: number; z: number; d: number } | null {
    const t = this.inReach(x, z, fx, fz);
    return t ? { x: t.p.x, z: t.p.z, d: t.d } : null;
  }

  /**
   * A punch from (x, z) facing (fx, fz) lands on the nearest person in reach. They turn on the puncher and reel from it,
   * then hit back; the last punch they can take lays them out. Returns true if it landed on somebody.
   */
  hit(x: number, z: number, fx: number, fz: number): boolean {
    const t = this.inReach(x, z, fx, fz);
    this.lastHit = null;
    if (!t) return false;
    const p = t.p, dx = (p.x - x) / t.d, dz = (p.z - z) / t.d;
    this.lastHit = { x: p.x, z: p.z };
    const behind = Math.sin(p.heading) * dx + Math.cos(p.heading) * dz < -0.3;   // the puncher is at their back
    // already squared up to him and not in the middle of a blow of their own: some punches are blocked
    if (p.mode === 1 && !p.atkKind && p.flinch <= 0 && p.block <= 0 && !behind && Math.random() < (p.tough > TOUGH ? 0.4 : 0.28)) {
      p.heading = Math.atan2(dx, dz);
      p.block = BLOCK;
      p.blockN++;
      p.kvx = dx * 1.1; p.kvz = dz * 1.1;
      p.angry = ANGRY;
      p.cool = Math.min(p.cool, 0.3);
      return true;
    }
    p.hits++;
    p.atkKind = 0; p.atkE = 0; p.wait = 0; p.hold = 0; p.ox = 0; p.oz = 0; p.panic = 0; p.block = 0;
    p.fwd = behind && p.hits >= p.tough;     // the last blow, from behind: they go down on their face, away from him
    if (!p.fwd) p.heading = Math.atan2(dx, dz);          // otherwise they turn to face the one who hit them
    if (p.hits >= p.tough) {                 // laid out
      p.out = true;
      p.downT = 0;
      p.flinch = 0; p.angry = 0; p.grudge = 0; p.mode = 0; p.guard = 0;
      p.kvx = 0; p.kvz = 0;                    // the fall carries the body back by itself
      return true;
    }
    p.flinch = FLINCH;
    p.kvx = dx * 2.2; p.kvz = dz * 2.2;      // knocked back half a step
    p.angry = ANGRY;
    p.mode = 1;
    p.cool = 0.15 + Math.random() * 0.35;    // and the answer comes quickly
    return true;
  }

  /** Goon behaviour: true while the goon is busy with the player (running at, hitting, or staggered). */
  private fight(p: Ped, dt: number, px: number, pz: number, py: number): boolean {
    p.cool = Math.max(0, p.cool - dt);
    if (p.stun > 0) {
      p.stun -= dt;
      p.moving += (0 - p.moving) * Math.min(1, dt * 8);
      p.guard = 0;
      return true;
    }
    const dx = px - p.x, dz = pz - p.z, d = Math.hypot(dx, dz);
    const range = p.grudge > 0 ? GRUDGE_RANGE : p.angry > 0 ? (p.hostile ? AGGRO : ANGRY_RANGE) : p.hostile && this.hunt ? this.huntRange : 0;
    if (!(d < range) || Math.abs(py - p.y) > 1.0) {   // nobody to chase (or he is out of reach, up on the gallery)
      if (p.mode) { p.mode = 0; p.atkKind = 0; p.atkE = 0; p.guard = 0; this.snapToGraph(p); }
      return false;
    }
    p.mode = 1;
    p.guard = 1;
    const want = Math.atan2(-dx, -dz);
    p.heading += Math.atan2(Math.sin(want - p.heading), Math.cos(want - p.heading)) * Math.min(1, dt * 9);
    if (p.atkKind) {
      p.moving += (0 - p.moving) * Math.min(1, dt * 8);
      p.atkT += dt;
      const t = p.atkT, [land, total] = p.atkKind === 2 ? ACTOR_KICK_ATK : ACTOR_ATK;
      p.atkE = t < land ? t / land : Math.max(0, 1 - (t - land) / (total - land));
      if (!p.struck && t >= land) {
        p.struck = true;
        if (d < REACH) this.onHurt?.(Math.round((p.atkKind === 1 ? PUNCH_DMG : KICK_DMG) * (p.hostile || p.grudge > 0 || p.tough > TOUGH ? 1 : ANGRY_DMG)));
      }
      if (t >= total) { p.atkKind = 0; p.atkE = 0; p.cool = 0.5 + Math.random() * 0.6; }
      return true;
    }
    if (d > 1.15) {
      const s = Math.min((p.hostile || p.grudge > 0 ? CHASE : ANGRY_CHASE) * dt, d - 1.0);
      let nx = p.x + (dx / d) * s, nz = p.z + (dz / d) * s;
      if (this.resolve) [nx, nz] = this.resolve(nx, nz);
      p.x = nx; p.z = nz; p.y = 0.05;
      p.moving += (1 - p.moving) * Math.min(1, dt * 8);
      return true;
    }
    p.moving += (0 - p.moving) * Math.min(1, dt * 8);
    if (p.cool <= 0) { p.atkKind = Math.random() < 0.55 ? 1 : 2; p.atkT = 0; p.atkE = 0; p.struck = false; p.atkN++; }
    return true;
  }

  /** Back onto the nearest street after a chase. */
  private snapToGraph(p: Ped): void {
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (!n.links.length) continue;
      const d = (n.x - p.x) ** 2 + (n.z - p.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return;
    p.a = best;
    const links = this.nodes[best].links;
    this.setLink(p, links[Math.floor(Math.random() * links.length)]);
    p.wait = 0;
  }

  private write(): void {
    for (const i of this.rigged) {
      const p = this.peds[i], a = p.actor;
      const show = i < this.active && !p.fresh && Math.hypot(p.x - this.fx, p.z - this.fz) < ACTOR_RANGE;
      a.root.visible = show;
      if (!show) continue;
      Q.setFromAxisAngle(UP, p.heading);
      a.root.position.set(p.x, p.y < 0.3 ? Math.max(p.y, FOOTPATHS.at(p.x, p.z)) : p.y, p.z);   // up on a footpath
      a.root.quaternion.copy(Q);
      if (p.out) a.once(p.fwd ? 'fall2' : 'fall', 'out', p.fwd ? 1.1 : 1.25);
      else if (p.down > V_GETUP) a.once('fall', 'thrown' + p.falls, V_FALL_SPEED);       // thrown by a vehicle: down ...
      else if (p.down > 0) {                                                             // ... and up again
        // The fall left the body lying behind where it stood, and the get-up clip starts at its own origin: the model moves
        // over as the one fades into the other, so the body itself stays where it lies.
        const FADE = 0.3, w = Math.min(1, (V_GETUP - p.down) / FADE);
        a.once('get_up', 'getup' + p.falls, V_GETUP_SPEED, FADE);
        a.root.position.add(V.copy(a.lie).multiplyScalar(w).applyQuaternion(Q));
      } else if (p.flinch > 0) {
        // two ways of taking a punch, turn about: to the head, to the body
        if (p.hits % 2) a.once('hit', 'hit' + p.hits, CLIP_SECS.hit / FLINCH, 0.06);
        else a.once('hit2', 'hit' + p.hits, CLIP_SECS.hit2 / FLINCH, 0.06);
      } else if (p.block > 0) a.once('block', 'block' + p.blockN, CLIP_SECS.block / BLOCK, 0.06);
      else if (p.atkKind === 2) a.once('kick', 'atk' + p.atkN, ACTOR_KICK);
      else if (p.atkKind) a.once('punch', 'atk' + p.atkN, ACTOR_PUNCH);
      else if (p.mode) a.move(p.moving > 0.5 ? (p.hostile || p.grudge > 0 ? CHASE : ANGRY_CHASE) : 0, 'fight_idle');   // on guard between blows
      else if (p.hold > 0) a.once('shove', 'shove' + p.bumpN, CLIP_SECS.shove / 0.95);                  // brushed against: a stumble
      else a.move(p.speed * (p.panic > 0 ? 1.8 : 1) * (p.moving > 0.5 ? 1 : 0), p.wait > 0 ? p.idleClip : 'idle');
      a.update(this.dt);
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const V = new THREE.Vector3(), Q = new THREE.Quaternion();
