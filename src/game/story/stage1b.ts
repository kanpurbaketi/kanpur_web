import * as THREE from 'three';
import type { Ramu } from '../../player/ramu';
import { foodMesh, type FoodName } from '../../world/foods';
import { HandProp } from '../../world/handProp';
import type { Mela, Sammelan } from '../../world/mela';
import type { Person } from '../../world/person';
import type { Director } from './director';
import { tk } from '../../i18n';
import { RhymeQuiz } from '../../ui/rhyme';
import { Throwers } from '../../world/throwers';
import type { StoryHooks } from './stage1';
import { playSfx } from './sfx';
import { PART3_FROM, chaseFor, sendGuards, stage1Part3 } from './stage1c';

/*
 Stage 1, part 2 (plans/09-stage1-part2.md): inside the mela, at the kavi sammelan. Built so far:
   mission 4  get behind the stage: the back-stage door, by the torn sheet he came in through
   beat 1     at the door: through the curtain, the poets eating fruit; Ramu's stomach growls. Kumar winces, turns to the
              poet beside him: "Are guru, yahan shauchalaya ka intezaam hai ka?" / "Yahan kahan, hum toh apna lota lekar
              chalte hain." / "Laao, lota laao." The poet hands him the lota from beside his sofa.
   beat 2     Kumar gets up with it and goes round the end of the row, behind the sofas and down the far stairs, out of
              sight; Ramu: "Kursi khaali… aur thaali bhari."
*/

const DOOR_R = 3;

/** `from`: the mission to start at (a test start); 6 and on are part 3's (see PART3_FROM) */
export async function stage1Part2(d: Director, ramu: Ramu, mela: Mela, hooks: StoryHooks, from = 4): Promise<void> {
  theMela = mela;
  if (from >= 6) return stage1Part3(d, ramu, mela, hooks, PART3_FROM[from] ?? 'start');
  const s = await mela.sammelan;

  // ---- mission 4: behind the stage ----
  const [dx, dz] = s.door;
  if (from <= 4) {
    await d.mission(4, 'm.s1.stage', [{ at: s.door, hint: 'm.s1.stage.h1', done: (x, z) => Math.hypot(x - dx, z - dz) < DOOR_R }]);
    hooks.step(4);
  } else {
    ramu.standAt(dx, dz);
    d.fastForward = true;                            // the scene at the door, skipped
  }

  // ---- beats 1-2: the poets eat; Kumar's stomach; the lota; Kumar goes ----
  eating(s);
  const skipped = await lotaScene(d, ramu, s);
  d.fastForward = false;
  void kumarGoes(d, s, skipped);

  // ---- mission 5: the empty seat ----
  await takeSeat(d, ramu, s);
  hooks.step(5);
  await sitAndEat(d, ramu, s);

  // ---- beats 4-5: a little later, the anchor's shayaris, "Kumar Andhvishwas!", and the mic ----
  await d.wait(4);
  await anchorCalls(d, ramu, s);

  // ---- beats 6-7: the rhyme quiz, three times (the third rigged: whatever he says, it is wrong) ----
  const ui = new RhymeQuiz();
  const throwers = new Throwers(s, () => ramu.position);
  throwers.onHit = () => { ramu.flinch(); void playSfx('thud', 0.8); };
  for (const q of QUIZ) await quiz(d, ramu, s, ui, throwers, q);

  // ---- beats 8-10: found out; everyone up; "pakdo!"; the guards; run ----
  foundOut(ramu, s, throwers);
  hooks.note('story.s1.part2');
  // ---- part 3 (stage1c.ts): the chase across the mela ----
  await stage1Part3(d, ramu, mela, hooks);
}

let theMela: Mela | null = null;

/** the couplets (quiz.s1.<n> in i18n): which second line is the right one; the last is rigged */
const QUIZ = [{ n: 1, right: 1, rigged: false }, { n: 2, right: 0, rigged: false }, { n: 3, right: 3, rigged: true }];

