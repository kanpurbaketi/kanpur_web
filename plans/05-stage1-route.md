# 05 — Stage 1: from the Shivaji Putla gate to the mela

## Context
The real game starts at the **Shivaji Putla gate**. From there Ramu has to make his way to the mela, as in the user's
reference video ("kanpur expo Moti jheel | numaish kanpur").

The route:
- the gate beside the Moti Jheel metro
- straight down the park road, with parks on both sides
- **Kanpur Nagar Nigam** straight ahead
- turn **right**
- go straight, and the **mela is on the right**

The user's decisions:
- The parks and the Nagar Nigam are mapped but **not accessible**.
- The mela is **unchanged** (cloth walls, layout and size); it is only moved to the real numaish ground. It gets fixed
  later.
- Ramu moves only inside this **limited corridor**. Nothing beyond the route needs mapping detail; the rest of the
  city stays as it is, as backdrop.
- Fencing: **real walls and barricades**.
- Traffic: **parked vehicles plus slow traffic**. Ramu can take a vehicle and ride it inside the corridor.
- A menu setting to start **at the Shivaji gate (default)** or **inside the mela**.

Map facts (public/data/moti_jheel/map.json; x east, z south, metro at about the origin):
- **Main road:** z ≈ 0.
- **Small loop at its south side:** (−19,2)→(−25,45)→(−30,51)→(−32,44)→(−31,1). The Shivaji gate goes at about
  (−30, 55).
- **Park road (one OSM way, service, w 4):**
  - It runs (−30,51) → (−39,221) → (−43,336), with Tulsi Upvan on the left (x −21..122) and Japani Garden on the right
    (x −193..−41, south edge (−198,198)→(−147,218)→(−129,241)→(−104,259)→(−51,265)).
  - It then bends **west**, (−45,342) → (−141,336) → (−231,329) → (−297,326).
- **Nagar Nigam:** straight ahead at the bend.
  - A lane (−45,342)→(−45,388) leads into a compound whose main building is at about (−70,415), 166 × 39 m.
  - The service loop around x −237..−5, z 341..471 is its campus.
- **Side roads off the corridor**, to close:
  - (−36,342)→(−6,349) heading east
  - (−141,336)→(−142,385) heading south
  - (−231,329)→(−237,434)
  - the road on to (−297,326)
- **New mela ground:** north of the westward stretch, between Japani Garden and the road. Buildings to watch:
  - (−238,256), 34 × 76: stays, west of the mela
  - (−106,292), 15 × 30: cleared by `inMela`; the user OK'd this

## Step 0: Plan doc, then commit
- Rewrite the uncommitted `plans/05-mela-from-video.md` as `plans/05-stage1-route.md`, covering this route work.
- Keep the video findings about the mela's look as a short "later" section; the user will fix the mela afterwards.
- Commit only; no push.

## Phase 1: Move the mela (translation only)
The mela's gate is in its south wall, and the new ground has the road to its south. So **no rotation**: only a shift
of about (DX, DZ) ≈ (−210, +118). That puts the wall at about x −219..−100, z 245..322.
- `src/world/melaSite.ts`:
  - Add `DX`/`DZ` and fold them into `mx`/`mz`.
  - Express the hardcoded world numbers through them: `MELA` (:16), `TEAR.x` (:53), `GATE.z` (:55), `WALL_LOOP`
    (:58), `KUAN` (:70).
- `src/world/mela.ts`: the remaining hardcoded world numbers get the same shift:
  - far-cull centre (50,165) (:456)
  - packed aisle from the gate (:470)
  - floodlight masts (:737)
  - aisle grid bounds and origin (:881, :884-888), derived from `MELA`
- Nothing else in the mela changes.
- Fit the exact DX/DZ to:
  - **The road:** the south wall and gate stand at least 5 m from the widened road's north kerb, with room for the
    gate's bike parking (`buildParking`, z = GATE.z + 1.9).
  - **The building at (−238,256):** at least 6 m clear of the west wall, so the torn place in the cloth stays reachable
    from outside.
  - **Japani Garden:** where it overlaps the mela's north-east corner, its edge (and wall) is re-routed around the
    mela.
