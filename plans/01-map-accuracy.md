# 01 — Map accuracy

Goal: walking the game's Moti Jheel should feel like walking the real streets — real positions and
shapes, stylized look.

## Area
`moti_jheel` in `tools/osm/areas.json`: bbox [26.4736, 80.3119, 26.4846, 80.3239].

## Pipeline
1. `fetch_osm.py --area moti_jheel` → `data/raw/moti_jheel.osm.json`
   - roads with `lanes`, `sidewalk`, `divider`, `layer`, `bridge`
   - street lamps, trees, power poles/lines, barriers
   - buildings with `building:levels`, `building:colour`, `roof:*`; shops/amenities
   - elevated metro line
2. `fetch_overture.py --area moti_jheel` → `data/raw/moti_jheel.overture.geojson`
   (real footprints from Overture, with `height`/`num_floors` where known).
3. `fetch_mapillary.py --area moti_jheel` (needs `MAPILLARY_TOKEN`) → image points with heading,
   thumbnails, detected map features (poles, street lights, signs).
4. `convert.py --area moti_jheel` → `public/data/moti_jheel/map.json`
   - buildings: OSM wins where overlapping, else Overture. **No procedural infill.**
   - height source tagged as `hsrc`: `osm` | `overture` | `est`.
   - roads: width from lanes, divider, sidewalks, bridge layer.
   - furniture points from OSM + Mapillary.
   - shop frontage flag + style key from `street_styles.json`.

## Street look (W5)
`reference/index.html` groups Mapillary thumbnails by street. Each street segment gets an entry in
`tools/osm/street_styles.json`: facade palette, shop share, shutter colours, signboards, balconies,
boundary walls, tree density. Uncovered streets borrow the nearest covered style (marked).

## Accuracy checks
- `?at=lat,lon,heading` puts the camera at a Mapillary photo spot; `scripts/shots.mjs` renders those
  views and a comparison page shows them next to the photos.
- No building overlaps a road; every building has a height source.

## Known limits
- Heights are estimated where neither OSM nor Overture has them.
- Mapillary coverage in Kanpur may be partial.