/**
 Ramu "recites" the first line; the player picks the second (the quiz panel); he says the couplet. Right: applause, wah
 wah, the poets clapping. Wrong (or nothing picked in time, or the rigged one): boos, and those nearest the stage get up
 and throw food at him (the rigged one: chappals and shoes too); what reaches him, he flinches at.
*/
async function quiz(d: Director, ramu: Ramu, s: Sammelan, ui: RhymeQuiz, throwers: Throwers, q: (typeof QUIZ)[number]): Promise<void> {
  const key = `quiz.s1.${q.n}`, line = `${key}.line`;
  const close = () => d.front(ramu, { dist: 2.0, side: 0.6, up: 0, drop: 0.25, fov: 38 });
  await d.scene(async () => {
    const r = close();
    d.shot(r, 0, d.pushIn(r, 0.03));
    await d.wait(0.5);
    ramu.holdClip('mic_talk');
    await d.say('ramu', ramu.face, `q${q.n}`, line);
    ramu.holdClip('mic_stand');
    await d.wait(0.2);
  });
  ramu.yaw = s.facing;                                         // over his shoulder at the audience, while he thinks
  const a = await ui.ask({ line, choices: [0, 1, 2, 3].map((i) => `${key}.c${i}`), right: q.right, rigged: q.rigged });
  await d.scene(async () => {
    const r = close();
    d.shot(r, 0, d.pushIn(r, 0.03));
    await d.wait(0.2);
    ramu.holdClip('mic_talk');
    if (a.picked >= 0) {
      const second = `${key}.c${a.picked}`;
      await d.say('ramu', ramu.face, `q${q.n}c${a.picked}`, second, () => `${tk(line)}\n${tk(second)}`);
    } else await d.say('ramu', ramu.face, 'umm');
    ramu.holdClip('mic_stand');
    const [fx, fz] = [-Math.sin(s.facing), -Math.cos(s.facing)];
    const head = new THREE.Vector3();
    if (!ramu.headPosition(head)) head.set(ramu.position.x, ramu.position.y + 1.5, ramu.position.z);
    // from the audience, up at him
    const house = { pos: v(head.x + fx * 7.5 + fz * 1.5, head.y - 0.6, head.z + fz * 7.5 - fx * 1.5), look: v(head.x, head.y - 0.3, head.z), fov: 40 };
    if (a.right) {
      void playSfx('applause', 1, 4);
      clap(d, s);
      d.shot(house, 0.5, d.pushIn(house, 0.1));
      await d.say('audience', null, 'wah');
      await d.wait(1.2);
      return;
    }
    // boos, and over his shoulder: the front rows getting up, things coming at him
    void playSfx('boo', 1, 3.5);
    const over = { pos: v(head.x - fx * 1.8 - fz * 0.7, head.y + 0.35, head.z - fz * 1.8 + fx * 0.7), look: v(head.x + fx * 6, head.y - 1.4, head.z + fz * 6), fov: 50 };
    d.shot(over, 0);
    let landed = false;
    void throwers.volley(q.rigged ? 14 : 8, q.rigged, q.rigged ? 3 : 2.2, q.rigged ? null : 3).then(() => { landed = true; });
    await d.say('audience', null, 'boo');
    d.shot(house, 0, d.pushIn(house, 0.05));
    if (q.rigged) { await d.wait(1.6); await kumarBack(d, ramu, s, throwers); return; }   // in the middle of it: Kumar
    await d.until(() => landed || d.skipped);
    await d.wait(0.6);
  });
  ramu.yaw = s.facing;
}

/** where Kumar stops, on his way to Ramu from the top of the stairs */
function kumarStop(ramu: Ramu, s: Sammelan): [number, number] {
  const top = s.exit[4], p = ramu.position, dx = top[0] - p.x, dz = top[1] - p.z, d = Math.hypot(dx, dz) || 1;
  return [p.x + (dx / d) * 2.4, p.z + (dz / d) * 2.4];
}

/**
 Beats 7-9 (inside the last quiz's scene): the real Kumar back up the far stairs, lota in hand: "Abey guru, tum kaun ho
 be?"; Ramu: "Heh… hum? Hum toh bas…"; everybody on their feet, poets and audience; the anchor points: "Dhokebaaz hai ye
 launda, pakdo!"; four guards in through the sammelan's gates.
*/
async function kumarBack(d: Director, ramu: Ramu, s: Sammelan, throwers: Throwers): Promise<void> {
  const k = s.kumar, { anchor } = s;
  const foot = s.exit[5], top = s.exit[4], stop = kumarStop(ramu, s);
  k.visible = true;
  k.idle();
  k.place(...foot);
  k.position.y = s.ground(...foot);
  holdLota(s, k);
  s.quiet.add(k);
  k.face.angry = 1;
  const [fx, fz] = [-Math.sin(s.facing), -Math.cos(s.facing)];
  // from out front, the stairs and Ramu at the mic both in it
  const mid = [(top[0] + ramu.position.x) / 2, (top[1] + ramu.position.z) / 2];
  d.shot({ pos: v(mid[0] + fx * 8.5, s.floor + 1.6, mid[1] + fz * 8.5), look: v(mid[0], s.floor + 0.9, mid[1]), fov: 46 }, 0);
  void walk(d, k, [top, stop], 1.7);
  await d.until(() => !walking.has(k) || d.skipped);
  await d.wait(0.2);
  k.faceTowards(ramu.position.x, ramu.position.z);
  const kf = d.front(k, { dist: 1.7, side: 0.4, up: 0.05, drop: 0.15, fov: 37 });
  d.shot(kf, 0, d.pushIn(kf, 0.03));
  await d.wait(0.3);
  await d.say('kumar', k.face, 'who');
  // Ramu, caught
  ramu.holdClip('idle');
  s.micProp.mode = 'palm';
  ramu.faceTowards(k.position.x, k.position.z);
  const r = d.front(ramu, { dist: 1.5, side: 0.45, up: 0, drop: 0.15, fov: 37 });
  d.shot(r, 0, d.pushIn(r, 0.03));
  await d.wait(0.3);
  await d.say('ramu', ramu.face, 'gulp');
  // everybody up
  standUpAll(s, ramu, throwers);
  const head = new THREE.Vector3();
  if (!ramu.headPosition(head)) head.set(ramu.position.x, ramu.position.y + 1.5, ramu.position.z);
  d.shot({ pos: v(head.x - fx * 2.2 + fz * 1.2, head.y + 0.9, head.z - fz * 2.2 - fx * 1.2), look: v(head.x + fx * 7, head.y - 1.6, head.z + fz * 7), fov: 55 }, 0);
  void playSfx('boo', 0.7, 2.5);
  await d.wait(2.0);
  // the anchor: "pakdo!"
  anchor.faceTowards(ramu.position.x, ramu.position.z);
  anchor.gesture('angry_point', 'pakdo', 2.4);
  anchor.face.angry = 1;
  const af = d.front(anchor, { dist: 2.0, side: -0.5, up: 0.05, drop: 0.2, fov: 40 });
  d.shot(af, 0, d.pushIn(af, 0.04));
  await d.wait(0.3);
  await d.say('anchor', anchor.face, 'pakdo');
  // the guards, up the stage's stairs at him
  ramu.faceTowards(s.exit[4][0], s.exit[4][1]);
  await guards(ramu, s);
  const rx = ramu.position.x, rz = ramu.position.z, foot2 = s.exit[5];
  const ax = top[0] - rx, az = top[1] - rz, al = Math.hypot(ax, az) || 1;
  // from behind them, in line with the stairs: they run in past the camera and up the stairs, and beyond, on the stage,
  // him (till the first of them is up there)
  d.shot({ pos: v(foot2[0] + (ax / al) * 7 + fx * 1.4, s.floor + 1.1, foot2[1] + (az / al) * 7 + fz * 1.4),
    look: v(top[0] + (rx - top[0]) * 0.35, s.floor + 0.5, top[1] + (rz - top[1]) * 0.35), fov: 50 }, 0);
  const t0 = performance.now();
  await d.until(() => d.skipped || performance.now() - t0 > 7000 || guardUp(ramu, s));
  // and he is off: the mic dropped, a dash to the stage's front edge and a jump down off it, onto the ground before the
  // dari, and away (mission 6 starts down there, the guards still up on the stage)
  await jumpOff(d, ramu, s);
}

