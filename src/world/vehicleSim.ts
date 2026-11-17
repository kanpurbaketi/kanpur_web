/*
 How the vehicle Ramu drives moves: a rigid body on the ground plane ("bicycle model": one front and one rear axle), at
 a fixed 120 Hz.

   tyres      each axle's slip angle (the way it points vs. the way it moves) gives a sideways force, rising with the
              angle and levelling off at the grip limit (μ × the load on the axle)
   grip       shared between driving / braking and cornering (friction circle): spin the drive wheels, or lock the rear
              with the hand brake, and the rear lets go (slides, drifts)
   load       moves to the front under braking (the nose dips, the front bites), to the rear under power
   engine     power-limited drive force, up to what the tyres can take; drag and rolling resistance give the top speed;
              an automatic gearbox (for the engine note)
   steering   rate-limited, less lock at speed, and leaning toward where the vehicle is actually going in a slide
              (counter-steer help), so it is drivable on keys
   collisions an impulse at the contact point: bounce (restitution 0.2), scrape (friction), and spin from an
              off-centre hit

 Frames: heading h, forward (sin h, cos h), left (cos h, -sin h); yaw rate > 0 and steer > 0 turn to the LEFT.
*/

export interface Spec {
  /** kg, with the driver */
  mass: number;
  /** engine power, W, and the top speed it gives, m/s */
  power: number; vtop: number;
  /** grip (tyre-road friction) on a road */
  mu: number;
  /** most front-wheel lock, radians, at a standstill */
  steer: number;
  /** which axle drives */
  drive: 'front' | 'rear' | 'all';
  /** braking, in g */
  brake: number;
  /** share of the wheelbase from the front axle back to the centre of mass (0.45: a little nose-heavy) */
  cg: number;
  /** height of the centre of mass, m */
  cgH: number;
  /** a two-wheeler: no hand-brake slides, it leans instead */
  bike?: boolean;
  /** pedalled (cycle, rickshaw): no engine note, no gears */
  pedal?: boolean;
  /** gears: the top speed of each, m/s (empty: one) */
  gears?: number[];
}

export const SPECS: Record<string, Spec> = {
  swift: { mass: 960, power: 61e3, vtop: 44, mu: 1.0, steer: 0.62, drive: 'front', brake: 0.95, cg: 0.42, cgH: 0.5, gears: [12, 20, 28, 36, 44] },
  maruti: { mass: 700, power: 28e3, vtop: 36, mu: 0.92, steer: 0.62, drive: 'front', brake: 0.85, cg: 0.42, cgH: 0.5, gears: [10, 18, 27, 36] },
  ambassador: { mass: 1250, power: 55e3, vtop: 38, mu: 0.9, steer: 0.58, drive: 'rear', brake: 0.8, cg: 0.45, cgH: 0.58, gears: [10, 18, 28, 38] },
  bolero: { mass: 1650, power: 56e3, vtop: 36, mu: 0.95, steer: 0.56, drive: 'rear', brake: 0.85, cg: 0.45, cgH: 0.72, gears: [9, 16, 24, 30, 36] },
  bus: { mass: 9500, power: 110e3, vtop: 23, mu: 0.8, steer: 0.62, drive: 'rear', brake: 0.6, cg: 0.6, cgH: 1.2, gears: [5, 9, 14, 19, 23] },
  truck: { mass: 7500, power: 95e3, vtop: 22, mu: 0.8, steer: 0.58, drive: 'rear', brake: 0.6, cg: 0.5, cgH: 1.2, gears: [5, 9, 14, 18, 22] },
  autorickshaw: { mass: 420, power: 6e3, vtop: 16, mu: 0.85, steer: 0.75, drive: 'rear', brake: 0.7, cg: 0.58, cgH: 0.6, gears: [5, 9, 13, 16] },
  tirri: { mass: 380, power: 1.6e3, vtop: 7.5, mu: 0.8, steer: 0.7, drive: 'rear', brake: 0.6, cg: 0.45, cgH: 0.65 },
  pulsar: { mass: 210, power: 10e3, vtop: 30, mu: 1.1, steer: 0.5, drive: 'rear', brake: 0.95, cg: 0.55, cgH: 0.6, bike: true, gears: [8, 13, 18, 24, 30] },
  cycle: { mass: 85, power: 0.35e3, vtop: 8.5, mu: 1.0, steer: 0.6, drive: 'rear', brake: 0.6, cg: 0.6, cgH: 0.9, bike: true, pedal: true },
  rickshaw: { mass: 140, power: 0.3e3, vtop: 5.8, mu: 0.9, steer: 0.5, drive: 'rear', brake: 0.5, cg: 0.5, cgH: 0.7, pedal: true },
};
SPECS.maruti_red = SPECS.maruti_green = SPECS.maruti;
SPECS.bus_green = SPECS.bus;

