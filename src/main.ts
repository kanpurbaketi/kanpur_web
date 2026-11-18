import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { CollisionWorld } from './player/collide';
import { Ramu } from './player/ramu';
import { CROWD_MAX, loadSettings, onSettingsChange } from './game/settings';
import { Stats } from './game/stats';
import { Hud } from './ui/hud';
import { Health } from './game/health';
import { Menu } from './ui/menu';
import { City } from './world/city';
import { Landmarks } from './world/landmarks';
import { Pedestrians } from './world/pedestrians';
import { makeStalls, Traffic } from './world/props';
import { makeOccupancy, StreetDetail } from './world/streetDetail';
import { treeUniforms } from './world/trees';
import { MapData, project } from './world/types';
import { LightPool, NIGHT, updateGlow } from './world/night';
import { LampPools, lampColor } from './world/lampPools';
import { Controls, label } from './game/controls';
import { Driving } from './player/drive';
import { Mela } from './world/mela';
import { Vendors } from './world/vendors';
import { HOME, loadManifest, playable } from './game/parts';
import { clipRoadsToMela, TEAR } from './world/melaSite';
import { CORRIDOR, prepareRoute, SHIVAJI_START, Stage1Route } from './world/stage1Route';
import { startChoice } from './game/start';

/*
 Debug URL params:
   ?cam=x,y,z,yaw,pitch   fixed camera (meters, radians), player hidden
   ?at=lat,lon,heading    camera at eye height at a real spot, heading in compass degrees (Mapillary photo spots)
   ?spawn=lat,lon         start Ramu at a real spot (?spawn=shivaji: by the statue, stage 1's start; inside: in the mela;
                          mela: in the alley outside the torn place; metro: by the station, outside stage 1's walls)
   ?time=day              afternoon instead of the default night
   ?debug                 FPS / draw-call overlay
   ?traffic=0             no vehicles
   ?peds=90               number of pedestrians kept around the player, overriding the admin setting (0 = none)
   ?fov=20                camera field of view in degrees (small = zoomed in, for character close-ups)
   ?ao=0 / ?ao=1          force ambient occlusion off / on (default: on for mouse devices, off for touch)
 window.__ready is set once the first frame has rendered (for screenshot scripts).
*/
const params = new URLSearchParams(location.search);