/** where he jumps from (the stage's front edge, in line with him) and lands (on the ground, before the audience) */
function jumpLine(ramu: Ramu, s: Sammelan): { edge: [number, number]; land: [number, number] } {
  const [fx, fz] = [-Math.sin(s.facing), -Math.cos(s.facing)];            // out toward the audience
  let { x, z } = ramu.position;
  for (let i = 0; i < 80 && s.ground(x + fx * 0.1, z + fz * 0.1) >= s.floor - 0.05; i++) { x += fx * 0.1; z += fz * 0.1; }
  return { edge: [x - fx * 0.15, z - fz * 0.15], land: [x + fx * JUMP_OUT, z + fz * JUMP_OUT] };
}
/** how far out past the stage's edge he lands (the audience's dari starts ~3 m out) */
const JUMP_OUT = 1.5;
/** jump_far (stage1c.ts): 1.03 s; the feet leave at 0.07 s, down again at 0.73 s */
const JF_LEN = 1.03, JF_OFF = 0.07, JF_LAND = 0.73;

/** is the first of the guards up the stairs, on the stage? */
function guardUp(ramu: Ramu, s: Sammelan): boolean {
  if (!theMela) return true;
  const top = s.exit[4];
  return chaseFor(theMela, ramu).guards.some((g) => Math.hypot(g.position.x - top[0], g.position.z - top[1]) < 1.6);
}

/** drop the mic where he stands */
function dropMic(s: Sammelan, x: number, z: number): void {
  const m = s.micProp;
  m.holder(null);
  m.object.position.set(x + 0.3, s.floor + 0.03, z + 0.2);
  m.object.rotation.set(0, 0.6, Math.PI / 2);
}

/** the dash to the front edge and the jump down off the stage */
async function jumpOff(d: Director, ramu: Ramu, s: Sammelan): Promise<void> {
  const { edge, land } = jumpLine(ramu, s);
  dropMic(s, ramu.position.x, ramu.position.z);
  // the guards pull up at the top of the stairs as he goes (mission 6 sets them on him again, down off the stage after him)
  if (theMela) chaseFor(theMela, ramu).stop();
  const ly = s.ground(land[0], land[1]);
  const [fx, fz] = [-Math.sin(s.facing), -Math.cos(s.facing)];
  // side on, out in front of the stage and off to the side away from the stairs: the edge, the drop and where he lands
  const sx = -fz, sz = fx, side = Math.sign((edge[0] - s.exit[4][0]) * sx + (edge[1] - s.exit[4][1]) * sz) || 1;
  const mid = [(edge[0] + land[0]) / 2, (edge[1] + land[1]) / 2];
  d.shot({ pos: v(mid[0] + fx * 2.2 + sx * side * 5.2, ly + 1.3, mid[1] + fz * 2.2 + sz * side * 5.2), look: v(mid[0] - fx * 0.6, (s.floor + ly) / 2 + 0.7, mid[1] - fz * 0.6), fov: 50 }, 0);
  await walkRamu(d, ramu, [edge], 4.2, 'run');
  // the jump: off the edge, a little up, and down onto the ground
  ramu.model.rotation.y = s.facing;
  ramu.gesture('jump_far', 1);
  const y0 = s.floor;
  await d.tween(JF_LEN, (k) => {
    const f = Math.max(0, Math.min(1, (k * JF_LEN - JF_OFF) / (JF_LAND - JF_OFF)));
    ramu.position.set(edge[0] + (land[0] - edge[0]) * f, y0 + (ly - y0) * f * f + Math.sin(Math.PI * f) * 0.3, edge[1] + (land[1] - edge[1]) * f);
  });
  void playSfx('thud', 0.5);
  ramu.position.set(land[0], ly, land[1]);
}