- Outside consumers are correct automatically through `inMela`: buildings and trees cleared, roads clipped (main.ts:54),
  traffic links dropped (props.ts:401), vendors.
- The old Tulsi Upvan site goes back to being park, with trees, because inMela no longer covers it.

## Phase 2: The route, walls and barricades (new `src/world/stage1Route.ts`)
Built when `map.area === 'moti_jheel'`. Look and feel come from the video frames: frame 3 (gate), frames 8–14 (road),
frame 16 (approach).

**Road**
- A `prepareRoute(map)` step runs in main.ts next to `clipRoadsToMela`. It widens the corridor way (park road plus
  the westward stretch up to the barricade) from w 4 to 8 m, two-way, with a sidewalk on both sides.
- City and streetDetail then draw it with a centre line, kerbs, footpaths and lamp posts like other roads.
- Check how `cls: 'service'` renders. If it gets no footpaths or lamps, switch the corridor's class to `residential`.

**Shivaji Putla gate** at about (−30,55), spanning the park road
- Stone piers with a lintel and a small railing.
- On one side, the statue on a tall red-and-white pillar with a saffron flag. The statue is a generic procedural rider
  on a horse in bronze (`Geo` helpers, geo.ts:20).
- The piers become collision posts.

**Park walls** (not accessible) on both sides of the park road
- A pink / brick-red plinth, brick pillars every 3 m, and a black iron grille on top, 2.2 m in all.
- Painted Hindi slogans as canvas text: "स्वच्छ रहें, स्वस्थ रहें", "कानपुर ये है मेरा…".
- Trees behind.
- They follow Japani Garden's east edge and Tulsi Upvan's west edge, then Japani Garden's south edge along the
  westward stretch, as far as the mela.
- **Fix `parkEdge`** (landmarks/index.ts:48-66). Today its gate gap drops a whole polygon side, which is why Tulsi
  Upvan's west side has no wall, and it registers no collision.
- Corridor walls are built by the new module with real collision (`landmarks.walls` → `world.addWall`,
  main.ts:127). `parkEdge` skips those edges and keeps drawing the other park edges as now.

**Kanpur Nagar Nigam** (mapped, not accessible)
- The map building at about (−70,415) gets a municipal look: a cream and terracotta façade, a parapet, a portico, and
  the name board "कानपुर नगर निगम / Kanpur Nagar Nigam", lit at night.
- A compound wall runs along the south kerb of the westward stretch, from the bend to the barricade.
- **Closed gates** (iron gates with a guard hut) close the lane straight ahead (−45,342→388) and the side lane
  (−141,336→385).
- The video doesn't show this building. I'll build a reasonable version and ask the user for a photo to match later.

**Barricades** (visible limits)
- Yellow-and-black police barricades (steel frames with a "STOP / रुकें" board):
  - **behind the start**, across the loop's mouth onto the main road
  - across the east road at the bend (−36,342→)
  - across the westward road **just past the mela's west side**, before (−231,329)
- Behind every visible wall and barricade there is a **backing play-area polygon** (one thin `addWall` ring around the
  corridor), so nothing leaks through a gap or a corner.
- That ring is also the vehicles' limit, since vehicleSim uses `CollisionWorld.resolve`.

**Street life**
- **Parked cars and bikes** along both kerbs, with gaps.
  - Static clones via `loadPBR` + `cloneCar` (vehicleModels.ts:27,125) with posts, as in `buildParking` (mela.ts:692).
  - Kerb offsets as in props.ts:1053-1065.
- **Slow traffic:**
  - The corridor roads form their own traffic sub-graph, cut from the main graph at the barricades (props.ts:392-404,
    with the barricade points as cuts).
  - 4–6 AI vehicles (bikes, autos, a car or two) at a lower vmax (about 6–8 m/s).
  - At a dead end a vehicle turns round, or is recycled to the other end out of Ramu's view, using the existing
    recycle path.
  - Ramu can take any of them, or a parked bike, with E.