async function main() {
  const status = document.getElementById('status')!;
  // which part of Kanpur: ?area=<id>, if the admin has opened it and its data is built; otherwise home (Moti Jheel)
  const manifest = await loadManifest();
  const open = new Set(playable(manifest).map((p) => p.id));
  let AREA = params.get('area') ?? HOME;
  if (AREA !== HOME && !open.has(AREA)) AREA = HOME;
  const map: MapData = await (await fetch(`data/${AREA}/map.json`)).json();
  if (map.area === 'moti_jheel') {
    map.roads = clipRoadsToMela(map.roads);   // no park path across the mela ground
    prepareRoute(map);                        // stage 1: the way from the Shivaji Putla gate to the mela (plans/05)
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: params.has('cam') || params.has('at') });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.info.autoReset = false; // count every pass of the frame (post-processing renders the scene twice)
  document.body.prepend(renderer.domElement);

  const desktop = matchMedia('(pointer: fine)').matches;
  const useAO = params.has('ao') ? params.get('ao') !== '0' : desktop;

  const scene = new THREE.Scene();
  // ?time=day for the afternoon; the default is a clear night with a high moon
  const SUN_DIR = (NIGHT ? new THREE.Vector3(0.35, 0.75, -0.45) : new THREE.Vector3(-0.45, 0.62, 0.5)).normalize();
  const haze = new THREE.Color(NIGHT ? '#1a2036' : '#cfc8b6');   // night: dusty blue-grey sky glow; day: warm haze
  if (NIGHT) renderer.toneMappingExposure = 1.35;
  scene.background = haze;
  scene.fog = new THREE.FogExp2(haze, NIGHT ? 0.0024 : 0.0021);
  const sky = skyDome(SUN_DIR, haze);
  scene.add(sky);

  // Image-based ambient light from the same sky, so shade picks up the blue sky and warm haze.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene();
  skyScene.add(skyDome(SUN_DIR, haze));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(1500, 16).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#7d6f58' }));
  ground.position.y = -2;
  skyScene.add(ground);
  scene.environment = pmrem.fromScene(skyScene, 0, 1, 3000).texture;
  scene.environmentIntensity = NIGHT ? 0.5 : 0.75;

  const camera = new THREE.PerspectiveCamera(Number(params.get('fov')) || 70, innerWidth / innerHeight, 0.1, 2500);
  scene.add(NIGHT ? new THREE.HemisphereLight('#5a6fa8', '#2a2430', 0.55) : new THREE.HemisphereLight('#cfdcea', '#7a6a52', 0.35));
  const sun = new THREE.DirectionalLight(NIGHT ? '#9fb4ff' : '#ffe9c7', NIGHT ? 0.9 : 3.2);   // the moon, at night
  sun.castShadow = true;
  sun.shadow.mapSize.set(desktop ? 4096 : 2048, desktop ? 4096 : 2048);
  Object.assign(sun.shadow.camera, { left: -100, right: 100, top: 100, bottom: -100, near: 1, far: 450 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.3;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  const t0 = performance.now();
  const city = new City(map);
  scene.add(city.group);
  const occupied = makeOccupancy(map);
  const detail = new StreetDetail(map, occupied);
  scene.add(detail.group);
  const lightPool = new LightPool(scene, desktop ? 10 : 8);
  if (NIGHT) for (const [x, z] of detail.lamps) lightPool.add(x, 8.2, z, lampColor(x, z), 170, 32);
  if (params.has('debug')) (window as unknown as { __lamps: [number, number][] }).__lamps = detail.lamps;
  const lampPools = NIGHT ? new LampPools(detail.lamps) : null;
  if (lampPools) scene.add(lampPools.group);
  const world = new CollisionWorld(map);
  for (const [x, z] of city.pillars) world.addPost(x, z, 0.9);
  for (const [x, z, r] of detail.obstacles) world.addPost(x, z, r);
  // the mela is part of the Moti Jheel map only (its coordinates are fixed to Tulsi Upvan)
  const mela = map.area === 'moti_jheel' ? new Mela(map, NIGHT ? lightPool : null, desktop) : null;
  if (mela) {
    scene.add(mela.group);
    for (const [x, z, r, h, base] of mela.posts) world.addPost(x, z, r, h, base);
    for (const w of mela.rails) world.addWall(w.ring, w.h, w.camH > 0, w.camH);
    for (const f of mela.floors) world.addFloor(f);
    for (const ring of mela.walls) world.addWall(ring, 3.4);
  }
  const landmarks = new Landmarks(map);
  scene.add(landmarks.group);
  for (const [x, z, r] of landmarks.posts) world.addPost(x, z, r);
  for (const ring of landmarks.walls) world.addWall(ring, 6);
  // stage 1: Ramu can only reach the way from the Shivaji Putla gate to the mela (walls, barricades, an invisible edge behind them)
  const route = map.area === 'moti_jheel' ? new Stage1Route(map, NIGHT ? lightPool : null) : null;
  if (route) {
    scene.add(route.group);
    for (const [x, z, r, h] of route.posts) world.addPost(x, z, r, h);
    for (const [ring, h] of route.walls) world.addWall(ring, h, true, 2.6);
    world.addWall(CORRIDOR, 80, false);
    if (params.has('debug')) (window as unknown as { __corridor: typeof CORRIDOR }).__corridor = CORRIDOR;   // scripts/corridorcheck.mjs
  }
  const controls = new Controls();
  const hintEl = document.getElementById('hint')!;
  hintEl.textContent = controls.hint();
  controls.onChange(() => (hintEl.textContent = controls.hint()));
  const ramu = new Ramu(camera, world, renderer.domElement, controls);
  scene.add(ramu.root);
  if (params.has('debug')) (window as unknown as { __ramu: Ramu }).__ramu = ramu;   // for test scripts
  // Crowd size comes from the admin portal (admin.html); ?peds=N overrides it for testing.
  const forced = params.has('peds') ? Number(params.get('peds')) || 0 : null;
  const crowdFor = (n: number) => Math.round(n * (desktop ? 1 : 0.5)); // half on touch devices
  const peds = new Pedestrians(map);
  peds.setCount(forced ?? crowdFor(loadSettings().crowd));
  if (forced === null) onSettingsChange((s) => peds.setCount(crowdFor(s.crowd)));
  scene.add(peds.group);
  peds.populate(Math.max(crowdFor(CROWD_MAX), forced ?? 0));      // uncles, aunties, women in burqas, college girls and boys, in all their looks (no guards or goons in the street)
  const lookDir = new THREE.Vector3();
  const hud = new Hud(map);
  const stats = new Stats(city.roadPoints);
  let paused = false;
  const menu = new Menu({
    map, hud, stats, controls, area: AREA, parts: playable(manifest), allParts: manifest.parts,
    player: () => ({ x: ramu.position.x, z: ramu.position.z, yaw: ramu.yaw }),
    onPause: (p) => {
      paused = p;
      ramu.enabled = !p;
      ramu.releaseKeys();
      if (p) document.exitPointerLock?.();
    },
  });
  console.log(`city built in ${(performance.now() - t0).toFixed(0)} ms`, city.stats);

  // Spawn: near the Moti Jheel metro on the nearest road point.
  const m = map.landmarks.moti_jheel_metro ?? [0, 0];
  let spawn: [number, number] = [m[0] + 6, m[1] + 45]; // just south of the station, facing it
  if (params.get('spawn') && !['mela', 'inside', 'metro', 'shivaji'].includes(params.get('spawn')!)) {
    const [lat, lon] = params.get('spawn')!.split(',').map(Number);
    spawn = project(map, lat, lon);
  }
  const spawnMode = params.get('spawn') ?? (map.area === 'moti_jheel' ? startChoice() : null);
  if (spawnMode === 'shivaji') spawn = SHIVAJI_START;   // by the statue, the Shivaji Putla gate ahead (the real start of stage 1)
  if (spawnMode === 'mela') spawn = [TEAR.x - 3.5, TEAR.z]; // in the alley outside the torn place in the cloth wall
  if (spawnMode === 'inside') spawn = [TEAR.x + 2.2, TEAR.z]; // the game starts in the mela, just past the tear (beside the stage entry)
  let best = spawn, bd = Infinity;
  for (const p of city.roadPoints) {
    const d = Math.hypot(p[0] - spawn[0], p[1] - spawn[1]);
    if (d < bd) [bd, best] = [d, p];
  }
  if (spawnMode === 'mela' || spawnMode === 'inside' || spawnMode === 'shivaji') best = spawn;
  ramu.position.set(best[0], 0, best[1]);
  const spawnAt: [number, number] = [best[0], best[1]];
  // life bar: vehicles hurt; a knockout wakes Ramu back at the spawn point
  const health = new Health(() => { ramu.position.set(spawnAt[0], 0, spawnAt[1]); ramu.releaseKeys(); });
  if (params.has('debug')) (window as unknown as { __health: Health }).__health = health;
  // goons (dark-clothed men in the crowd) run at Ramu and punch / kick; his own punch staggers them
  const mugged = (d: number) => { const was = health.value; health.hurt(d); if (health.value < was) ramu.flinch(); };
  const away = (x: number, z: number, y = 0): [number, number] => world.resolve(x, z, 0.3, y);
  peds.onHurt = mugged;
  peds.resolve = away;
  peds.vehicleAt = null;   // set once the traffic exists
  if (mela) { mela.crowd.onHurt = mugged; mela.crowd.resolve = away; }
  if (params.has('debug')) (window as unknown as { __peds: Pedestrians }).__peds = peds;
  if (params.has('debug') && mela) (window as unknown as { __melaCrowd: Pedestrians }).__melaCrowd = mela.crowd;
  let punchesSeen = 0;
  let punchLand = -1;      // seconds until the punch now in the air lands (-1: none)
  /** whoever a punch of Ramu's would land on now, in the street crowd or the mela's: the nearer of the two */
  const punchTarget = () => {
    const fx = -Math.sin(ramu.facing), fz = -Math.cos(ramu.facing);
    const a = peds.aim(ramu.position.x, ramu.position.z, fx, fz), b = mela?.crowd.aim(ramu.position.x, ramu.position.z, fx, fz) ?? null;
    const crowd = a && (!b || a.d <= b.d) ? peds : b ? mela!.crowd : null;
    return crowd ? { crowd, fx, fz, at: (crowd === peds ? a : b)! } : null;
  };

  // Blender-built props: traffic (buses, autos, e-rickshaws) and panipuri stalls. ?traffic=0 turns traffic off.
  const traffic = params.get('traffic') === '0' ? null : await Traffic.create(map, desktop);
  if (traffic) {
    scene.add(traffic.group);
    peds.vehicleAt = (x, z, r) => traffic.hit(x, z, r);
    peds.vehiclePush = (x, z, r) => traffic.pushOut(x, z, r);
  }
  if (traffic && params.has('debug')) (window as unknown as { __traffic: Traffic }).__traffic = traffic;
  if (params.has('debug')) (window as unknown as { __camera: THREE.Camera }).__camera = camera;   // test scripts aim it at things
  const solid: [number, number, number][] = [...detail.obstacles, ...landmarks.posts,
    ...city.pillars.map(([x, z]) => [x, z, 0.9] as [number, number, number])];
  const stalls = await makeStalls(map, occupied, solid, best);
  scene.add(stalls.mesh);
  for (const [x, z, r] of stalls.posts) world.addPost(x, z, r, 1.15);   // low enough to jump up on
  const vendors = new Vendors(map, occupied, [...solid, ...stalls.posts], NIGHT ? lightPool : null, desktop);
  scene.add(vendors.group);
  for (const [x, z, r] of vendors.posts) world.addPost(x, z, r, 1.15);
  console.log('street life', vendors.stats);
  if (params.has('debug')) (window as unknown as { __vendors: Vendors }).__vendors = vendors;   // for test scripts
  console.log('props', { stalls: stalls.posts.length, traffic: !!traffic });
  ramu.yaw = spawnMode === 'shivaji' ? Math.PI                                    // facing south, through the gate
    : spawnMode === 'mela' || spawnMode === 'inside' ? -Math.PI / 2 : Math.atan2(best[0] - m[0], best[1] - m[1]); // camera looks toward the metro (or into the mela)

  // Fixed debug cameras.
  let fixed = false;
  if (params.get('cam')) {
    const [x, y, z, yaw, pitch] = params.get('cam')!.split(',').map(Number);
    camera.position.set(x, y, z);
    camera.rotation.set(pitch ?? 0, yaw ?? 0, 0, 'YXZ');
    fixed = true;
  } else if (params.get('at')) {
    const [lat, lon, heading] = params.get('at')!.split(',').map(Number);
    const [x, z] = project(map, lat, lon);
    camera.position.set(x, 1.6, z);
    camera.rotation.set(0, -THREE.MathUtils.degToRad(heading || 0), 0, 'YXZ');
    camera.fov = 75; // closer to Mapillary's phone / action-cam field of view
    camera.updateProjectionMatrix();
    fixed = true;
  }
  if (fixed) {
    if (camera.position.y > 50) scene.fog = new THREE.Fog(haze, 600, 2400); // overview shots
    ramu.root.visible = false;
    ramu.enabled = false;
  }

  // E: Ramu takes the nearest vehicle (and throws off whoever is on it), drives it, gets off
  if (traffic) traffic.resolve = (x, z, r) => world.resolve(x, z, r, 0);
  const driving = traffic && !fixed ? new Driving(scene, traffic, ramu, peds, () => label(controls.get('use')[0] || controls.get('use')[1])) : null;
  if (driving && params.has('debug')) (window as unknown as { __driving: Driving }).__driving = driving;

  const debugEl = document.getElementById('debug')!;
  const showDebug = params.has('debug');
  debugEl.style.display = showDebug ? 'block' : 'none';
  status.style.display = 'none';
  document.getElementById('hint')!.style.display = fixed ? 'none' : '';
  menu.visible = !fixed;

  // Post: MSAA render -> ground-truth AO (skips leaf cards and wires) -> tone map / sRGB output.
  let composer: EffectComposer | null = null;
  if (useAO) {
    const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    const ao = new GTAOPass(scene, camera, innerWidth, innerHeight);
    ao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 2.5, scale: 1.0, samples: 12 });
    ao.blendIntensity = 0.85;
    const hideMore = (ao as unknown as { _overrideVisibility: () => void });
    const orig = hideMore._overrideVisibility.bind(ao);
    hideMore._overrideVisibility = () => {
      orig();
      const cache = (ao as unknown as { _visibilityCache: THREE.Object3D[] })._visibilityCache;
      scene.traverse((o) => {
        if ((o.userData.noAO || o === sky) && o.visible) {
          o.visible = false;
          cache.push(o);
        }
      });
    };
    composer.addPass(ao);
    // lights bloom (only things brighter than the scene's whites: bulbs, lamps, signs, lenses)
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), NIGHT ? 0.22 : 0.08, 0.4, NIGHT ? 1.05 : 1.3));
    // grade: cool shadows, warm highlights, a little vignette, so a night street reads as a night street
    composer.addPass(new ShaderPass({
      uniforms: { tDiffuse: { value: null }, night: { value: NIGHT ? 1 : 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform float night; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, c * vec3(0.86, 0.98, 1.16), (1.0 - smoothstep(0.0, 0.3, l)) * 0.55 * night);
  c = mix(c, c * vec3(1.1, 1.0, 0.86), smoothstep(0.5, 2.0, l) * 0.45 * night);
  vec2 d = vUv - 0.5;
  c *= 1.0 - dot(d, d) * (0.55 + 0.5 * night);
  gl_FragColor = vec4(c, 1.0);
}`,
    }));
    composer.addPass(new OutputPass());
  }

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer?.setSize(innerWidth, innerHeight);
  });

  const clock = new THREE.Clock();
  let frames = 0, acc = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.05, clock.getDelta());
    if (!fixed && ramu.punches !== punchesSeen) {
      punchesSeen = ramu.punches;
      const t = punchTarget();
      if (t) ramu.faceTowards(t.at.x, t.at.z);       // he squares up to whoever is in front of him
      punchLand = ramu.punchDelay;                   // and the blow lands when the fist gets there, not when it starts
    }
    if (punchLand >= 0 && (punchLand -= dt) < 0) {
      punchLand = -1;
      const t = ramu.isPunching ? punchTarget() : null;
      if (t) t.crowd.hit(ramu.position.x, ramu.position.z, t.fx, t.fz);
    }
    ramu.knockedOut = health.knockedOut;
    if (!fixed) {
      health.update(dt);
      ramu.enabled = !paused && !health.knockedOut;
      if (driving && health.knockedOut) driving.drop();
      if (driving && !paused) driving.update(dt);
      ramu.update(dt);
      if (!driving?.driving && !health.knockedOut) {
        // he cannot walk through people: the street crowd and the mela's
        const p = ramu.position;
        [p.x, p.z] = peds.pushOut(p.x, p.z, 0.33, p.y);
        if (mela) [p.x, p.z] = mela.crowd.pushOut(p.x, p.z, 0.33, p.y);
        [p.x, p.z] = world.resolve(p.x, p.z, 0.33, p.y);   // ... nor be pushed by them into a wall
      }
    }
    if (!fixed && !paused) stats.update(dt, ramu.position.x, ramu.position.z, ramu.speed, ramu.jumps);
    const focus = fixed ? camera.position : ramu.position;
    sun.target.position.set(focus.x, 0, focus.z);
    if (!paused) {
      camera.getWorldDirection(lookDir);
      const l = Math.hypot(lookDir.x, lookDir.z) || 1;
      const who: [number, number] = fixed ? [Infinity, Infinity] : [focus.x, focus.z];
      // goons leave a knocked-out Ramu alone, and one driving off
      const prey: [number, number] = health.knockedOut || driving?.driving ? [Infinity, Infinity] : who;
      peds.update(dt, focus.x, focus.z, lookDir.x / l, lookDir.z / l, prey[0], prey[1], ramu.position.y);
      mela?.update(dt, focus.x, focus.z, lookDir.x / l, lookDir.z / l, prey[0], prey[1], ramu.position.y);
      traffic?.update(dt, focus.x, focus.z, lookDir.x / l, lookDir.z / l, who[0], who[1]);
      if (traffic && !fixed && !driving?.driving) {
        const bx = ramu.position.x, bz = ramu.position.z;
        // hit by a moving vehicle: hurt (more the faster it goes) and thrown clear
        const h = ramu.stun <= 0 && !health.knockedOut ? traffic.hit(bx, bz, 0.4) : null;
        if (h && h.speed > 1.2) {
          health.hurt(Math.min(45, Math.round(8 + h.speed * 3.5)));
          ramu.knock(h.vx * 0.85, h.vz * 0.85, 3.2);
        }
        [ramu.position.x, ramu.position.z] = traffic.pushOut(bx, bz, 0.35);
      }
    }
    sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 200);
    if (!fixed) hud.update(ramu.position.x, ramu.position.z, ramu.yaw);
    renderer.info.reset();
    treeUniforms.time.value += dt;
    sky.position.copy(camera.position);
    updateGlow(dt, camera, innerHeight * renderer.getPixelRatio());
    if (NIGHT) lightPool.update(focus.x, focus.z);
    lampPools?.update(camera.position.x, camera.position.z);
    if (composer) composer.render(dt);
    else renderer.render(scene, camera);
    (window as unknown as { __ready: boolean }).__ready = true;
    frames++;
    acc += dt;
    if (showDebug && acc > 0.5) {
      const i = renderer.info.render;
      debugEl.textContent = `${(frames / acc).toFixed(0)} fps · ${i.calls} calls · ${(i.triangles / 1000).toFixed(0)}k tris · ` +
        `${city.stats.buildings} buildings · ${peds.count} people · x ${focus.x.toFixed(0)} z ${focus.z.toFixed(0)}`;
      frames = 0;
      acc = 0;
    }
  });
}

/** Inverted sphere: hazy blue zenith, warm dusty horizon, soft glow around the sun. Matches the fog colour at the horizon. */
function skyDome(sunDir: THREE.Vector3, haze: THREE.Color): THREE.Mesh {
  const night = NIGHT;
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      sun: { value: sunDir.clone() },
      zenith: { value: new THREE.Color(night ? '#04070f' : '#7f9fc0') },
      horizon: { value: haze.clone() },
      glow: { value: new THREE.Color(night ? '#cdd8ff' : '#fff0d0') },
      night: { value: night ? 1 : 0 },
    },
    vertexShader: `varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w; // always at the far plane
}`,
    fragmentShader: `uniform vec3 sun, zenith, horizon, glow;
uniform float night;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float up = max(d.y, 0.0);
  vec3 col = mix(horizon, zenith, pow(up, 0.45));
  float s = max(dot(d, sun), 0.0);
  col += glow * (pow(s, 8.0) * 0.25 + pow(s, 300.0) * 1.5);
  if (night > 0.5 && d.y > 0.0) {
    vec3 g = floor(d * 420.0);
    float h = fract(sin(dot(g, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    col += vec3(1.0, 0.95, 0.9) * step(0.9975, h) * (0.35 + 0.65 * h) * smoothstep(0.02, 0.35, d.y);   // stars
    col += vec3(1.0, 0.8, 0.6) * 0.12 * pow(1.0 - up, 6.0);                                             // city glow at the horizon
    col += glow * smoothstep(0.9993, 0.9997, s);                                                         // moon
  }
  if (d.y < 0.0) col = horizon;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(2000, 32, 16), mat);
  m.frustumCulled = false;
  m.renderOrder = -1;
  return m;
}

main().catch((e) => {
  document.getElementById('status')!.textContent = 'Failed to load: ' + e;
  console.error(e);
});