/** the four guards from the sammelan's gates, after him (stage1c.ts: the chase) */
function guards(ramu: Ramu, s: Sammelan): Promise<void> {
  return theMela ? sendGuards(theMela, s, ramu).catch((e) => console.error('guards failed', e)) : Promise.resolve();
}

let stood = false;
/** the poets up out of their seats (a step forward), and everyone in the audience on their feet, all facing Ramu */
function standUpAll(s: Sammelan, ramu: Ramu, throwers: Throwers): void {
  throwers.standAll();
  if (stood) return;
  stood = true;
  const [fx, fz] = [-Math.sin(s.facing), -Math.cos(s.facing)];
  s.poets.forEach((p, i) => {
    const [x, z] = s.seats[i + 1];
    p.idle();
    p.place(x + fx * 0.45, z + fz * 0.45);
    p.position.y = s.floor;
    p.faceTowards(ramu.position.x, ramu.position.z);
    p.face.laughing = false;
    s.quiet.add(p);
    p.face.talking = false;
  });
}

/** watched or skipped, after the last quiz: Kumar back with his lota, everyone up, the guards coming, Ramu free to run */
function foundOut(ramu: Ramu, s: Sammelan, throwers: Throwers): void {
  const k = s.kumar, { anchor } = s;
  if (!k.visible || walking.has(k)) {
    stopWalk(k);
    const stop = kumarStop(ramu, s);
    k.visible = true;
    k.idle();
    k.place(...stop);
    k.position.y = s.ground(...stop);
    holdLota(s, k);
  }
  k.faceTowards(ramu.position.x, ramu.position.z);
  standUpAll(s, ramu, throwers);
  anchor.idle();
  anchor.faceTowards(ramu.position.x, ramu.position.z);
  void guards(ramu, s);
  // the mic dropped (at the mic, if it is still in his hand: a skip), Ramu down off the stage, on his feet and his own again
  const { land } = jumpLine(ramu, s);
  if (ramu.position.y > s.ground(land[0], land[1]) + 0.3) {
    dropMic(s, s.mic[0], s.mic[1]);
    ramu.position.set(land[0], s.ground(land[0], land[1]), land[1]);
  }
  ramu.standUp(ramu.position.x, ramu.position.z, s.ground(ramu.position.x, ramu.position.z));
  ramu.model.rotation.y = s.facing;
  ramu.yaw = s.facing;
}

/** the poets clap for a few seconds, then go back to what they were doing */
function clap(d: Director, s: Sammelan): void {
  for (const p of s.poets) {
    const was = p.pose;
    p.hold('sitting_clap', 0.9 + Math.random() * 0.3);
    void d.wait(2.5 + Math.random()).then(() => { if (p.pose === 'sitting_clap') p.hold(was ?? 'sitting_talking'); });
  }
}

/** up on the stage (through the curtain at the back, or any way he likes) and into Kumar's chair */
async function takeSeat(d: Director, ramu: Ramu, s: Sammelan): Promise<void> {
  const p = ramu.position, [cx, cz] = s.seats[0];
  const onStage = () => p.y > s.floor - 0.3 && s.ground(p.x, p.z) >= s.floor - 0.01;
  const byDoor = () => !onStage() && (near(p, s.door, 2.6) || near(p, s.behind, 1.6));
  const byChair = () => onStage() && Math.hypot(p.x - cx, p.z - cz) < 1.4;
  let sat = false;
  d.prompt = {
    key: () => (byChair() ? 'act.sit' : 'act.curtain'), when: () => byDoor() || byChair(),
    act: () => {
      if (byChair()) { sat = true; return; }
      ramu.standAt(s.inside[0], s.inside[1], s.floor);
      ramu.faceTowards(cx, cz);
      const end = s.seats[s.seats.length - 1];                // the camera down the row (behind him is the banner)
      ramu.yaw = Math.atan2(-(end[0] - cx), -(end[1] - cz));
    },
  };
  await d.mission(5, 'm.s1.seat', [
    { at: s.door, hint: 'm.s1.seat.h1', done: () => onStage() || sat },
    { at: s.seats[0], hint: 'm.s1.seat.h2', done: () => sat },
  ]);
  d.prompt = null;
}

const SIT_FWD = 0.05;
/** Ramu on the armchair's cushion: the seats are set for the grown-up poets, and his (shorter) sitting pose put his
 * thighs 12-17 cm into the cushion (its top 0.375 m above the stage; his thighs' joints at ~0.29) */
const SIT_LIFT = 0.15;

