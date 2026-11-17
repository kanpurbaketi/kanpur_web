# 04 — Vehicles and driving

Ramu can take any vehicle in the traffic (E): whoever is on it is thrown off, he drives it, E again gets him off
(`src/player/drive.ts`, `Traffic.board / drive / leave` in `src/world/props.ts`). Nothing passes through anything:
people, vehicles, walls, stalls and the still figures all have bodies (`src/player/collide.ts`, `figurePosts`,
`Pedestrians.solid`, `Traffic.separate`).

This plan makes driving look and feel natural. Feel: **semi-realistic** (GTA-like: weight, grip, handbrake slides,
body roll; forgiving on a keyboard).

## Problems now
- Ramu on a vehicle is a still posed mesh (`figures/ramu.glb`, 'ride' / 'drive'): hands don't grip, legs go through
  the bodywork, nothing moves (no steering, pedalling, lean); getting on and off is instant.
- Tyres don't turn: every vehicle is one merged mesh.
- Driving is kinematic: no mass, grip or slides; brakes and handbrake only take speed off; collisions only push out.
  No brake / reverse / indicator lights, no headlights on the player's vehicle.

## Phase 1 — wheels (done)
- `tools/blender/import_vehicle.py`: a `wheels` table per vehicle (name, hub x / y / z, radius, width, steers). Each
  wheel is cut out of the mesh (the faces in its cylinder) into its own mesh, its origin at the hub, in the same atlas.
  Models whose wheels are part of a scan (auto, cycle, truck, Enfield, the TripoSR bus / tirri / Maruti) get a
  procedural wheel (tyre, rim, hub) in place of the cut. Bikes and cycles also get a `steer` group (fork and
  handlebar); cars their steering wheel.
