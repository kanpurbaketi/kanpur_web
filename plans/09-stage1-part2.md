# Stage 1, part 2: the stage, the stolen seat and the poetry quiz

## Context
Part 1 is built and committed. Its story runs from the chowk, past the carts and the ticket line, to the torn sheet on the
mela's west wall; going through the sheet ends the stage (`hooks.done('story.s1.part1')` in `src/game/story/stage1.ts`).
The user has written part 2, which happens inside the mela at the kavi sammelan:
- Kumar Andhvishwas leaves the stage with a lota, and Ramu takes his seat and eats.
- The anchor calls "Kumar Andhvishwas" to the mic, and Ramu goes up in his place.
- Three rhyme quizzes, with the audience cheering or throwing food and shoes.
- The real Kumar comes back, and the guards come running.

Part 3, the escape, comes from the user later, so part 2 ends the moment the chase begins.

The stage already has most of the cast:
- Kumar in the left armchair.
- The anchor with the hand mic.
- Buddha and seven poets, the laid table, and the audience on the dari.

**The first deliverable is this plan**, saved as `plans/09-stage1-part2.md` and committed. Building it is a later request.

User decisions:
- **The words:** I draft the shayaris and the quiz in Hindi (Devanagari) with English versions, in `src/i18n.ts`, so the user can edit them.
- **A right answer** brings applause and "wah wah". A wrong one brings food flying onto the stage.
- **The chase:** its rules (what counts as escaping, what being caught does) come with part 3. Here it only starts.

## The script, beat by beat
| # | Beat | In the game |
|---|------|-------------|
| 0 | **Inside, through the tear** | Part 1's end no longer ends the stage; the story goes on. **Mission 4:** "Get behind the stage". The back-stage door (`STAGE_ENTRY`, next to the tear) is on the maps. |
| 1 | **Behind the stage** (within about 3 m of the back-stage door) | **Cutscene:** through the curtain, the poets eat fruit (a new eating clip, a fruit in the hand). Ramu watches, and his stomach growls (`playSfx('stomach')`). Kumar winces and puts his hand to his stomach (the `stomach` clip). He turns to the poet beside him: *"Are guru, yahan shauchalaya ka intezaam hai ka?"* The poet: *"Yahan kahan, hum toh apna lota lekar chalte hain."* Kumar: *"Laao, lota laao."* The poet hands over a brass lota from beside his chair. |
| 2 | **Kumar leaves** | Kumar gets up, takes the lota (held in his hand), and walks along the back of the stage and down the far stairs. Off camera he is hidden until beat 7. |
| 3 | **Ramu takes the seat** | **Mission 5:** "Take the empty seat". He climbs onto the stage by the back door. At the empty armchair, "E — sit down" makes him sit, play the eating clip and take fruit from Kumar's plate. A little later the next scene starts on its own. |
| 4 | **The anchor** | **Cutscene:** the anchor recites 2–3 short shayaris about Kanpur (lines with subtitles and voice slots). Then: *"Ab hamare beech aa rahe hain, ubharte kavi, Kumar Andhvishwas!"* Applause. The poets look at the empty seat, then at Ramu. |
| 5 | **Ramu takes the mic** | Ramu gets up and walks to the mic. The anchor hands it over, and it moves from the anchor's fist to Ramu's. The anchor steps aside, and Ramu plays the `recite` clip. |
| 6 | **Quizzes 1 and 2** | An on-screen quiz (below). Ramu "recites" the first line (subtitle and voice slot). The player picks one of four second lines. **Right:** Ramu says the couplet, the audience applauds, "wah wah!", and the anchor nods. **Wrong:** Ramu says the bad couplet, the audience boos, and some get up and throw fruit, cups and packets onto the stage; some hit him, and he flinches. Either way, on to the next quiz. |
| 7 | **Quiz 3, rigged** | Same quiz, but whatever is picked is "wrong". Boos, and shoes and chappals among the food. In the middle of it the real Kumar comes back up the stairs with the lota: *"Abey guru, tum kaun ho be?"* |
| 8 | **Found out** | Everyone gets up (poets from their chairs, the audience from the dari). The anchor points at Ramu (`angry_point`): *"Dhokebaaz hai ye launda, pakdo!"* |
| 9 | **The guards** | Four security guards come running from the sammelan's gates toward the stage. |
| 10 | **Run** | **Mission 6:** "Run!". Control goes back to Ramu. Part 2 is recorded (`hooks.step(6)`) and part 3 takes over from here (until then the guards just chase, as mela guards already do). |

Every cutscene can be skipped like part 1's, landing in the same end state.

## Building blocks