/** beat 3: Ramu in the armchair, a fruit off Kumar's plate, eating; the poet beside him gives him a look */
async function sitAndEat(d: Director, ramu: Ramu, s: Sammelan): Promise<void> {
  const [cx, cz] = s.seats[0], poet = s.poets[0];
  // a little forward on the seat: his (shorter) shins clear of the armchair's front panel
  ramu.sitAt(cx - Math.sin(s.facing) * SIT_FWD, s.seatY + SIT_LIFT, cz - Math.cos(s.facing) * SIT_FWD, s.facing, 'sit_eat');
  ramu.yaw = s.facing;
  fruit = foodMesh('apple').then((m) => {
    s.group.add(m);
    const h = new HandProp(m, 'palm');
    h.holder(ramu.model);
    s.props.push(h);
    return h;
  }).catch(() => null);
  await d.scene(async () => {
    const r = d.front(ramu, { dist: 1.7, side: 0.5, up: 0.05, drop: 0.2, fov: 38 });
    d.shot(r, 0, d.pushIn(r, 0.03));
    await d.wait(2.2);
    // the poet beside him: a look (who is this?), and back to his plate
    poet.turn(s.facing + 0.45);
    const two = d.front(poet, { dist: 2.4, side: 0.8, up: 0.15, drop: 0.2, fov: 44 });
    d.shot(two, 0.4);
    await d.wait(1.6);
    poet.turn(s.facing);
    d.shot(r, 0, d.pushIn(r, 0.03));
    await d.say('ramu', ramu.face, 'vip');
    await d.wait(0.6);
  });
  poet.turn(s.facing);
}

/** the fruit in Ramu's hand while he eats in the chair */
let fruit: Promise<HandProp | null> = Promise.resolve(null);

/** gone from his hand (eaten, or put down to take the mic) */
function dropFruit(s: Sammelan): void {
  void fruit.then((h) => {
    if (!h) return;
    s.group.remove(h.object);
    s.props.splice(s.props.indexOf(h), 1);
  });
  fruit = Promise.resolve(null);
}

/**
 Beat 4: the anchor at the mic, three shers about Kanpur (wah wah, applause), then the call: "Ab hamare beech aa rahe
 hain, ubharte kavi, Kumar Andhvishwas!" Applause; the poets look at Kumar's chair, and at who is in it.
 Beat 5: Ramu (a moment, then: "Arre… hum? Haan haan, hum hi toh hain!") gets up and goes to the mic; the anchor hands it
 over ("Aaiye, aaiye Kumar ji") and steps aside; Ramu at the mic, holding it up to recite.
*/
async function anchorCalls(d: Director, ramu: Ramu, s: Sammelan): Promise<void> {
  const { anchor, micProp } = s, [mx, mz] = s.mic, A = s.floor;
  const fx = -Math.sin(s.facing), fz = -Math.cos(s.facing);     // toward the audience
  // from the audience, a few rows back, up at the stage
  const house = { pos: v(mx + fx * 9, A + 0.9, mz + fz * 9 - 1.5), look: v(mx, A + 1.2, mz), fov: 42 };
  s.quiet.add(anchor);
  await d.scene(async () => {
    const a = d.front(anchor, { dist: 2.3, side: 0.55, up: -0.15, drop: 0.12, fov: 38 });
    const a2 = d.front(anchor, { dist: 3.4, side: -1.1, up: -0.3, drop: 0.25, fov: 40 });
    const shers: [string, string][] = [['sher1a', 'sher1b'], ['sher2a', 'sher2b'], ['sher3a', 'sher3b']];
    for (let i = 0; i < shers.length; i++) {
      const sh = [a, a2, house][i];
      d.shot(sh, i ? 0.7 : 0, d.pushIn(sh, 0.04));
      anchor.hold('mic_talk', 0.9);
      await d.wait(0.3);
      await d.say('anchor', anchor.face, shers[i][0]);
      await d.say('anchor', anchor.face, shers[i][1]);
      anchor.hold('mic_stand');                                 // the mic down to his chest for the wah wah
      void playSfx('applause', 0.7, 2.2);
      await d.say('audience', null, 'wah');
    }
    // the call
    d.shot(a, 0, d.pushIn(a, 0.05));
    anchor.hold('mic_talk', 0.9);
    await d.wait(0.3);
    await d.say('anchor', anchor.face, 'intro');
    anchor.hold('mic_stand');
    void playSfx('applause', 1, 4);
    // nobody gets up; the poets look at Kumar's chair, and at who is in it
    const row = d.front(s.poets[2], { dist: 3.0, side: 2.0, up: 0.2, drop: 0.25, fov: 50 });
    d.shot(row, 0);
    anchor.turn(anchor.towards(ramu.position.x, ramu.position.z));
    for (const p of s.poets) glance(s, p, ramu.position.x, ramu.position.z);
    await d.wait(1.8);
    // Ramu: a look left, a look right (who, me?), a hand on his chest
    ramu.holdClip('sitting_talking');
    dropFruit(s);
    const r = d.front(ramu, { dist: 1.6, side: 0.45, up: 0.05, drop: 0.15, fov: 37 });
    d.shot(r, 0, d.pushIn(r, 0.03));
    ramu.gesture('self_point');
    await d.wait(1.5);
    await d.say('ramu', ramu.face, 'me');
    await d.wait(0.3);
    // up out of the chair, round the end of the table and over to the mic, the anchor waiting there for him
    const path = micPath(s);
    const side = { pos: v(path[1][0] + fx * 3.6 - fz * 2.2, A + 1.5, path[1][1] + fz * 3.6 + fx * 2.2), look: v(path[1][0] + fx * 0.8, A + 0.9, path[1][1] + fz * 0.8), fov: 48 };
    d.shot(side, 0);
    ramu.gesture('rise', 1.1);
    const seat: [number, number] = [ramu.position.x, ramu.position.z];
    await d.tween(1.0, (k) => ramu.position.set(seat[0] + (path[0][0] - seat[0]) * k, A, seat[1] + (path[0][1] - seat[1]) * k));
    ramu.stopGesture();
    anchor.faceTowards(...s.micSide);
    await walkRamu(d, ramu, path, 1.3, 'walk');
    // the handover: the anchor holds the mic out, Ramu takes it (the hands meet ~0.7 s in)
    ramu.faceTowards(anchor.position.x, anchor.position.z);
    anchor.faceTowards(ramu.position.x, ramu.position.z);
    const hand = { pos: v(mx + fx * 3.2 - fz * 0.4, A + 1.5, mz + fz * 3.2 + fx * 0.4), look: v((mx + s.micSide[0]) / 2, A + 1.2, (mz + s.micSide[1]) / 2), fov: 40 };
    d.shot(hand, 0);
    anchor.hold('mic_talk', 0.9);
    await d.say('anchor', anchor.face, 'handover');
    micProp.own = true;                                       // the arm out as the clip has it, not at his mouth
    anchor.gesture('mic_give', 'handover', 1.8);
    await d.wait(0.1);
    ramu.gesture('mic_take');
    await d.wait(0.7);
    micProp.mode = 'mic';
    micProp.holder(ramu.model);
    micProp.own = false;                                      // (eases up to Ramu's mouth)
    await d.wait(1.0);
    // the anchor steps aside, Ramu steps up to the mic with it
    anchor.walkClip = 'walk';
    anchor.walkTo(...s.aside, 1.0);
    await d.wait(0.6);
    ramu.stopGesture();
    await walkRamu(d, ramu, [s.mic], 0.9, 'mic_walk');
    atMic(ramu, s);
    d.shot(house, 0.9, d.pushIn(house, 0.15));
    await d.wait(1.6);
  });
  // watched or skipped: Ramu at the mic with it, the anchor aside, facing the audience, the poets looking at Ramu
  dropFruit(s);
  ramu.stopGesture();
  micProp.holder(ramu.model);                                   // (skipped: handed over, the anchor already aside)
  micProp.own = false;
  if (anchor.walking || Math.hypot(anchor.position.x - s.aside[0], anchor.position.z - s.aside[1]) > 0.3) anchor.place(...s.aside);
  anchor.walkClip = 'walk';
  anchor.idle();
  anchor.turn(anchor.towards(...s.mic));
  anchor.face.talking = false;
  atMic(ramu, s);
  for (const p of s.poets) glance(s, p, ...s.mic);
}

