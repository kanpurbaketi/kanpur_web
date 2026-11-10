# 02 — Game (Three.js)

## Structure
- `src/main.ts` renderer, loop, debug params (`?cam=x,y,z,yaw,pitch`, `?at=lat,lon,heading`, `?debug`).
- `src/world/city.ts` roads (ribbons + dashes), extruded buildings, water, parks, instanced trees/tanks.
  Meshes merged per material per 250 m tile (< ~150 draw calls).
- `src/world/facade.ts` procedural facade shader (windows, floor lines, shutters, signboards) with
  per-street palettes.
- `src/world/streetDetail.ts` poles + wires, lamps, trees, dividers, kerbs, signboards (instanced).
- `src/world/landmarks/` Moti Jheel lake, metro station, viaduct.
- `src/player/ramu.ts` walk/run, 3rd-person orbit camera with wall pull-in, pointer lock, touch joystick.
- `src/player/collide.ts` circle vs building footprints on a spatial hash.
- `src/ui/hud.ts` minimap + attribution.

## Coordinates
1 unit = 1 m, +X east, +Z south (same projection as `convert.py`, origin = bbox center).

## Targets
60 fps on a laptop; playable on a mid-range phone.