const G = 9.81, STEP = 1 / 120, CRR = 0.015;

/** what the sim keeps of a vehicle between frames */
export interface Body {
  x: number; z: number; heading: number;
  /** velocity in the vehicle's frame: forward, and sideways (to the left), m/s */
  vx: number; vy: number;
  /** yaw rate, rad/s (> 0: turning left) */
  yaw: number;
  /** front wheels' angle, rad (> 0: to the left) */
  steer: number;
  /** last longitudinal acceleration, m/s² (the load transfer; the body's pitch) */
  ax: number;
  /** last sideways acceleration, m/s² (the body's roll, a bike's lean) */
  ay: number;
  /** how far the tyres are past their grip (0: gripping, 1: sliding), front and rear: squeal, skid marks */
  slipF: number; slipR: number;
  /** the rear wheels locked (hand brake) */
  locked: boolean;
  gear: number; rpm: number;
  /** the hardest knock this frame (impulse per kg, ~ m/s of speed lost): damage, sound */
  knock: number;
  knockX: number; knockZ: number; knockNX: number; knockNZ: number;
}

export function newBody(x: number, z: number, heading: number, v: number): Body {
  return { x, z, heading, vx: v, vy: 0, yaw: 0, steer: 0, ax: 0, ay: 0, slipF: 0, slipR: 0, locked: false, gear: 1, rpm: 900, knock: 0, knockX: 0, knockZ: 0, knockNX: 0, knockNZ: 0 };
}

export interface Input {
  /** -1..1: forward is power (or the brake while rolling backward), back is the brake (then reverse) */
  throttle: number;
  /** -1..1, to the left */
  steer: number;
  /** the hand brake */
  handbrake: boolean;
  /** stand still (a parked vehicle): the foot brake on */
  hold?: boolean;
  /** 0..1 of the engine left (damage) */
  power?: number;
}

/** the world around: grip under a point (1 on a road), and walls: the corrected centre of a circle pushed out of them */
export interface Surroundings {
  grip(x: number, z: number): number;
  resolve(x: number, z: number, r: number): [number, number];
  /** other bodies in the way: circles [x, z, r, mass]; a hit one is told by `hit(index, impulse x, z)` */
  others(): [number, number, number, number][];
  hit(i: number, jx: number, jz: number): void;
}

export interface Geometry {
  /** wheelbase, m; half length and half width of the body */
  wb: number; halfL: number; halfW: number;
}

/** Advance the body by dt (sub-stepped). */
export function step(b: Body, s: Spec, g: Geometry, input: Input, world: Surroundings, dt: number): void {
  b.knock = 0;
  const n = Math.max(1, Math.ceil(dt / STEP)), h = dt / n;
  for (let i = 0; i < n; i++) integrate(b, s, g, input, world, h);
  collide(b, s, g, world);
  // the engine: gear from the speed, revs within it
  const gears = s.gears ?? [s.vtop];
  const v = Math.abs(b.vx);
  let gi = gears.findIndex((top) => v < top * 0.97);
  if (gi < 0) gi = gears.length - 1;
  if (b.vx < -0.3) gi = 0;
  b.gear = b.vx < -0.3 ? -1 : gi + 1;
  const lo = gi ? gears[gi - 1] * 0.55 : 0, hi = gears[gi];
  const want = 900 + Math.max(0, Math.min(1.08, (v - lo) / Math.max(1, hi - lo))) * 5200 + Math.max(0, input.throttle) * (v < 1 ? 1600 : 300);
  b.rpm += (want - b.rpm) * Math.min(1, dt * 8);
}

