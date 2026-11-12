# 03 — Parts of Kanpur, and street life

## Parts
Kanpur is divided into **parts**: map tiles the size of the Moti Jheel map (~1.2 × 1.2 km), on a grid anchored
on the Moti Jheel bbox, so Moti Jheel is exactly one cell.

- `npm run parts` (`tools/osm/make_parts.py`) counts Overture building footprints per cell, keeps the cells with
  enough buildings (default 500; `--min-buildings`), names them from Nominatim (cached in `names.cache.json`),
  and writes `tools/osm/areas.json` plus the manifest `public/data/parts.json`.
  The count query takes ~12 minutes, so the counts are cached (`building_counts.json`, `--reuse-counts`).
- `npm run part -- <id>` (`tools/osm/build_part.py`) builds one part's `public/data/<id>/map.json`
  (Overpass + Overture + convert). `-- --all [--limit N]` builds the biggest unbuilt parts; `-- --list` shows the state.
- Each map.json is ~0.7 MB, so only built parts are committed; the rest are built on demand.
- The game loads one part at a time: `?area=<id>`, or **Menu → Places**. A part must be built and **open**.
- **Admin → Parts of Kanpur** opens / closes parts. The choice is stored in the admin's browser; "Download parts.json"
  writes the open flags into the manifest, so committing it publishes them for everyone.

## Street life (`src/world/vendors.ts`, every part)
- Roadside vendors: chai tapri, paan kiosk, chaat / samosa cart, sugarcane juice, fruit thela, momos, kulfi; more on busy roads,
  clustered next to bus stops, stations, hospitals, banks, schools. Bulbs and signboards glow at night.
- A named signboard on the building for every named point of interest (restaurants, cafés, banks, hospitals…),
  with plastic-chair seating out front for the food places, plus generic dhabas / sweet shops on some shop fronts.
