import * as THREE from 'three';
import type { Ramu } from '../../player/ramu';
import { foodMesh, type FoodName } from '../../world/foods';
import { HandProp } from '../../world/handProp';
import type { Sammelan } from '../../world/mela';
import type { Person } from '../../world/person';
import type { Director } from './director';
import type { StoryHooks } from './stage1';
import { playSfx } from './sfx';

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

export async function stage1Part2(d: Director, ramu: Ramu, mela: Promise<Sammelan>, hooks: StoryHooks): Promise<void> {
  const s = await mela;

  // ---- mission 4: behind the stage ----
  const [dx, dz] = s.door;
  await d.mission(4, 'm.s1.stage', [{ at: s.door, hint: 'm.s1.stage.h1', done: (x, z) => Math.hypot(x - dx, z - dz) < DOOR_R }]);
  hooks.step(4);

  // ---- beats 1-2: the poets eat; Kumar's stomach; the lota; Kumar goes ----
  eating(s);
  const skipped = await lotaScene(d, ramu, s);
  void kumarGoes(d, s, skipped);
  hooks.done('story.s1.part1');
}

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
  const toPoet = s.facing + 0.5, toKumar = s.facing - 0.5;      // the poet sits on Kumar's left, to the north
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
    ramu.gesture('stomach');
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
    await d.wait(0.5);
    await d.say('kumar', kumar.face, 'toilet');
    poet.turn(toKumar);
    await d.wait(0.4);                                          // turned to him first: the shot is from where he looks
    const pf = d.front(poet, { dist: 1.6, side: -0.3, up: 0.05, drop: 0.12, fov: 36 });
    d.shot(pf, 0, d.pushIn(pf, 0.02));
    await d.wait(0.2);
    await d.say('poet', poet.face, 'lota');
    d.shot(k, 0, d.pushIn(k, 0.03));
    await d.say('kumar', kumar.face, 'givelota');
    // the poet hands it over
    d.shot(two, 0);
    holdLota(s, poet);
    await d.wait(0.8);
    holdLota(s, kumar);
    await d.wait(0.6);
    // he gets up and goes, lota in hand
    standKumar(s);
    await d.tween(0.6, (t) => kumar.place(...lerp(s.seats[0], s.exit[0], t)));
    const wide = d.front(kumar, { dist: 4.2, side: -2.2, up: 0.9, drop: 0.5, fov: 50 });
    d.shot(wide, 0);
    void walk(d, kumar, s.exit.slice(1), 1.25);
    await d.wait(2.4);
    // the chair he left, and the plate on the table before it
    const chair = { pos: v(s.seats[0][0] + 2.2, s.floor + 1.25, s.seats[0][1] - 0.7), look: v(s.seats[0][0] + 0.4, s.floor + 0.5, s.seats[0][1]), fov: 40 };
    d.shot(chair, 0);
    await d.wait(0.6);
    await d.say('ramu', ramu.face, 'chair');
    await d.wait(0.3);
    skipped = d.skipped;
  });
  // watched or skipped: the poet back to the audience, Kumar up and on his way with the lota, Ramu at the door
  ramu.stopGesture();
  ramu.yaw = ramu.facing;
  poet.turn(s.facing);
  s.quiet.delete(poet);
  kumar.face.angry = 0;
  if (!s.lota.held || kumar.pose) { holdLota(s, kumar); standKumar(s); }
  return skipped;
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
  else await walking.get(k);
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
  return go;
}
function stopWalk(p: Person): void { ways.delete(p); p.place(p.position.x, p.position.z); }

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const lerp = (a: [number, number], b: [number, number], t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
