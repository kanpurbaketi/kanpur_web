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
  // ---- a car's lock, in four parts (the game plays them in turn and puts the hands on the lock, with the tools in them)
  // first a try of the door: a hand to the handle, a tug, a second harder one, let go, a look at it
  pick_try: { len: 1.4, keys: [
    [0, STAND],
    [0.35, M(body(6, 4, 14), ra(20, 62, 38), { rightHand: { bend: 20 } }, legs(4, 6, 0, 2, 5))],
    [0.55, M(body(-2, 0, 12, 0, -3), ra(18, 48, 62), legs(-2, 2, 6, 10, 5))],
    [0.75, M(body(4, 3, 14), ra(20, 60, 42))],
    [0.92, M(body(-4, -1, 10, 0, -4), ra(18, 44, 68), legs(-4, 2, 8, 12, 5))],
    [1.15, M(body(4, 2, 18, -6), ra(14, 30, 40), { rightHand: { bend: 0 } }, legs(2, 4, 0, 2, 5))],
    [1.4, M(body(6, 3, 16, 0), ra(12, 14, 24), legs(2, 4, 0, 2, 5))]] },
  // the tools out of the bag at his left hip, a look at them at the chest, bent down to the lock and in
  pick_start: { len: 1.3, keys: [
    [0, M(STAND, body(6, 3, 16, 0), ra(12, 14, 24), legs(2, 4, 0, 2, 5))],
    [0.35, M(body(6, 3, 26, 14), { chest: { turn: 16 } }, ra(6, 20, 48), { rightHand: { bend: 30 } })],
    [0.7, M(body(8, 6, 30, 0), { chest: { turn: 0 } }, ra(14, 24, 96), la(14, 24, 92), { rightHand: { bend: 0 } }, legs(6, 10, 0, 4, 6))],
    [1.0, M(body(14, 10, 26), arms(22, 52, 86), legs(12, 18, -3, 8, 6))],
    [1.3, M(body(16, 11, 26), arms(22, 52, 82), legs(14, 20, -3, 8, 6))]] },
  // at it (the loop): bent close, still from the waist up, weight shifting now and then, a pause and a quick look round
  pick_lock: { len: 3.2, keys: [
    [0, M(STAND, body(16, 11, 26), arms(22, 52, 82), legs(14, 20, -3, 8, 6))],
    [0.9, M(body(17, 11, 28, -3), legs(15, 22, -4, 8, 6))],
    [1.6, M(body(15, 10, 24, 2, 2), legs(12, 18, -2, 10, 6))],
    [2.0, M(body(13, 9, 10, 40))],          // a quick look over the shoulder
    [2.3, M(body(13, 9, 10, 44))],
    [2.6, M(body(16, 11, 26, 0, 0))],
    [3.2, M(body(16, 11, 26), legs(14, 20, -3, 8, 6))]] },
  // open: the turn, the tools out and back in the bag, up straight, a hand out to the handle
  pick_open: { len: 1.1, keys: [
    [0, M(STAND, body(16, 11, 26), arms(22, 52, 82), legs(14, 20, -3, 8, 6))],
    [0.25, M(body(14, 10, 22, 0, -3), { rightHand: { turn: -25 } })],
    [0.5, M(body(8, 5, 20), ra(14, 24, 92), la(14, 20, 60), { rightHand: { turn: 0 } }, legs(6, 10, 0, 4, 6))],
    [0.75, M(body(5, 3, 24, 12), { chest: { turn: 14 } }, ra(6, 20, 48), { rightHand: { bend: 30 } }, la(10, 8, 18))],
    [1.1, M(body(6, 4, 12), { chest: { turn: 0 } }, ra(20, 62, 38), { rightHand: { bend: 20 } }, la(10, 6, 14), legs(4, 6, 0, 2, 5))]] },
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
  // ---- standing with a hand mic held at the chest (the game aims it at the mouth), the free hand easy, looking round the house
  mic_stand: { len: 6, keys: [
    [0, M(body(0, -2, 0), ra(12, 35, 115), la(10, 8, 15), legs(0, 0, 0, 0, 6))],
    [1.6, M(body(0, -2, 2, 18), legs(2, 3, -1, 0, 6))],
    [3.2, M(body(0, -2, 0, -20), la(12, 12, 22))],
    [4.6, M(body(0, -2, 1, -8), legs(-1, 0, 2, 3, 6))],
    [6, M(body(0, -2, 0), ra(12, 35, 115), la(10, 8, 15), legs(0, 0, 0, 0, 6))]] },
  // ---- talking into it: the mic up at the mouth, the free hand making the points, nods, turning to the house
  mic_talk: { len: 4, keys: [
    [0, M(body(2, 0, 2, 0), ra(10, 38, 135), la(18, 30, 50), legs(0, 0, 0, 0, 6))],
    [0.7, M(body(2, 2, 6, 12), { chest: { turn: 8 } }, la(32, 48, 60))],
    [1.3, M(body(2, 0, -2, 8), la(40, 35, 35))],
    [2.0, M(body(2, 1, 4, -10), { chest: { turn: -8 } }, la(24, 50, 75))],
    [2.7, M(body(2, 0, 0, -14), la(36, 40, 40))],
    [3.4, M(body(2, 1, 5, 0), { chest: { turn: 0 } }, la(16, 26, 55))],
    [4, M(body(2, 0, 2, 0), ra(10, 38, 135), la(18, 30, 50), legs(0, 0, 0, 0, 6))]] },
  // ---- walking with the mic held at the chest (Mixamo's walk for the legs)
  mic_walk: { len: 1.033, import: { file: 'Walking.fbx', part: 'lower' }, keys: [
    [0, M(body(2, 0, 0), ra(12, 35, 115), la(10, 14, 20))],
    [0.5, M(body(2, 0, 1), la(10, -6, 14))],
    [1.033, M(body(2, 0, 0), ra(12, 35, 115), la(10, 14, 20))]] },
  // ---- the anchor holds the mic out to whoever is taking it, and lets his hand down empty
  mic_give: { len: 1.8, keys: [
    [0, M(body(0, -2, 0), ra(12, 35, 115), la(10, 8, 15), legs(0, 0, 0, 0, 6))],
    [0.6, M(body(6, 3, 8), ra(16, 66, 28))],
    [1.0, M(body(6, 3, 8), ra(16, 66, 28))],
    [1.8, M(body(0, -2, 2), ra(10, 6, 14))]] },
  // ---- and the one taking it: a hand out, closed on it, brought in to the chest
  mic_take: { len: 1.8, keys: [
    [0, M(STAND)],
    [0.6, M(body(6, 3, 6), ra(16, 64, 26))],
    [0.9, M(body(6, 3, 6), ra(16, 62, 30))],
    [1.8, M(body(0, -2, 2), ra(12, 35, 115))]] },
  // ---- up out of a chair: bent forward over the feet, hands pushing off, up straight (crossfaded from the sitting clip)
  rise: { len: 1.2, keys: [
    [0, M(body(34, 12, -12), arms(14, 38, 22), legs(40, 55, 40, 55, 6))],
    [0.55, M(body(18, 6, -4), arms(12, 20, 18), legs(18, 22, 18, 22, 4))],
    [1.2, STAND]] },
  // ---- seated, called by somebody else's name: a look left, a look right, then "me?" with a hand on his chest
  self_point: { len: 2.6, import: { file: 'Sitting Talking.fbx', part: 'lower' }, keys: [
    [0, M(body(0, 0, 0), arms(12, 22, 40))],
    [0.5, M(body(0, 0, 0, 35))],
    [1.0, M(body(0, 0, 0, -35))],
    [1.5, M(body(2, -2, -4, 0), { head: { side: 8 } }, ra(28, 26, 150))],
    [2.2, M(body(2, -2, -4, 0), { head: { side: 10 } }, ra(28, 26, 150))],
    [2.6, M(body(0, 0, 0, 0), { head: { side: 0 } }, ra(14, 28, 70))]] },
  // ---- the giant wheel: up from hanging under a cabin onto its roof (the game moves him up the side and in over the
  // edge): a pull-up, the chest over the edge, a knee up, crouched on the roof
  climb_roof: { len: 1.7, keys: [
    [0, M(body(0, 0, -10), arms(8, 168, 12), legs(4, 8, 2, 6, 4))],
    [0.5, M(body(4, 2, -14), arms(10, 150, 118), legs(22, 34, 10, 22, 4))],
    [0.9, M(body(40, 18, 8), arms(12, 40, 70), legs(62, 92, 12, 24, 6))],
    [1.3, M(body(32, 12, 14), arms(12, 32, 24), legs(96, 122, 44, 82, 8))],
    [1.7, M(body(22, 10, 12), arms(14, 34, 26), legs(84, 112, 84, 112, 14))]] },
  // crouched on a cabin's roof as the wheel carries him: low, a hand down on the roof, the other out for balance, swaying,
  // a look down at the guard and back at the cabin behind
  roof_crouch: { len: 4, keys: [
    [0, M(body(22, 10, 12, 0, 0), ra(10, 38, 14), la(55, 25, 22), legs(84, 112, 84, 112, 14))],
    [1.0, M(body(24, 11, 22, -30, 4), la(60, 22, 18), legs(82, 110, 86, 115, 14))],
    [2.0, M(body(20, 9, 6, 0, -3), la(50, 30, 26), legs(86, 115, 82, 110, 14))],
    [3.0, M(body(22, 10, 4, 38, 2), la(58, 24, 20), legs(84, 112, 84, 112, 14))],
    [4, M(body(22, 10, 12, 0, 0), ra(10, 38, 14), la(55, 25, 22), legs(84, 112, 84, 112, 14))]] },
  // the leap from one roof to the next: down, the arms swung back, up and out, knees tucked, down into a crouch
  roof_leap: { len: 0.9, keys: [
    [0, M(body(22, 10, 12), ra(10, 38, 14), la(55, 25, 22), legs(84, 112, 84, 112, 14))],
    [0.18, M(body(36, 16, 0), arms(22, -35, 30), legs(96, 124, 96, 124, 14))],
    [0.34, M(body(4, 0, -12), arms(24, 160, 20), legs(4, 8, 0, 6, 6))],
    [0.6, M(body(24, 10, 4), arms(34, 100, 40), legs(82, 105, 82, 105, 10))],
    [0.9, M(body(24, 12, 12), arms(22, 50, 30), legs(84, 112, 84, 112, 14))]] },
  // ---- a rock in the back while running: arched back, arms flung, then pitched forward, hands out to break the fall
  struck: { len: 0.8, keys: [
    [0, M(body(10, 4, 0), arms(14, 20, 60), legs(25, 40, -15, 30, 4))],
    [0.14, M(body(-18, -14, -26), arms(45, -40, 25), legs(10, 30, -20, 50, 4))],
    [0.45, M(body(28, 10, -10), arms(30, 120, 20), legs(25, 30, -25, 70, 4))],
    [0.8, M(body(32, 12, -14), arms(30, 140, 15), legs(20, 20, -30, 75, 4))]] },
  // ---- the slow-mo fall: over backward and down (into the well), the back arched, both arms reaching up and out for where
  // he fell from, the head up looking after it, the legs lifting and kicking slowly; the game holds it through the fall
  fall_reach: { len: 2.4, keys: [
    [0, M(body(-14, -10, -18), { hips: { bend: -45 } }, arms(58, 145, 20), legs(40, 30, 25, 45, 6))],
    [0.6, M(body(-12, -8, 18), { hips: { bend: -72 } }, arms(34, 118, 14), { rightUpperArm: { raise: 44 } }, legs(55, 45, 35, 60, 8))],
    [1.2, M(body(-10, -6, 30, 0, 4), { hips: { bend: -85 } }, arms(30, 128, 22), { leftUpperArm: { raise: 48 }, leftLowerArm: { bend: 34 } }, legs(65, 55, 30, 40, 9))],
    [1.8, M(body(-10, -8, 28, 6, -3), { hips: { bend: -86 } }, arms(46, 112, 12), { rightLowerArm: { bend: 30 } }, legs(40, 30, 62, 70, 9))],
    [2.4, M(body(-10, -6, 30, 0, 2), { hips: { bend: -85 } }, arms(36, 124, 20), legs(58, 50, 38, 48, 9))]] },
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