function integrate(b: Body, s: Spec, g: Geometry, input: Input, world: Surroundings, h: number): void {
  const m = s.mass, L = g.wb, a = L * s.cg, bb = L - a;
  const I = (m * ((2 * g.halfL) ** 2 + (2 * g.halfW) ** 2)) / 12;
  const mu = s.mu * world.grip(b.x, b.z);
  const speed = Math.hypot(b.vx, b.vy);

  // ---- steering: less lock at speed, rate-limited, and a pull toward where it is going when it slides
  const fade = 1 / (1 + Math.abs(b.vx) / (s.bike ? 9 : 14));
  const beta = Math.abs(b.vx) > 2 ? Math.atan2(b.vy, Math.abs(b.vx)) : 0;
  // no more lock than the tyres can use: the turn the grip holds (L·μg/v²) and a little past it (the slip they work at),
  // so holding a key full over corners hard instead of ploughing on (bikes: never past it, they would fall)
  const useful = (L * mu * G) / Math.max(1, b.vx * b.vx) * (s.bike ? 0.9 : 1.05) + (s.bike ? 0.02 : 0.07);
  const lock = Math.min(s.steer * fade, Math.max(0.05, useful));
  let target = input.steer * lock + (s.bike ? 0 : 0.35 * beta);
  target = Math.max(-s.steer, Math.min(s.steer, target));
  const rate = 2.6 * h;
  b.steer += Math.max(-rate, Math.min(rate, target - b.steer));

  // ---- loads on the axles (weight transfer from the last acceleration)
  const shift = (m * b.ax * s.cgH) / L;
  const Nf = Math.max(0.15 * m * G, (m * G * bb) / L - shift);
  const Nr = Math.max(0.15 * m * G, (m * G * a) / L + shift);

  // ---- along: drive, brakes, hand brake
  let throttle = input.throttle * (input.power ?? 1);
  let brake = 0;
  if (input.hold) { throttle = 0; brake = 1; }
  else if (throttle < 0 && b.vx > 0.4) { brake = -throttle; throttle = 0; }          // back while rolling forward: brake
  else if (throttle > 0 && b.vx < -0.4) { brake = throttle; throttle = 0; }          // forward while rolling back: brake
  else if (throttle < 0) throttle = b.vx < -s.vtop * 0.22 ? 0 : throttle * 0.45;    // reverse: gently, and not fast
  const handbrake = input.handbrake && !s.bike;
  if (input.handbrake && s.bike) { brake = Math.max(brake, 1); throttle = 0; }        // a bike's hand brake is just its brakes
  b.locked = handbrake && Math.abs(b.vx) > 0.5;
  // drive force: what the power gives at this speed, no more than the driven tyres hold
  const driven = s.drive === 'front' ? Nf : s.drive === 'rear' ? Nr : Nf + Nr;
  const cd = Math.max(0, (s.power - CRR * m * G * s.vtop) / s.vtop ** 3);
  let Fdrive = throttle * Math.min(mu * driven * 0.95, s.power / Math.max(2, Math.abs(b.vx)));
  if (b.locked && s.drive === 'rear') Fdrive = 0;
  const dir = Math.sign(b.vx) || 0;
  const Fbrake = brake * s.brake * m * G;
  let Fxf = 0, Fxr = 0;
  if (s.drive === 'front') Fxf += Fdrive; else if (s.drive === 'rear') Fxr += Fdrive; else { Fxf += Fdrive / 2; Fxr += Fdrive / 2; }
  Fxf -= dir * Fbrake * 0.65;
  Fxr -= dir * Fbrake * 0.35;
  if (b.locked) Fxr = -dir * mu * Nr * 0.6;                                           // the rear tyres skid
  // each axle's tyres hold only so much along
  Fxf = clampMag(Fxf, mu * Nf);
  Fxr = clampMag(Fxr, mu * Nr);

  // ---- across: slip angles -> sideways forces, within what is left of the grip (friction circle)
  const vxs = Math.max(Math.abs(b.vx), 0.5);
  const af = Math.atan2(b.vy + a * b.yaw, vxs) - b.steer * (b.vx >= 0 ? 1 : -1);
  const ar = Math.atan2(b.vy - bb * b.yaw, vxs);
  const Cf = 9 * Nf, Cr = 13 * Nr;
  const capF = Math.sqrt(Math.max(0, (mu * Nf) ** 2 - Fxf ** 2));
  let capR = Math.sqrt(Math.max(0, (mu * Nr) ** 2 - Fxr ** 2));
  if (b.locked) capR *= 0.7;
  const Fyf = -capF * Math.tanh((Cf * af) / Math.max(1, capF));
  const Fyr = -capR * Math.tanh((Cr * ar) / Math.max(1, capR));
  b.slipF = Math.min(1, Math.abs(Cf * af) / Math.max(1, capF) - 0.6);
  b.slipR = Math.min(1, Math.max(b.locked ? 0.8 : 0, Math.abs(Cr * ar) / Math.max(1, capR) - 0.6));
  b.slipF = Math.max(0, b.slipF);
  b.slipR = Math.max(0, b.slipR);

  // ---- motion
  const cs = Math.cos(b.steer), sn = Math.sin(b.steer);
  const drag = cd * b.vx * Math.abs(b.vx) + CRR * m * G * Math.tanh(b.vx * 2);
  let ax = (Fxf * cs - Fyf * sn + Fxr - drag) / m;
  let ay = (Fxf * sn + Fyf * cs + Fyr) / m;
  let yawAcc = (a * (Fyf * cs + Fxf * sn) - bb * Fyr) / I;
  // the brake (and the hand brake) hold it still rather than rock it back and forth
  if ((brake > 0 || b.locked || input.hold) && Math.abs(b.vx) < 0.4) { b.vx *= 0.8; ax = 0; }
  b.vx += (ax + b.vy * b.yaw) * h;
  b.vy += (ay - b.vx * b.yaw) * h;
  b.yaw += yawAcc * h;
  // stability help (it is a game on keys): it turns no faster than the grip carries it round (a little more in a
  // hand-brake slide, which swings the tail out but not round and round); a bike never slides
  const yawCap = ((mu * G) / Math.max(2, Math.hypot(b.vx, b.vy))) * (b.locked ? 1.8 : s.bike ? 1.0 : 1.05);
  if (Math.abs(b.yaw) > yawCap) b.yaw -= (Math.abs(b.yaw) - yawCap) * Math.sign(b.yaw) * Math.min(1, h * (s.bike ? 30 : 8));
  if (s.bike) b.vy *= Math.exp(-5 * h);
  // slow: the tyres simply roll where they point (the slip-angle model does not hold at a crawl)
  const k = Math.min(1, Math.max(0, (speed - 1.5) / 3));
  const kin = (b.vx * Math.tan(b.steer)) / L;
  b.yaw = kin + (b.yaw - kin) * k;
  b.vy *= k + (1 - k) * Math.exp(-12 * h);
  b.ax += ((ax) - b.ax) * Math.min(1, h * 6);
  b.ay += ((ay) - b.ay) * Math.min(1, h * 6);
  if (!throttle && !brake && Math.abs(b.vx) < 0.05) b.vx = 0;
  // world motion
  const fx = Math.sin(b.heading), fz = Math.cos(b.heading), lx = fz, lz = -fx;
  b.x += (fx * b.vx + lx * b.vy) * h;
  b.z += (fz * b.vx + lz * b.vy) * h;
  b.heading += b.yaw * h;
}