/** a seated poet turns toward (x, z), as far as one can turn in a sofa */
function glance(s: Sammelan, p: Person, x: number, z: number): void {
  const a = p.towards(x, z) - s.facing, d = Math.atan2(Math.sin(a), Math.cos(a));
  p.turn(s.facing + Math.max(-0.55, Math.min(0.55, d)));
}

/** from Kumar's chair to beside the mic: out in front of the chair, along the row past the end of the table, and
 round it to the mic's side (world points; the first is where he stands up to, in front of the chair) */
function micPath(s: Sammelan): [number, number][] {
  const [cx, cz] = s.seats[0], [nx, nz] = s.seats[1];
  const fx = -Math.sin(s.facing), fz = -Math.cos(s.facing);       // toward the audience
  let ox = cx - nx, oz = cz - nz;                                   // along the row, outward past his chair
  const ol = Math.hypot(ox, oz) || 1;
  ox /= ol; oz /= ol;
  return [[cx + fx * 0.45, cz + fz * 0.45], [cx + fx * 0.5 + ox * 1.1, cz + fz * 0.5 + oz * 1.1],
    [cx + fx * 2.3 + ox * 1.1, cz + fz * 2.3 + oz * 1.1], s.micSide];
}

/** Ramu walks through the points at `speed` m/s on the stage, playing `clip` (the walk, or with the mic: mic_walk) */
async function walkRamu(d: Director, ramu: Ramu, pts: [number, number][], speed: number, clip: string): Promise<void> {
  const y = ramu.position.y;
  ramu.sitAt(ramu.position.x, y, ramu.position.z, ramu.facing, clip);
  for (const [x, z] of pts) {
    const x0 = ramu.position.x, z0 = ramu.position.z, len = Math.hypot(x - x0, z - z0);
    if (len < 0.05) continue;
    ramu.model.rotation.y = Math.atan2(-(x - x0), -(z - z0));
    await d.tween(len / speed, (k) => ramu.position.set(x0 + (x - x0) * k, y, z0 + (z - z0) * k));
  }
}

