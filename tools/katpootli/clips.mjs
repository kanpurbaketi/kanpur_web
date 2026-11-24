// The clips made in Katpootli (rannbhoomi.in) from key poses on Ramu's Mixamo skeleton, exported as FBX into
// assets/anims/kp_<name>.fbx, where tools/blender/build_ramu_rig.py bakes them onto every rig like the Mixamo clips.
//   node tools/katpootli/clips.mjs <name> > job.json      the Katpootli MCP calls for one clip (load, animate, render, export)
//   node tools/katpootli/kp.mjs job.json <renders dir>    runs them against the Katpootli MCP server
// then rebuild the rigs: Blender -b -P tools/blender/build_ramu_rig.py -- --char <each character>
import { fileURLToPath } from 'node:url';
const A = fileURLToPath(new URL('../../assets', import.meta.url));
const OUT = process.env.OUT ?? `${A}/anims`;
const M = (...ps) => { const o = {}; for (const p of ps) for (const [k, v] of Object.entries(p)) o[k] = { ...(o[k] ?? {}), ...v }; return o; };
const arms = (r, f, b, l = {}) => ({ leftUpperArm: { raise: r, forward: f, ...l }, rightUpperArm: { raise: r, forward: f, ...l }, leftLowerArm: { bend: b }, rightLowerArm: { bend: b } });
const ra = (r, f, b) => ({ rightUpperArm: { raise: r, forward: f }, rightLowerArm: { bend: b } });
const la = (r, f, b) => ({ leftUpperArm: { raise: r, forward: f }, leftLowerArm: { bend: b } });
const legs = (lf, lb, rf, rb, out = 0) => ({ leftUpperLeg: { forward: lf, out }, leftLowerLeg: { bend: lb }, rightUpperLeg: { forward: rf, out }, rightLowerLeg: { bend: rb } });
const body = (sp = 0, ch = 0, hd = 0, ht = 0, side = 0) => ({ spine: { bend: sp, side, turn: 0 }, chest: { bend: ch, side: 0, turn: 0 }, neck: { bend: 0, turn: 0 }, head: { bend: hd, turn: ht, side: 0 } });
const STAND = M(body(), arms(10, 6, 12), legs(0, 0, 0, 0, 3));
const SEAT = M(legs(85, 85, 85, 85, 6));
const WHEEL = M(body(-4, 0, -4), arms(26, 60, 58));