- `tools/blender/make_lod.py`: far models keep the wheels merged and still.
- Game: one InstancedMesh per wheel (near models only); instance = vehicle × hub × steer × spin. Every vehicle gets
  `spin` (+= v·dt / r) and `steer` (AI: from its turn rate; the player's: from the physics).

## Phase 2 — physics (`src/world/vehicleSim.ts`) (done)
- A rigid-body bicycle model at 120 Hz: velocity, yaw rate, steer angle, wheel spin, gear, RPM.
- Per kind: mass, wheelbase, centre of gravity, max steer, power and torque, gears, brakes, grip, cornering
  stiffness, drag. Two-wheelers don't drift; cycles and rickshaws are pedalled (~200 W).
- Tyres: slip angle → lateral force, saturating at μ·N; drive and brake force within the friction circle; handbrake
  locks the rear (slides, drifts); load moves forward under braking, back under acceleration.
- Steering rate-limited, less lock at speed, self-aligning in a slide. Grip × 0.6 off the road (`Traffic.onRoad`).
- Collisions by impulse: walls (restitution 0.2, friction, spin from an off-centre hit), vehicles (by mass), people
  knocked over as now. AI traffic stays on its paths.
- Done as: steering lock limited to what the grip can use at the speed, and a stability help (yaw rate held near
  μg/v; 1.8× in a hand-brake slide) so it is drivable on keys. A bike's Space is its brakes. `scripts/simcheck.mjs`
  prints the sim's state through a drill (throttle, turn, hand brake, brakes).

## Phase 3 — lights (done)
- Brake, tail, reverse and indicator lamps per kind (the `LAMPS` table), drawn as small glowing instanced quads with
  a state per vehicle: braking, reversing, indicating before a turn (AI) or when the player steers slowly; tail lamps
  glow dimly at night.
- At night the player's vehicle carries two real spot lights (L: on / off, high beam). H: horn.
- Done as: `REAR` table in props.ts (measured on rear renders), one InstancedMesh of lit quads (`writeLamps`); the
  traffic picks its way on 30 m before a junction (`next`) and indicates through the turn; the spot lights are always
  in the scene (no shader recompiles) and dark when unused; the player's car loses its fake light pool. H is bound
  (`Driving.horn`) and sounds in phase 5. `scripts/lampshot.mjs`, `scripts/blinkshot.mjs`.

## Phase 4 — Ramu riding naturally (done)
- `tools/blender/build_ramu_rig.py` bakes clips per vehicle with IK: seat, hands on the grips or the wheel, feet on
  pegs / pedals / floor. `veh_<kind>` (steer left / centre / right), `pedal_<kind>` (loop), `mount_<kind>` /
  `dismount_<kind>`.
- On a vehicle Ramu keeps his rigged body: the steer clip is scrubbed by the steer angle, pedalling follows the wheel,
  his head looks into the turn; getting on and off plays the mount clips.
- Bikes lean into turns (atan(v·yaw rate / g), up to 35°, rider with them); cars roll a little in corners and pitch
  under braking and acceleration.
- Done as runtime IK instead of baked clips (`src/player/rider.ts`): on the standing idle, the hips go to the seat,
  the spine leans as far as the hands need (found per kind), two-bone IK puts the hands on the grips (turned about the
  steering pivot; `split_wheels.py` BARS cuts the handlebar of the Pulsar, cycle and rickshaw so it turns too) or on the
  wheel at ten to two, and the feet on pegs / floor / pedals going round with the wheels. On a cycle or rickshaw (too big
  for him) he pedals standing. Getting on / off eases from where he stood to the seat (`Driving` MOUNT / DISMOUNT,
  the vehicle held still meanwhile). `Traffic.bodyMatrix`: bikes lean into turns, car bodies roll and pitch; the
  traffic's own too. `scripts/poseshot.mjs`.

## Phase 5 — feel (done)
- `src/game/audio.ts` (WebAudio, synthesised): engine note from RPM and throttle per type (car, diesel bus / truck,
  auto, bike, e-rickshaw whine, cycle chain), tyre squeal, crash thuds, a horn per type.
- Chase camera: spring lag, wider view with speed, a little look into the turn.
- Done as: `VehicleAudio` in `src/game/audio.ts`, driven by `Driving` from the sim (revs, throttle, slip, knocks;
  thuds debounced so a scrape is not a drum roll); the cycle and rickshaw ring a bell. The camera's point leads the
  vehicle by its speed and follows on a spring; field of view +0..12°, arm a little longer with speed.

## Phase 6 — damage (done)
- The vehicle Ramu takes becomes its own mesh (out of the instancing) until it is recycled.
- Hits dent it (vertices pushed in around the impact); damage builds up: smoke past 40, black smoke and less power past
  75, a headlight broken by a front hit, the engine dead at 100. Repaired when recycled.
- Done as: `Traffic.takeOwn` (copies of the near parts in the vehicle's colours; its instanced body slot drawn at
  scale 0, the wheels stay instanced), `Traffic.knocked` (damage += 2.2 × the knock in m/s; vertices within 0.3-0.85 m
  pushed in along the hit, ≤ 0.22 m from their original place; a hard front hit breaks the nearer headlamp: lens, pool
  and beam), `src/world/smoke.ts` (one Points draw), power × 0.6 past 75 and none at 100 ("engine dead", no engine
  note). `scripts/crashshot.mjs`.
- Frame rate at the spawn (playshot, day): 35 fps with traffic, 36-37 without (was 37-39 / 39 before this plan; the
  no-traffic run fell as much, so most of it is the machine, but the wheels and lamps add ~1.5 draw calls per kind).

## Checks
- `npx tsc --noEmit`; Blender previews of every vehicle (wheels in their arches, centred hubs, Ramu's hands and feet
  in place).
- `scripts/driveshot.mjs` for every kind: wheels turn and steer, handbrake slide, brake lights, bike lean, Ramu's
  grip; night shots for the lights; a crash for dents and smoke; frame rate at the mela entrance within ~2 fps of
  37–39.
- Commit after each phase.