/** Walls and other vehicles: push out, and an impulse at the contact point. */
function collide(b: Body, s: Spec, g: Geometry, world: Surroundings): void {
  const m = s.mass, I = (m * ((2 * g.halfL) ** 2 + (2 * g.halfW) ** 2)) / 12;
  const fx = Math.sin(b.heading), fz = Math.cos(b.heading), lx = fz, lz = -fx;
  const r = g.halfW, span = Math.max(0, g.halfL - r), n = Math.max(1, Math.round(span / r) + 1);
  // world velocity of the centre
  let vxw = fx * b.vx + lx * b.vy, vzw = fz * b.vx + lz * b.vy;
  const apply = (dx: number, dz: number, nx: number, nz: number, invOther: number, other: number): void => {
    // velocity of the contact point (the circle's edge toward the wall); yaw moves a point at (dx, dz) by yaw·(dz, -dx)
    const vcx = vxw + b.yaw * dz, vcz = vzw - b.yaw * dx;
    const vn = vcx * nx + vcz * nz;
    if (vn >= 0) return;
    const kn = nx * dz - nz * dx;                       // how much a push along n turns it
    const j = (-(1 + 0.2) * vn) / (1 / m + invOther + (kn * kn) / I);
    // scraping along it: friction, at most 0.35 of the push
    const tx = -nz, tz = nx, vt = vcx * tx + vcz * tz;
    const kt = tx * dz - tz * dx;
    const jt = Math.max(-0.35 * j, Math.min(0.35 * j, -vt / (1 / m + invOther + (kt * kt) / I)));
    vxw += (j * nx + jt * tx) / m;
    vzw += (j * nz + jt * tz) / m;
    b.yaw += (j * kn + jt * kt) / I;
    const hard = j / m;
    if (hard > b.knock) { b.knock = hard; b.knockX = b.x + dx; b.knockZ = b.z + dz; b.knockNX = nx; b.knockNZ = nz; }
    if (other >= 0) world.hit(other, -j * nx, -j * nz);
  };
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : -span + (2 * span * i) / (n - 1);
    const px = b.x + fx * t, pz = b.z + fz * t;
    const [qx, qz] = world.resolve(px, pz, r);
    const ox = qx - px, oz = qz - pz, d = Math.hypot(ox, oz);
    if (d < 1e-5) continue;
    const nx = ox / d, nz = oz / d;
    b.x += ox;
    b.z += oz;
    apply(fx * t - nx * r, fz * t - nz * r, nx, nz, 0, -1);
  }
  const others = world.others();
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : -span + (2 * span * i) / (n - 1);
    const px = b.x + fx * t, pz = b.z + fz * t;
    others.forEach(([ox, oz, or, om], oi) => {
      const dx = px - ox, dz = pz - oz, d = Math.hypot(dx, dz), need = r + or;
      if (d >= need || d < 1e-5) return;
      const nx = dx / d, nz = dz / d, pen = need - d;
      // pushed apart by mass
      const share = om / (m + om);
      b.x += nx * pen * share;
      b.z += nz * pen * share;
      apply(fx * t - nx * r, fz * t - nz * r, nx, nz, 1 / om, oi);
    });
  }
  b.vx = vxw * fx + vzw * fz;
  b.vy = vxw * lx + vzw * lz;
}

function clampMag(v: number, m: number): number {
  return Math.max(-m, Math.min(m, v));
}