const C = {
  // ---- Ramu at a car's door lock: bent to it, hands at work (the game's IK puts them on the lock), weight shifting, a glance round
  pick_lock: { len: 4, keys: [
    [0, M(STAND, body(14, 10, 24), arms(22, 52, 82), legs(12, 16, -3, 6, 6))],
    [1.0, M(body(16, 11, 26, -4), legs(14, 20, -4, 6, 6))],
    [1.9, M(body(13, 9, 22, 3), legs(10, 14, -2, 8, 6))],
    [2.4, M(body(10, 8, 6, 48))],          // a look over the shoulder
    [2.9, M(body(10, 8, 6, 52))],
    [3.3, M(body(14, 10, 24, 0))],
    [4, M(body(14, 10, 24), legs(12, 16, -3, 6, 6))]] },
  // ---- at a bike's lock, down by the front wheel: crouched (Mixamo crouch for the legs), leaning in, a glance round
  pick_low: { len: 4, import: { file: 'Crouch Idle.fbx', part: 'lower' }, keys: [
    [0, M(body(26, 14, 22), arms(16, 62, 60))],
    [1.2, M(body(28, 15, 24, -5))],
    [2.3, M(body(22, 10, 4, -50))],
    [2.8, M(body(22, 10, 4, -46))],
    [3.2, M(body(26, 14, 22))],
    [4, M(body(26, 14, 22))]] },
  // ---- at the wheel: sitting (Mixamo chair sitting for the legs), the arms forward to the wheel, a small sway
  car_sit: { len: 3, import: { file: 'Sitting Talking.fbx', part: 'lower' }, keys: [
    [0, WHEEL], [1.5, M(body(-3, 1, -2, 4))], [3, WHEEL]] },
  // ---- into the driver's seat from beside the door (he faces the way the car does; the game slides his hips across):
  // a hand up to the door's frame, the near leg in, head ducked, down onto the seat, the other leg in, hands to the wheel
  car_in: { len: 1.4, keys: [
    [0, STAND],
    [0.3, M(body(10, 14, 22, 0, 10), ra(95, 35, 55), la(14, 10, 20), legs(55, 65, 0, 4, 18))],
    [0.7, M(body(18, 16, 18, 0, 6), ra(80, 40, 50), la(18, 30, 40), legs(75, 80, 35, 30, 14))],
    [1.05, M(body(6, 6, 6), ra(40, 55, 55), la(26, 55, 58), legs(82, 84, 78, 80, 8))],
    [1.4, M(WHEEL, SEAT)]] },
  // ---- out of it: the far leg out, a hand on the frame, ducked, up onto his feet
  car_out: { len: 1.2, keys: [
    [0, M(WHEEL, SEAT)],
    [0.3, M(body(14, 14, 18, 0, -8), ra(92, 38, 55), la(20, 30, 40), legs(80, 82, 45, 50, 14))],
    [0.7, M(body(18, 14, 14, 0, -6), ra(70, 30, 40), la(14, 12, 25), legs(40, 50, 20, 25, 10))],
    [1.2, STAND]] },
  // ---- out of a moving car: a crouch in the door, the leap with the arms over the head, tucked to roll
  car_bail: { len: 1.0, keys: [
    [0, M(WHEEL, SEAT)],
    [0.2, M(body(34, 16, 28), arms(70, 85, 120), legs(70, 95, 70, 95, 10))],
    [0.45, M(body(30, 10, 20, 0, -12), arms(80, 120, 60), legs(18, 20, 30, 35, 8))],
    [0.75, M(body(48, 22, 38), arms(60, 95, 130), legs(105, 125, 105, 125, 6))],
    [1.0, M(body(50, 24, 40), arms(60, 95, 130), legs(110, 130, 110, 130, 6))]] },
  // ---- a guard at his post: feet apart, chest out, arms a little off the body, looking about slowly, weight shifting
  guard_stand: { len: 8, keys: [
    [0, M(body(-3, -4, 0, 0), arms(14, 4, 16), legs(0, 0, 0, 0, 9))],
    [2, M(body(-3, -6, 0, 40), legs(2, 4, -1, 0, 9))],
    [3.2, M(body(-3, -6, 2, 38))],
    [5, M(body(-3, -6, 0, -42), legs(-1, 0, 2, 4, 9))],
    [6.4, M(body(-3, -6, -1, -38))],
    [8, M(body(-3, -4, 0, 0), arms(14, 4, 16), legs(0, 0, 0, 0, 9))]] },
  // ---- the guard takes a ticket: a hand out, it brought up to look at, torn, the stub handed back
  ticket_check: { len: 3, keys: [
    [0, M(body(-3, -4, 0), arms(14, 4, 16), legs(0, 0, 0, 0, 9))],
    [0.5, M(body(4, 2, 12), ra(16, 62, 22))],
    [1.0, M(body(4, 6, 26), ra(16, 35, 105), la(16, 30, 105))],
    [1.5, M(body(4, 6, 28), ra(16, 38, 108), la(16, 30, 104))],
    [1.75, M(body(4, 6, 24), ra(30, 40, 95), la(22, 28, 100))],     // the tear
    [2.25, M(body(6, 2, 10), ra(14, 64, 20), la(12, 8, 20))],         // the stub back
    [3, M(body(-3, -4, 0), arms(14, 4, 16))]] },
  // ---- a guard shoves someone aside with one hand: drawn back, a step in, the arm thrown out
  shove_aside: { len: 1.4, keys: [
    [0, M(body(-3, -4, 0), arms(14, 4, 16), legs(0, 0, 0, 0, 9))],
    [0.3, M(body(2, 2, 4, 10), { chest: { turn: 22 } }, ra(30, 35, 115), legs(0, 0, 0, 0, 9))],
    [0.5, M(body(10, 6, 0, -12), { chest: { turn: -24 } }, ra(55, 88, 8), { rightHand: { bend: -45 } }, legs(-6, 6, 26, 18, 9))],
    [0.85, M(body(8, 5, 0, -12), { chest: { turn: -18 } }, ra(50, 80, 14), legs(-6, 6, 24, 16, 9))],
    [1.4, M(body(-3, -4, 0), { chest: { turn: 0 } }, arms(14, 4, 16), { rightHand: { bend: 0 } }, legs(0, 0, 0, 0, 9))]] },
  // ---- seated: bent down to the floor beside the chair for a lota, up with it
  pick_up: { len: 2.6, import: { file: 'Sitting Talking.fbx', part: 'lower' }, keys: [
    [0, M(body(0, 0, 0), arms(12, 20, 40))],
    [0.8, M(body(38, 20, 25, 0, -10), ra(10, 30, 5), la(14, 25, 45))],
    [1.3, M(body(42, 22, 28, 0, -12), ra(8, 26, 8))],
    [2.0, M(body(10, 4, 8), ra(16, 35, 70))],
    [2.6, M(body(0, 0, 0), ra(16, 35, 75), la(12, 20, 40))]] },
  // ---- seated: a hand held out to the one beside, and back
  give: { len: 1.8, import: { file: 'Sitting Talking.fbx', part: 'lower' }, keys: [
    [0, M(body(0, 0, 0), ra(16, 35, 75), la(12, 20, 40))],
    [0.6, M(body(6, 4, 6, 10), { chest: { turn: 12 } }, ra(30, 70, 15))],
    [1.1, M(body(6, 4, 6, 10), ra(30, 70, 15))],
    [1.8, M(body(0, 0, 0, 0), { chest: { turn: 0 } }, ra(12, 20, 40))]] },
  // ---- seated: a hand out to take something, closed on it, brought back
  take: { len: 1.8, import: { file: 'Sitting Talking.fbx', part: 'lower' }, keys: [
    [0, M(body(0, 0, 0), arms(12, 20, 40))],
    [0.6, M(body(6, 4, 4, -8), { chest: { turn: -12 } }, ra(28, 68, 18))],
    [1.0, M(body(6, 4, 4, -8), ra(28, 66, 22))],
    [1.8, M(body(0, 0, 0, 0), { chest: { turn: 0 } }, ra(16, 35, 75))]] },
  // ---- seated, eating: the fruit up to the mouth, a bite, chewing with the hand down, again
  sit_eat: { len: 4, import: { file: 'Sitting Talking.fbx', part: 'lower' }, keys: [
    [0, M(body(4, 2, 0), ra(12, 30, 60), la(12, 20, 45))],
    [0.8, M(body(6, 4, 8), ra(14, 42, 140))],
    [1.1, M(body(8, 5, 14), ra(14, 44, 145))],     // the bite
    [1.5, M(body(4, 2, 2), ra(12, 30, 70))],
    [1.8, M(body(4, 2, 6))], [2.1, M(body(4, 2, 0))], [2.4, M(body(4, 2, 6))], [2.7, M(body(4, 2, 0))],   // chewing
    [3.3, M(body(4, 2, 2), ra(12, 30, 62))],
    [4, M(body(4, 2, 0), ra(12, 30, 60))]] },
  // ---- Ramu round the curtain's edge: bent, leaning out sideways, a hand on the cloth
  lurk: { len: 3, keys: [
    [0, M(body(16, 6, -6, 0, 14), ra(70, 40, 75), la(14, 20, 40), legs(22, 30, 8, 14, 8))],
    [1.5, M(body(18, 8, -4, 8, 16), legs(24, 32, 8, 14, 8))],
    [3, M(body(16, 6, -6, 0, 14), ra(70, 40, 75), legs(22, 30, 8, 14, 8))]] },
};

const name = process.argv[2], c = C[name];
if (!c) { console.error('clips:', Object.keys(C).join(' ')); process.exit(1); }
const steps = [{ tool: 'load_model', args: { path: `${A}/ramu_teen/ramu_rigged.fbx` } }];
if (c.import) {
  steps.push({ tool: 'import_animation', args: { path: `${A}/anims/${c.import.file}` } });
  steps.push({ tool: 'edit_take', args: { take: 'mixamo.com', body_part: c.import.part } });
}
steps.push({ tool: 'animate', args: { name, keys: c.keys.map(([time, pose]) => ({ time, pose })) } });
if (c.import) steps.push({ tool: 'edit_take', args: { take: name, body_part: 'upper' } });
const ts = [0, ...c.keys.map((k) => k[0]).filter((t) => t > 0 && t < c.len)].slice(0, 6);
for (const t of ts) steps.push({ tool: 'render', args: { time: t, view: process.env.VIEW ?? 'three-quarter', width: 256, height: 256 }, name: `${name}_${t}` });
steps.push({ tool: 'export', args: { path: `${OUT}/kp_${name}.fbx`, contents: 'animation', fps: 30, start: 0, end: c.len } });
console.log(JSON.stringify(steps));
