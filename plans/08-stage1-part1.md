# Stage 1, part 1: hungry Ramu, the samosa refusal, the ticket line, the way round

## Context
Stage 1 currently has a plain 4-step route (gate → park road → Nagar Nigam → mela gate; `src/game/objectives.ts`).
The user wrote the story for its first part, with spoken lines, short cutscenes, guidance on the map, and a queue at
the mela gate. This plan replaces the plain route with that story.

The deliverable for now is this plan, saved as **`plans/08-stage1-part1.md`** and committed. Building it is a later
request.

User decisions:
- **Voices:** subtitles first. Each line has an audio slot (`public/audio/voice/stage1/<id>.mp3`) that plays once a
  recording is dropped in. Until then the line's length comes from its text.
- **Cutscenes:** skippable with a Skip button or Enter. Skipping jumps to the end of the scene and the story goes on.

## The story, beat by beat
| # | Beat | What happens in the game |
|---|------|--------------------------|
| 1 | **Start, Chhatrapati chowk** | After the stage intro and Start: a short shot of Ramu. A loud stomach growl plays, his hand goes to his stomach, and he says *"Bhaukal bhookh lagi hai, kuch khane ka jugaad kara jaye."* |
| 2 | **Mission 1: find something to eat** | The objective box says "Find something to eat: the food carts on the road by the mela". The waypoints are the existing route (gate → park road → right at Nagar Nigam) and end at the carts row (Stage1Route.stalls, north of the road by the mela). |
| 3 | **At any cart** (within about 2.5 m of a cart's front) | Cutscene: the camera moves to Ramu's face and he says *"Bhaiya, ek samosa chaat lagao."* The camera cuts to the stall keeper, who says *"Daud jao, tumhara pehle hi bahut udhaar hai."* |
| 4 | **Ramu angry** | Back on Ramu: an angry face and a dismissive gesture, and he turns away. Control returns. |
| 5 | **Mission 2: the mela's main gate** | The objective box says "Go to the mela's main gate". The target appears on the minimap and the big map. |
| 6 | **Map guidance** | The minimap shows the target. When it is off the minimap, an arrow on the rim points to it. Clicking the minimap opens the big map. |
| 7 | **On the big map** | A pin and a label for the target, a dotted path along the corridor road from Ramu to it, and the objective text at the top. |
| 8 | **At the gate** | A line of people is going in, and a mela security guard checks tickets at a rope barrier. The gate is closed to Ramu by the rope. |
| 9 | **Ramu joins the line** | Near the back of the line, the prompt "E — stand in line" appears. Ramu steps into place; control stays locked. |
| 10 | **His turn** (a cut, not a wait) | The queue moves on and Ramu is at the front. Security says *"Ticket??"* |
| 11 | **Pockets** | Ramu says *"Haan laaye the, kahaan rakh diya…"* while patting and checking his pockets. |
| 12 | **Pushed aside** | Security shoves him aside with one hand and says *"Arre bilkul guru, dhoondh lo aaram se, mil jaye toh aa jaana."* Ramu stumbles out of the line. |
| 13 | **Mission 3: another way in** | The objective box says "Find another way into the mela". Hints: "Walk along the mela's cloth wall", then, closer, "The sheet is torn on the west side". The map shows a search area (a circle near the west wall), not the exact spot. Going through the torn sheet (TEAR) ends part 1 and is recorded as the stage's progress. |

Subtitles show in the chosen language:
- **Hindi:** the Devanagari line.
- **English:** an English translation, with the voice still Hindi.

The speaker's name shows above each line.

## Building blocks

### 1. The stage script and director
New: `src/game/story/director.ts` and `src/game/story/stage1.ts`.
- A stage is a list of **beats**:
  - `say(who, lineId)`
  - `anim(who, clip)`
  - `shot(kind, target)`
  - `wait(s)`
  - `objective(textKey, target, waypoints?)`
  - `trigger(test)`: waits until the player does something, such as reaching a cart or pressing E at the queue
  - `control(on/off)`
- **The director** runs the beats in order, holds the current mission, and handles Skip by fast-forwarding a scene's
  beats to its end state: final positions, objective set.
- **Replaces** `Objectives` as the stage driver. Its HUD box (the objective box at the top, with distance) is kept and
  reused, moved into the director's UI.
- **main.ts** creates the director for `play.stage.n === 1`. `game.begin()` starts it after the intro card. A
  mission's completion goes to `account.runBeat`, with `stats.step` added so the admin can see how far a player got.
  This needs a small change to `cleanStats` in `api/me.ts` to allow `step`.

### 2. Dialogue and subtitles
New: `src/ui/subtitles.ts`.
- A bottom-centre box with the speaker's name and the line, letterboxed during cutscenes.
- **Voice:** each line `{ id, who, hi, en, voice? }`. If `public/audio/voice/stage1/<id>.mp3` exists it plays, and its
  length sets the timing. Otherwise the timing is about 0.33 s per word plus 0.8 s.
- **Mouths:** the speaker's `face.talking` is on for the duration of the line. This uses the Face switches already
  built: `src/world/face.ts`, `ramu.face`, `actor.face`.
- **Text:** the lines go in `src/i18n.ts` as `line.s1.<id>`.

### 3. Cutscene camera
Changes in `src/player/ramu.ts`, plus a new `src/game/story/camera.ts`.
- **A `cinematic` flag on Ramu:** input off, and the orbit camera (`ramu.ts:336`) stops driving `camera`.
- **The director's camera** blends to shots:
  - a **face close-up**: from the head bone's world position, 0.9 m in front, slightly to the side, FOV 35;
  - **over the shoulder** onto the other speaker;
  - a **two-shot**.
- It eases back to the orbit camera when control returns.
- The letterbox bars and the Skip button are part of `subtitles.ts`.

### 4. Animations
- **Clips to add** from Mixamo (free; FBX "without skin") into `assets/anims/`. `build_ramu_rig.py` already bakes every
  clip there onto all six rigs (`import_mixamo_clips`, line 401).
  - **Ramu:**
    - "Talking": a standing talk
    - "Angry Gesture"
    - "Searching Pockets"
    - "Stumble backwards" (or reuse the existing `shove` reaction)
    - a hand-on-stomach hunger pose ("Rubbing Arm" / "Hungry" style)
  - **Security:** "Push", a one-hand shove forward, and an idle "Checking"/"Talking".
  - **Stall keeper:** "Talking" and "Dismissing Gesture".
- **If a hunger clip can't be found:** a procedural layered pose (right arm to the belly), built the way the rig script
  already builds procedural poses (`build_ramu_rig.py` ~233–274).
- **Fit the clips into the game:**
  - Add them to `ONCE` in `src/world/actors.ts:44` where they play once.
  - Ramu gets `ramu.gesture(name)`, a one-shot over idle using his existing `play()` (`ramu.ts:574`).

### 5. Faces: anger
- **The rig script:** a third shape key, `angry`, in `tools/blender/build_ramu_rig.py`, built from the same `FACE`
  landmarks per character: brows down and in, eyelids slightly narrowed, mouth corners pressed down.
- **`Face` gains** `angry` (0..1, eased).
- **The shader:** `faceMaterial` keeps reading morph index 0 (`mouth_open`), so `angry` is added after `blink`.
- Rebuild the six rigs and check with `scripts/faceshot.mjs`.

### 6. Stomach growl
- WebAudio, in the style of `src/game/audio.ts`: low-pass noise plus a wobbling low sine, rising and falling for about
  1.5 s.
- It has a file slot too (`public/audio/sfx/stomach.mp3`).

### 7. The road carts and their keepers
- `Stage1Route.stalls` (`src/world/stage1Route.ts:241`) already places about 10 carts on the mela side of the road.
- **Add a keeper behind each cart:** a rigged `Actor` (the uncle rig, varied looks), idle and blinking. The trigger
  zone is in front of each cart.
- **The keeper at the chosen cart** turns to Ramu and speaks.
- **Afterwards**, the other carts' keepers ignore him. Talking to them again gives a short refusal subtitle with no
  cutscene: "Pehle udhaar chukao!"

### 8. Map guidance
**The minimap** (`src/ui/hud.ts`):
- `setTarget(x, z, label)` draws a pulsing pin.
- When the pin is outside the minimap, an arrow on the rim points to it.
- A click on `#minimap` opens the big map via a new `menu.openMap()`.

**The big map** (`src/ui/menu.ts`, `drawMap`):
- The target pin and its label.
- A dotted route from Ramu along the corridor's road (`routeLine`, `stage1Route.ts:96`) to the target.
- The objective text along the top.
- For mission 3, a search circle instead of a pin.

**Optional:** a soft light column in the world at the target, for missions 1 and 2 only.

### 9. The queue at the mela gate
New: `src/world/gateQueue.ts`.
- **A rope barrier and a guard:** brass posts with a red rope across the gate's opening, plus a small ticket table. A
  security `Actor` (the `security` rig) stands at the gate. The rope's collision goes in via `world.addPost` / `addWall`
  (pattern in `main.ts:127`) and keeps Ramu out while the stage is on.
- **The line:**
  - 8 rigged people (uncle, aunty, boy, girl) stand along the footpath in front of the gate, about 0.9 m apart.
  - Every 4–6 s the front person "shows a ticket" (a short talk clip) and walks in through the gap beside the rope.
  - The rest step forward with the walk clip, short moves.
  - Whoever walks in is recycled to the back from outside Ramu's view, so the line never runs out or jams.
- **Ramu joining:**
  - At the back of the line, "E — stand in line" appears, using the existing use key and tip (`drive.ts` tip
    element).
  - The cut to the front repositions the line with Ramu first.
- **After the shove:**
  - Ramu is placed 2 m to the side.
  - The rope stays, and the guard turns back to the line.
  - Coming back gives a short subtitle from the guard: "Ticket mila? Nahi? Toh side ho jao."

### 10. Mission 3 and the end of part 1
- The torn sheet already exists at `TEAR` (`src/world/melaSite.ts:67`, on the west wall), reached by the alley past the
  building west of the mela.
- **Hints:**
  - By distance: the general area, then "the west side" when within about 60 m.
  - After 90 s without progress, the search circle shrinks.
- **The end:** passing through the tear (`inMela` on the west side) finishes part 1. It shows a toast and records the
  progress. Part 2 continues inside later.

### 11. Free roam stays as it is
- None of this runs without a stage.
- The rope and the queue exist only while stage 1 is played; roaming free, the gate is open as now.

## Critical files
- **New:**
  - `src/game/story/director.ts`, `src/game/story/stage1.ts`, `src/game/story/camera.ts`
  - `src/ui/subtitles.ts`
  - `src/world/gateQueue.ts`
- **Changed:**
  - `src/main.ts`: director in place of `Objectives`; cart keepers; queue
  - `src/player/ramu.ts`: `cinematic`, `gesture()`, head position
  - `src/world/actors.ts`: new clips in `ONCE`
  - `src/world/face.ts`: `angry`
  - `src/ui/hud.ts`: target, rim arrow, click opens the map
  - `src/ui/menu.ts`: `openMap()`, target, route, objective
  - `src/world/stage1Route.ts`: keepers' spots
  - `src/game/audio.ts`: the growl
  - `src/i18n.ts`: lines, objectives, hints
  - `api/me.ts`: `step` in stats
  - `tools/blender/build_ramu_rig.py`: the `angry` key and the new clips
  - the six `public/models/*_rig.glb`
- **Assets from the user / Mixamo:** the clips listed in 4. The voice recordings later.

## Build order (a commit after each)
1. Director, subtitles, cutscene camera and Skip, with beat 1 (growl, line, hand on stomach using a fallback pose).
2. Map guidance: minimap target and arrow, click to open, big-map pin, route and objective.
3. Cart keepers and the samosa scene (beats 2–4), with the `angry` face key and the rig rebuild.
4. The gate queue, rope and guard, joining the line, and the ticket scene (beats 5–12).
5. Mission 3, the hints, the end of part 1, and progress recorded for the admin.
6. Swap in the Mixamo clips once downloaded, and tune the timing.

## Verification
- `npx tsc --noEmit` and `npm run build`.
- **`scripts/stage1part1.mjs`** (`?debug&stage=1`, which already starts the stage without a login):
  - Teleport Ramu through each trigger.
  - Screenshot every shot: growl close-up, cart face shot, keeper shot, angry turn, queue, "Ticket??", pockets, shove,
    and the mission 3 map.
  - Assert the objective text after each beat, and that Skip lands in the same state as watching.
- **Queue soak:** 3 minutes; the line keeps moving, nobody overlaps or freezes, and Ramu can't pass the rope.
- **Maps:**
  - The minimap arrow points the right way from 4 positions.
  - Clicking the minimap opens the map, which shows the pin and the route.
- **Both languages:** subtitles in Hindi and English.
- **Voice:** a dummy `.mp3` in one slot plays and sets that line's timing.
- **Performance:** FPS at the gate with the queue is within about 2 of now.
- **Free roam** (no stage) is unchanged: the gate is open, with no rope or queue.