- **Walkers** on the footpaths, heading to and from the mela: the street pedestrian graph limited to the corridor.
- **Near the mela gate:** chowmein / papad carts with steam (`Smoke`) and a few vendors from vendors.ts. Its
  `place()` (:295-317) is exported for this.
- **Lights:** white LED and sodium street lamps, green tree uplights, and fairy-light strings on the mela's road-side
  cloth wall.

## Phase 3: Where the game starts (menu)
**src/ui/menu.ts**
- The Places section gets a **Start at** choice: **Shivaji Putla gate** (default) or **Inside the mela**.
- It is stored in localStorage `kanpur.start.v1`. settings.ts is numbers-only and admin-edited, so it isn't used.
- Choosing reloads, using the URL pattern at menu.ts:398-401. `?spawn=` in the URL still wins.

**src/main.ts**
- `spawnMode` defaults to the stored choice, or `'shivaji'` if none is stored.
- New mode `'shivaji'`: on the loop just north of the gate, facing south through it. No road snap.
- `'inside'` and `'mela'` keep using TEAR, which moves with the mela.
- `'metro'` stays for test scripts. It is outside the corridor, so it is only for debugging.
- Health respawn keeps using `spawnAt`, so a knockout wakes Ramu at the start.
- scripts/reactshot.mjs:67 hardcodes a mela point (40,150); it moves with the shift.

## Critical files
- src/world/melaSite.ts, src/world/mela.ts (shift only)
- src/world/stage1Route.ts (new): gate, walls, Nagar Nigam, barricades, parked vehicles, carts, lights
- src/world/landmarks/index.ts (parkEdge fix), src/world/props.ts (corridor traffic sub-graph), src/world/vendors.ts
  (export place)
- src/main.ts (route prep, collision, spawn), src/ui/menu.ts (Start at)

## Verification
- `npx tsc --noEmit`.
- Night playshots compared with the video frames:
  - the Shivaji gate looking in (frame 3)
  - the park road (frames 8–14)
  - the bend with Nagar Nigam ahead
  - the westward road with the mela on the right (frames 13–16)
  - the mela gate from the road
- A top-down debug shot of the corridor, walls, barricades and the mela over the map.
- **Containment:**
  - Walk and sprint along every wall, barricade, corner and gate, on foot and on a bike at full speed.
  - Ramu must never leave the corridor. Script it: random headings for 60 s, and assert he stays inside the
    play-area polygon.
- **Mela:** enter through the gate, and through the tear if reachable. Inside is unchanged (stage, wheel, maut ka kuan,
  crowd).
- **Traffic:** slow vehicles move, turn round at the barricades and don't pile up. Take a parked bike and ride to the
  mela.
- **Starts:** the default start is the Shivaji gate; switch to "inside the mela" in the menu, reload, and check.
- FPS at the start and at the mela gate within about 2 of now (34–37).
- Commit after each phase.

## Later: the mela's look, from the same video (not part of this plan)
What the real Kanpur Expo / numaish has, to use when the mela is fixed:
- **Gate:** a white castle façade with two spired towers and a bridge, lit violet and pink. It has a balloon arch and
  crowd railings in front.
- **Stalls:** white tents with orange pelmets, printed flex shop banners and bare bulbs. Green carpet in the aisles,
  orange-skirted tables, red plastic chairs. Goods: clothes, blankets and durries, bags, crockery, toys.
- **Rides:**
  - A giant wheel with LED star spokes.
  - Fans of V-shaped LED tubes on ride fronts.
  - Painted ride fronts with cartoons, stars and scalloped tops, plus balloon clusters.
- **Selfie zone:** a tunnel of heart-shaped arches, a pink lattice Eiffel tower, walk-in wire globes and a blue-lit
  city skyline.
- **Food court:** "साईं बाबा सुपर सॉफ्टी", a long white arcade with Hindi lettering. Also a furniture area and ground
  sellers.
- **Atmosphere:** floodlight masts and winter fog, with every lamp glowing.