/** at the mic, facing the audience, holding it (up to his mouth as he talks: mic_talk) */
function atMic(ramu: Ramu, s: Sammelan): void {
  ramu.sitAt(s.mic[0], s.floor, s.mic[1], s.facing, 'mic_stand');
  s.micProp.mode = 'mic';
  s.micProp.holder(ramu.model);
  ramu.yaw = s.facing;
}

const near = (p: THREE.Vector3, [x, z]: [number, number], r: number) => Math.hypot(p.x - x, p.z - z) < r;

/** some of the poets take a fruit from their plates and eat (the sit_eat clip, the fruit in the right hand) from now on */
function eating(s: Sammelan): void {
  const EAT: [number, FoodName, number][] = [[1, 'apple', 1], [3, 'banana', 0.55], [4, 'orange', 1], [6, 'mango', 0.85]];
  for (const [i, food, size] of EAT) {
    const p = s.poets[i];
    if (!p) continue;
    p.hold('sit_eat', 0.8 + i * 0.05);
    p.actor.update(i * 1.7);                                  // each at their own moment of it
    void foodMesh(food, size).then((m) => {
      s.group.add(m);
      const h = new HandProp(m, 'palm');
      h.holder(p.actor.root);
      s.props.push(h);
    }).catch(() => {});
  }
}

