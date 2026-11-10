# 00 — Overview: kanpur_web ("Ramu", browser edition)

An original open-world game set in **Kanpur**, starring **Ramu**, playable in the browser.
This is the active project; the Godot prototype in `../kanpur` is paused.

## Decisions
- Engine: **Three.js** + TypeScript + Vite. Static build, desktop + phone.
- Style: low-poly stylized 3D, third-person.
- Map: **Moti Jheel core, ~1.2 × 1.2 km**, made as close to the real streets as public data allows
  (see `01-map-accuracy.md`).
- Stories are inspired by Kanpur news but fictionalized: no real people, brands, victims or ongoing cases.
- Everything (names, UI, story, characters) is original.

## Data sources and credits
- OpenStreetMap (ODbL): roads, water, parks, POIs, street furniture.
- Overture Maps buildings (ODbL / CC-BY, includes Google and Microsoft ML footprints): real footprints.
- Mapillary (CC-BY-SA): street photos used as visual reference only.
- Not used: Google Street View or Google 3D tiles (their terms forbid it).
- In-game credit: "© OpenStreetMap contributors · Overture Maps · Mapillary".

## Layout
```
plans/        design plans
tools/osm/    fetch + convert scripts (Python)
data/raw/     raw downloads (git-ignored)
reference/    Mapillary review page (thumbnails git-ignored)
src/          game code
public/data/  generated map.json
scripts/      screenshot / comparison scripts
```

## Milestones
- W0 setup + plans
- W1 accurate data pipeline (OSM + Overture + Mapillary → map.json)
- W2 Three.js city viewer
- W3 playable Ramu (controls, collision, minimap)
- W4 real road details + street furniture
- W5 street-level look from Mapillary
- W6 hand-modeled landmarks (Moti Jheel lake, metro station, crossings)

Commit after each milestone. New features get a new plan file first.
