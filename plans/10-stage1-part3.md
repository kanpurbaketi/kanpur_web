# Stage 1, part 3: the escape

Part 2 ends with the real Kumar back, the anchor's "pakdo!" and four guards coming. Part 3 is the chase across the mela,
as the user drew it (points A–I on their sketch of the mela map), ending with the leap from the maut ka kuan.

## The route (world metres; the sketch's points moved onto open ground in the built mela)
| Pt | Where | World (x, z) |
|----|-------|--------------|
| A | out of the sammelan's east gate, between its fence and the first stall | (-178.6, 278.5) |
| B | down the lane to the south-west aisle | (-175.3, 298.3) |
| C | east along the aisle, between the stall rows | (-156.6, 298.3) |
| D | north up the main aisle | (-149.0, 283.7) |
| E | south of the giant wheel | (-149.0, 273.2) |
| F | the inflatable's ramp (he comes out of it here) | (-124.9, 264.1) |
| G | north-east, between the inflatable and the chair swing | (-113.5, 262.0) |
| H | south between the stall columns | (-108.7, 281.2) |
| I | the maut ka kuan's round stair (foot at its north-west), up to the gallery | foot (-123, 289.5) |

## Beats
1. **Caught** (a cutscene, straight on from part 2): the guards reach him at the front of the stage, two hold him, one
   punches (he flinches), Ramu bites a hand / shoves one over (`push_one`, the guard `fall`s) and is off.
2. **Mission 7, "Bhaago!"**: A → B → C. The guards run after him along the way he went (his trail), never through walls.
   They are a little slower than his run, faster than his walk: stop, and they catch up. **Caught**: a short beating,
   a fade, and the leg starts again from its first point, the guards a few metres behind.
3. **At C, the rock**: one guard picks up a rock and throws it; it hits Ramu in the back and he flies into two customers
   at the stall ahead; all three go down. The customers get up angry ("Andha hai ka?"), Ramu scrambles up.
4. **Mission 8**: C → D → E, the guards still behind.
5. **At E, the wheel**: he runs at the giant wheel, jumps, and grabs the floor of a cabin coming up; it lifts him off
   the ground, the guards jump for his feet and miss.
6. **Hold on**: the wheel carries him up. Four times his grip slips (his hands slide): press **Space** (or tap
   **Pakdo!**) before the ring runs out to grab the next bar. Miss one: he drops, the mission fails, and he starts
   again from D with the guards behind.
7. **The lever**: after four grabs a guard shouts at the operator: "Rok! Pahiya rok!". The operator pulls the lever,
   the wheel stops dead, and Ramu is flung off in an arc into the inflatable, bouncing among the children.
8. **Mission 9**: out of the inflatable (F) → G → H → up the maut ka kuan's stair to the gallery (I). Guards behind.
9. **The gallery**: he squeezes in among the people at the rail and crouches. The guards come up, look round, and pass
   him by. A small girl beside him holds out her buddhi ke baal (candy floss): slow motion, a warm close moment
   ("Bhaiya, khaoge?"). He takes it.
10. **"Woh raha!"**: a guard sees him. Ramu jumps up onto the rail, and leaps off the outside, slow motion all the way
    down, candy floss in hand; he lands in the dirt, groans, still holding it. **Stage 1 complete.**

## Building blocks
- **`src/world/chase.ts`**: the story's guards as `Person`s. Each follows Ramu's trail (crumbs every 0.6 m, with his
  height, so they climb the well's stair) with a rubber band (catch up when far, a little slower than his run near);
  `onCatch` when one reaches him. `hold()` stops them for cutscenes; `placeBehind()` puts them back on the trail.
  Part 2's guards become these (they come round the dari from the gates as now).
- **`Person`**: a driven mode (the chase sets position and pace; the clip follows).
- **`Mela`**: the giant wheel's controls (its cabins' positions, its speed, stop), the wheel operator's lever pull,
  and the floor under a point (stage, rides) for the guards.
- **`src/ui/grip.ts`**: the grip prompt (a ring, Space or a tap, works at phone width).
- **Slow motion**: `Director.timeScale` scales the world's time (the loop's dt) for the girl and the leap.
- **Props** (`storyProps.ts`): a rock, candy floss on a stick.
- **Clips (Ramu only)**: the user's Mixamo hanging clips (Hanging Idle, Stand To Freehang, Braced To Free Hang, Braced Hang
  Drop) as `hang_idle`, `hang_start`, `hang_braced`, `hang_drop`, and Falling as `falling` (a body in the air).
- **Stage end**: part 2 no longer marks the stage done (it shows its toast only); part 3's end does. `STAGE1_STEPS` = 10
  (missions 7–9 and the end).
- **Test start**: `?debug&stage=1&part=3` starts at beat 1 by the stage; `&leg=wheel|kuan` at E or at F.

## Verification
- Type-check and build; Playwright runs of each leg (caught and restarted, the rock, the wheel with all four grabs and
  with a miss, the inflatable, the gallery and the leap) in English and Hindi, at phone width for the grip prompt.
- Skipping each cutscene lands in the same state as watching it.