### 1. Story script
- **`src/game/story/stage1.ts`:** replace `hooks.done('story.s1.part1')` with `hooks.step(3)` and `await stage1Part2(...)`.
- **New `src/game/story/stage1b.ts`:** the beats above, written in part 1's style.
  - Uses the existing tools: `d.scene`, `d.say`, `d.shot`, `d.front`, `d.tween`, `d.mission`, `d.prompt`.
  - `Who` in `director.ts` gains `'kumar' | 'poet' | 'anchor' | 'audience'`.
  - All the lines go in `src/i18n.ts` as `line.s1.<id>`, Hindi and English, with voice slots at `public/audio/voice/stage1/<id>.mp3`.
- **Test starts:** `?debug&stage=1&part=2` starts the story at beat 0, with Ramu just inside the tear. `&beat=6` jumps to the quiz.
- **For players:** no saved checkpoint for now (it fits better once part 3 sets the stage's end). A player who finishes part 1 goes straight on.

### 2. The stage's people as story characters
- **`Mela` exposes the sammelan's cast** as `Person`s (`src/world/person.ts`: facing, gestures, `walkTo`, `place`): `kumar`, `anchor`, `poets[]`, plus the seats, the mic and the stage floor height (`FLOOR`).
  - `Person` today walks at ground height. It gains a floor height so people can walk on the stage, with the stairs as a ramp.
- **A prop held in a hand:** `holdMic()` in `mela.ts` becomes a general `HandProp(actor, object, gripOffset, aimAt?)`. It's used for the mic (anchor → Ramu), the lota (poet → Kumar) and fruit (eating). Ramu's hand and head bones come from his rig the same way.
- **`Ramu.sitAt(x, y, z, facing, clip)` / `Ramu.standUp()`:** a story pose. Ramu is placed, held still and plays a sitting clip (like `standAt` and `gesture`).

### 3. Animations (rig script `tools/blender/build_ramu_rig.py`)
- **Rebuild Ramu's rig:** it predates the sitting clips and `recite`, so it gains `sitting_talking`, `recite` and the new clips below.
- **New clips made in the script** (IK, like `recite`):
  - `sit_eat`: the chair-sitting pose (from `sitting_talking`'s first frame), the right hand from the plate to the mouth and back, with chewing pauses.
  - `stand_eat`, if needed for the poets behind the table.
- **Clips from Mixamo** (FBX, without skin, into `assets/anims/`; the script already bakes everything in that folder):
  - "Throw Object" is already there but in `UNUSED`. Take it out and name it `throw` (an underhand toss).
  - **Asked of the user:**
    - "Sitting To Standing" (from a chair)
    - "Stand Up" (from sitting on the floor)
    - "Sitting Disapproval" / "Booing" if available
    - "Pointing"
  - **Fallbacks if they don't come:** a crossfade from sitting to standing with the hips eased up over 0.6 s, and `angry_point` for pointing.
- **Add to `ONCE`** in `src/world/actors.ts`: `throw` and the stand-ups.

### 4. Props
- **New `src/world/storyProps.ts`:**
  - A **brass lota**: a lathe body and neck, a gold metal material.
  - A **chappal** and a **shoe**: low, simple, procedural shapes.
- **Food** that gets thrown comes from `models/foods.glb` (`foods.ts` gains a single-mesh `foodMesh(name)` alongside the instanced `addFoods`).

### 5. The quiz overlay
**New `src/ui/rhyme.ts`:**
- A panel above the subtitles: the first line in large type and four numbered choices (buttons; keys 1–4; touch).
- A 20 s ring timer, where no answer counts as wrong.
- In the chosen language (Hindi or English).
- `ask(q): Promise<{ picked: number; right: boolean }>`.
- Quiz 3 passes `rigged: true`: every pick comes back wrong. The pick still flashes, then turns red.
- Styled like the mission box; it works at phone width.

**Content** (drafted by me, in `src/i18n.ts` under `quiz.s1.<n>`):
- Three couplets, each with the first line, the right second line and three that don't rhyme (comically wrong ones included).
- 2–3 anchor shayaris about Kanpur (the Ganga, the leather, "Kanpur ka thug life", the chai).
- Each in Hindi and English, editable.

### 6. The audience reacting
**New `src/world/throwers.ts`, driven by the story:**
- **Applause:** `mela.audience` actors switch to a clapping clip for a few seconds. The chair clip `sitting_clap` sits too high for people on the floor, so the front rows use `floor_idle` with hands raised, unless the user's floor clip arrives. Plus sound.
- **Booing and throwing:**
  - 6–10 audience members nearest the stage stand up and play `throw`.
  - Each releases an item at the clip's release frame.
  - Each item flies on a ballistic arc to a point within 2.5 m of Ramu (a few aimed straight at him), spinning.
  - It bounces once on the stage floor and stays there.
  - A hit on Ramu plays `hit2` (a flinch, no damage).
  - Food in quizzes 1–2; food plus chappals and shoes in quiz 3.
  - Items pooled (at most 80), cleared when part 2 ends.
- **Everyone up:** all the audience and poets stand (clip or fallback) and turn toward Ramu.

### 7. Sounds
`src/game/story/sfx.ts` gains `applause`, `wahwah`, `boo`, `thud` and `gasp`. Each plays a recording if one is dropped in `public/audio/sfx/`, otherwise a WebAudio stand-in, as `stomach` does:
- **applause:** filtered noise in bursts;
- **boo:** a low formant drone;
- **thud:** a short low knock.

### 8. The guards
`Pedestrians` (`src/world/pedestrians.ts`) gains `spawnHunters(n, at: [x, z][])`:
- Four `security` actors placed at the sammelan's gates (`SAMMELAN_GATES`).
- They are hostile with a long `grudge`, so they run at Ramu from anywhere, through the existing chase-and-fight code.
- Part 3 will decide what catching him means. Until then the current behaviour holds: they fight, and health can knock him out.

### 9. The missions on the maps
- Mission 4 points at the back-stage door. Mission 5 points at the empty chair.
- Mission 6 has no target yet: it shows "Run!" with no distance. `MissionBox` gains a target-less mode.

## Critical files
- **New:**
  - `src/game/story/stage1b.ts`
  - `src/ui/rhyme.ts`
  - `src/world/throwers.ts`
  - `src/world/storyProps.ts`
  - `plans/09-stage1-part2.md`
- **Changed:**
  - `src/game/story/stage1.ts`: on into part 2
  - `src/game/story/director.ts`: speakers, mission without a target
  - `src/game/story/sfx.ts`
  - `src/world/mela.ts`: cast as `Person`s, `HandProp`, the chair for Ramu, stand-ups
  - `src/world/person.ts`: a floor height
  - `src/player/ramu.ts`: `sitAt`/`standUp`, his hand for props
  - `src/world/pedestrians.ts`: `spawnHunters`
  - `src/world/foods.ts`: one-item mesh
  - `src/world/actors.ts`: `ONCE`
  - `src/i18n.ts`: lines, quiz, missions
  - `src/main.ts`: `part=` and `beat=` test starts, passing the mela to the story
  - `tools/blender/build_ramu_rig.py`: `throw` back in, `sit_eat`, the stand-ups
  - the rigs in `public/models` (Ramu's and all the others)

## Build order (a commit after each)
1. Plan saved as `plans/09-stage1-part2.md`.
2. Clips: rebuild every rig with `sit_eat` and `throw` (plus the user's Mixamo clips if they've arrived). Ramu's rig rebuilt.
3. `HandProp`, the lota, and `Person` on the stage. Beats 0–2 (behind the stage, the lota, Kumar walks off). The `part=2` test start.
4. `Ramu.sitAt`; mission 5; Ramu eats in Kumar's chair (beat 3).
5. The anchor's shayaris and the mic handover (beats 4–5).
6. The quiz overlay and its content; applause, booing and throwing, and the sounds (beat 6).
7. Quiz 3 rigged, Kumar's return, everyone up, the anchor's "pakdo", the four guards, mission 6 (beats 7–10).
8. Tuning: shot framing, timings, both languages.

## Verification
- `npx tsc --noEmit` and `npm run build` pass.
- **`scripts/stage1part2.mjs`** (Playwright, `?debug&stage=1&part=2`):
  - Walk Ramu to the back-stage door. Screenshot each cutscene shot: the eating poets, Kumar's wince, the lota, Kumar walking off, Ramu eating, the anchor, the handover.
  - Answer the quiz by key, right then wrong, and check the audience's reaction (clips playing, items in the air, then lying on the stage).
  - Quiz 3 rigged: any answer counts as wrong.
  - Kumar back, everyone standing, four guards running toward Ramu.
  - Skip each cutscene and check it lands in the same state as watching it.
- **Quiz overlay:** at desktop size and at phone width (390 px); keys 1–4 and tapping; the timer running out counts as wrong.
- **Both languages:** every line, the quiz and the missions in Hindi and in English.
- **Frame rate** on the stage during the throwing stays within about 2 fps of now (23–25).
- **Part 1 still plays through unchanged** up to the tear.
- **Assets I'll ask the user for:** "Sitting To Standing" and "Stand Up" from Mixamo, and optionally booing and cheering clips. Until they arrive, the fallbacks in 3 are used.