async function lotaScene(d: Director, ramu: Ramu, s: Sammelan): Promise<boolean> {
  const { kumar } = s, poet = s.poets[0];
  s.quiet.add(kumar).add(poet);
  kumar.face.talking = poet.face.talking = false;
  // each turned in his seat most of the way to the other (the head turns the rest): the poet sits right beside Kumar,
  // ~100 degrees round from the way they face, more than the head alone turns (half a turn and the head put the
  // back of the poet's head to the camera)
  const part = (from: number, to: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * 0.6;
  const toPoet = part(s.facing, kumar.towards(poet.position.x, poet.position.z));
  const toKumar = part(s.facing, poet.towards(kumar.position.x, kumar.position.z));
  let skipped = false;
  await d.scene(async () => {
    // Ramu at the back-stage door, the curtain before him
    ramu.standAt(s.door[0], s.door[1]);
    ramu.faceTowards(s.behind[0], s.behind[1]);
    const side = d.front(ramu, { dist: 0.9, side: -2.0, up: 0.2, drop: 0.25, fov: 50 });   // from his left: the stage's back in view
    d.shot(side, 0, d.pushIn(side, 0.1));
    await d.wait(1.4);
    // through it: the poets at their fruit
    const row = d.front(s.poets[2], { dist: 3.0, side: 1.4, up: 0.2, drop: 0.25, fov: 46 });
    d.shot(row, 0, d.pushIn(row, 0.06));
    await d.wait(2.4);
    // Ramu's stomach answers
    const r = d.front(ramu, { dist: 1.5, side: 0.4, up: 0, drop: 0.2, fov: 36 });
    d.shot(r, 0, d.pushIn(r, 0.03));
    void playSfx('stomach');
    if (!ramu.gesture('hungry', 1, 8)) ramu.gesture('stomach');   // the hand stays on the stomach till the line is said
    await d.wait(0.6);
    await d.say('ramu', ramu.face, 'peek');
    ramu.stopGesture();
    // Kumar: a wince, then to the poet beside him
    const k = d.front(kumar, { dist: 1.5, side: 0.35, up: 0.05, drop: 0.12, fov: 36 });
    d.shot(k, 0, d.pushIn(k, 0.03));
    kumar.face.angry = 1;
    await d.wait(0.5);
    await d.say('kumar', kumar.face, 'ugh');
    const two = d.front(kumar, { dist: 2.3, side: -0.55, up: 0.15, drop: 0.2, fov: 44 });
    d.shot(two, 0.5);
    kumar.turn(toPoet);
    kumar.lookAt(poet);                                         // his head round to the poet as he talks to him, and the poet's to him
    await d.wait(0.5);
    await d.say('kumar', kumar.face, 'toilet');
    poet.turn(toKumar);
    poet.lookAt(kumar);
    await d.wait(0.4);                                          // turned to him first: the shot is from where he looks
    const pf = d.front(poet, { dist: 1.6, side: -0.3, up: 0.05, drop: 0.12, fov: 36 });
    d.shot(pf, 0, d.pushIn(pf, 0.02));
    await d.wait(0.2);
    await d.say('poet', poet.face, 'lota');
    d.shot(k, 0, d.pushIn(k, 0.03));
    await d.say('kumar', kumar.face, 'givelota');
    // the poet bends down for it, under the table's edge, and comes up with it by the neck (pick_up: the hand at it ~1.2 s)
    // (low, from beyond Kumar's chair, along the gap between the sofas and the table)
    const along = v(s.seats[0][0] - s.seats[1][0], 0, s.seats[0][1] - s.seats[1][1]);
    const gap = along.length();
    along.normalize();
    const low = { pos: v(s.lotaAt[0], s.floor + 1.0, s.lotaAt[1]).addScaledVector(along, gap + 1.5), look: v(s.lotaAt[0], s.floor + 0.45, s.lotaAt[1]), fov: 46 };
    d.shot(low, 0);
    poet.lookAt(null);
    poet.turn(s.facing);
    poet.gesture('pick_up', 'lota-up', 2.6);
    await d.wait(1.25);
    holdLota(s, poet);
    await d.wait(1.0);
    // and hands it across: his hand out, Kumar's out to take it, Kumar's hand closes on it (~0.8 s)
    d.shot(two, 0);
    poet.turn(toKumar);
    poet.lookAt(kumar);
    poet.gesture('give', 'lota-give', 1.8);
    await d.wait(0.15);
    kumar.gesture('take', 'lota-take', 1.8);
    await d.wait(0.75);
    holdLota(s, kumar);
    await d.wait(1.0);
    poet.lookAt(null);
    kumar.lookAt(null);
    // he gets up and goes, lota in hand
    standKumar(s);
    await d.tween(0.6, (t) => kumar.place(...lerp(s.seats[0], s.exit[0], t)));
    const wide = d.front(kumar, { dist: 4.2, side: -2.2, up: 0.9, drop: 0.5, fov: 50 });
    d.shot(wide, 0);
    void walk(d, kumar, s.exit.slice(1), 1.25);
    await d.wait(2.4);
    // the chair he left, the plate on the table before it, and behind them, round the edge of the curtain, Ramu lurking
    const chair = { pos: v(s.seats[0][0] + 2.2, s.floor + 1.25, s.seats[0][1] - 0.7), look: v(s.seats[0][0] + 0.4, s.floor + 0.5, s.seats[0][1]), fov: 40 };
    d.shot(chair, 0);
    await d.wait(0.6);
    const [lx, lz] = lurkSpot(s);
    ramu.sitAt(lx, s.floor, lz, Math.atan2(-(s.seats[0][0] - lx), -(s.seats[0][1] - lz)), 'lurk');
    const seat = v(s.seats[0][0], s.floor + 0.6, s.seats[0][1]), him = v(lx, s.floor + 1.1, lz);
    const back = seat.clone().sub(him).setY(0).normalize();
    d.shot({ pos: seat.clone().addScaledVector(back, 1.5).setY(s.floor + 1.05), look: him.clone().lerp(seat, 0.35), fov: 42 }, 0);
    await d.wait(0.5);
    await d.say('ramu', ramu.face, 'chair');
    await d.wait(0.5);
    skipped = d.skipped;
  });
  // watched or skipped: the poet back to the audience, Kumar up and on his way with the lota, Ramu at the door
  if (ramu.posed) ramu.standUp(s.door[0], s.door[1], 0);
  ramu.standAt(s.door[0], s.door[1]);
  ramu.faceTowards(s.behind[0], s.behind[1]);
  poet.lookAt(null);
  kumar.lookAt(null);
  ramu.stopGesture();
  ramu.yaw = ramu.facing;
  poet.turn(s.facing);
  s.quiet.delete(poet);
  kumar.face.angry = 0;
  if (!s.lota.held || kumar.pose) { holdLota(s, kumar); standKumar(s); }
  return skipped;
}

/** where Ramu lurks while the chair stands empty: just through the back-stage door, at the curtain's edge */
function lurkSpot(s: Sammelan): [number, number] {
  return [s.behind[0] + (s.inside[0] - s.behind[0]) * 0.5, s.behind[1] + (s.inside[1] - s.behind[1]) * 0.5];
}

/** the lota in somebody's right hand (it goes in the props put in hands each frame) */
function holdLota(s: Sammelan, p: Person): void {
  s.lota.holder(p.actor.root);
  if (!s.props.includes(s.lota)) s.props.push(s.lota);
}

function standKumar(s: Sammelan): void {
  const k = s.kumar;
  k.idle();
  k.face.angry = 0.5;
  k.position.y = s.floor;
}

/** Kumar's walk off the stage, to its end, and out of sight there (at once if the scene was skipped) */
async function kumarGoes(d: Director, s: Sammelan, skipped: boolean): Promise<void> {
  const k = s.kumar, end = s.exit[s.exit.length - 1];
  if (skipped) { stopWalk(k); k.place(end[0], end[1]); k.position.y = 0; }
  else await (walking.get(k) ?? Promise.resolve());
  if (k.visible === false || walking.has(k)) return;       // (already sent back up by the last quiz)
  k.visible = false;
  k.face.angry = 0;
}

/** people walking a way of several points: done when they are at its end */
const walking = new Map<Person, Promise<void>>();
const ways = new Map<Person, [number, number][]>();
function walk(d: Director, p: Person, pts: [number, number][], speed: number): Promise<void> {
  const left = pts.slice();
  ways.set(p, left);
  const go = (async () => {
    for (let q = left.shift(); q && ways.get(p) === left; q = left.shift()) {
      p.walkTo(q[0], q[1], speed);
      await d.until(() => !p.walking);
    }
  })();
  walking.set(p, go);
  void go.then(() => { if (walking.get(p) === go) walking.delete(p); });
  return go;
}
function stopWalk(p: Person): void { ways.delete(p); p.place(p.position.x, p.position.z); }

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const lerp = (a: [number, number], b: [number, number], t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
