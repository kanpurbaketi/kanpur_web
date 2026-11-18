# Plan 06: Stage 1 street life, from the video

The corridor from plan 05 works, but it looks too clean and too quiet next to the video. This plan also changes who
fights Ramu.

## The user's points
1. A crowd on the road and at the stalls, as in the video.
2. A few women wearing burqas.
3. A third as many parked vehicles as now.
4. Ramu can pick the lock of a parked car. It takes at least 30 s, and an owner who is nearby can attack him.
5. A two-wheeler takes 15 s to pick.
6. A bicycle takes no time.
7. No buildings in the two parks (Japani Garden and Tulsi Upvan), which should look like the video.
8. The Shivaji Putla gate should look like the video's.
9. Roads are not clean: garbage and potholes.
10. Nobody attacks Ramu without a reason. Only the mela's guards attack, and only once he is inside the mela.
11. Guards stay at their posts (for now, the mela). None walk the streets.

## Phases (a commit after each)

### A. Who fights
- No goons in any crowd.
  - `populate(n, mix)` takes the mix of kinds.
  - The street crowd gets no security guards.
- The mela crowd keeps its guards.
  - `Pedestrians.huntIf(x, z)`: a hostile goes for Ramu only when this is true. For the mela crowd it is `inMela`.
  - Guards stand at their posts more often than they walk.
- Fights with a reason stay:
  - anyone Ramu punches hits back
  - an owner who catches him at their vehicle (D)

### B. The parks
- `prepareRoute` drops every building inside the Japani Garden and Tulsi Upvan polygons.
- What is left is lawn and trees.

### C. Parked vehicles you can take
- Cut to a third, about one spot in three of today's.
- The parked vehicles are real traffic vehicles, so E works on them:
  - `Traffic.create(map, desktop, extra)` makes extra slots per kind.
  - `Traffic.pin(spots)` parks them at the kerb, locked and empty.
  - They are never recycled. They cost nothing per frame until touched.
- The Royal Enfield becomes a Pulsar (the traffic has no Enfield).
- The kerb row moves out a little and the corridor's lanes move in, so moving traffic passes the parked row.

### D. Lock picking
- E on a locked parked vehicle starts picking:
  - car: 30 s
  - two-wheeler: 15 s
  - cycle: none
- A progress bar in the use tip, with a "keep still" note.
- Moving, being hit or walking off cancels it.
- Done: the lock is open, and Ramu gets on.
- **Owner:**
  - Some vehicles have an owner in the crowd nearby (within about 25 m when picking starts).
  - After a few seconds the owner notices, and comes for Ramu with a grudge: a long chase range for 25 s.
  - "Oye! Meri gaadi!" shows in the tip.

### E. Crowd on the corridor
- In Moti Jheel the street crowd is a local crowd on the corridor's footpaths and road edges. The graph is the corridor
  roads, cut into 8 m pieces so people are spread evenly.
- Clusters stand round food carts near the mela gate and at the gate.
- About a third of the people are standing.
- **Burqa women:**
  - A new rig kind, `burqa`: the aunty model with burqa looks (black or very dark cloth all over, an eye slit, hands
    bare).
  - Made by `tools/people/make_variants.py`.
  - About 8% of the corridor and mela crowds.

### F. The Shivaji Putla gate and statue, from frames g10–g15
- **The gate:**
  - A rough grey stone-block wall, with a flat-topped rectangular opening the road passes through.
  - A stepped, crenellated top, with a pink box and a saffron flag on top.
  - A lit, colourful emblem over the opening.
  - Stone walls going on at the sides, one with small chhatri domes.
  - A golden lion near the right inside.
- **The statue:** a golden figure on a tapering white pillar with one vertical red stripe, on the road island.
- **On the left:** steps up to the metro building, pink pipe railings, and a yellow-and-black painted kerb.

### G. Dirty road
- Decals on the corridor road and footpaths:
  - potholes (dark, broken edges, some with water)
  - patches
  - litter (paper, plastic, cups) scattered thickest along the kerbs
  - a few garbage heaps at the kerb
- Instanced, a few draw calls.

## Checks
- `npx tsc --noEmit`.
- Screenshots of the gate, the park road and the mela front.
- `scripts/corridorcheck.mjs`.
- A lock-pick script: a car takes 30 s, a bike 15 s, a cycle none; moving cancels it.
- FPS on the route still at 30 or above.
