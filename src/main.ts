import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { CollisionWorld } from './player/collide';
import { Ramu } from './player/ramu';
import { CROWD_MAX, loadSettings, onSettingsChange } from './game/settings';
import { Stats } from './game/stats';
import { Hud } from './ui/hud';
import { Menu } from './ui/menu';
import { City } from './world/city';
import { Landmarks } from './world/landmarks';
import { Pedestrians } from './world/pedestrians';
import { makeOccupancy, StreetDetail } from './world/streetDetail';
import { treeUniforms } from './world/trees';
import { MapData, project } from './world/types';

/*
 Debug URL params:
   ?cam=x,y,z,yaw,pitch   fixed camera (meters, radians), player hidden
   ?at=lat,lon,heading    camera at eye height at a real spot, heading in compass degrees (Mapillary photo spots)
   ?spawn=lat,lon         start Ramu at a real spot
   ?debug                 FPS / draw-call overlay
   ?peds=90               number of pedestrians kept around the player, overriding the admin setting (0 = none)
   ?fov=20                camera field of view in degrees (small = zoomed in, for character close-ups)
   ?ao=0 / ?ao=1          force ambient occlusion off / on (default: on for mouse devices, off for touch)
 window.__ready is set once the first frame has rendered (for screenshot scripts).
*/
const params = new URLSearchParams(location.search);
const AREA = params.get('area') ?? 'moti_jheel';

async function main() {
  const status = document.getElementById('status')!;
  const map: MapData = await (await fetch(`data/${AREA}/map.json`)).json();

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
  const SUN_DIR = new THREE.Vector3(-0.45, 0.62, 0.5).normalize(); // afternoon, sun to the south-west
  const haze = new THREE.Color('#cfc8b6');   // Kanpur afternoon haze: dusty, warm
  scene.background = haze;
  scene.fog = new THREE.FogExp2(haze, 0.0021);
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
  scene.environmentIntensity = 0.75;

  const camera = new THREE.PerspectiveCamera(Number(params.get('fov')) || 70, innerWidth / innerHeight, 0.1, 2500);
  scene.add(new THREE.HemisphereLight('#cfdcea', '#7a6a52', 0.35));
  const sun = new THREE.DirectionalLight('#ffe9c7', 3.2);
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
  const detail = new StreetDetail(map, makeOccupancy(map));
  scene.add(detail.group);
  const world = new CollisionWorld(map);
  for (const [x, z] of city.pillars) world.addPost(x, z, 0.9);
  for (const [x, z, r] of detail.obstacles) world.addPost(x, z, r);
  const landmarks = new Landmarks(map);
  scene.add(landmarks.group);
  for (const [x, z, r] of landmarks.posts) world.addPost(x, z, r);
  for (const ring of landmarks.walls) world.addWall(ring, 6);
  const ramu = new Ramu(camera, world, renderer.domElement);
  scene.add(ramu.root);
  // Crowd size comes from the admin portal (admin.html); ?peds=N overrides it for testing.
  const forced = params.has('peds') ? Number(params.get('peds')) || 0 : null;
  const crowdFor = (n: number) => Math.round(n * (desktop ? 1 : 0.5)); // half on touch devices
  const peds = new Pedestrians(map, Math.max(crowdFor(CROWD_MAX), forced ?? 0));
  peds.setCount(forced ?? crowdFor(loadSettings().crowd));
  if (forced === null) onSettingsChange((s) => peds.setCount(crowdFor(s.crowd)));
  scene.add(peds.group);
  const lookDir = new THREE.Vector3();
  const hud = new Hud(map);
  const stats = new Stats(city.roadPoints);
  let paused = false;
  const menu = new Menu({
    map, hud, stats,
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
  if (params.get('spawn')) {
    const [lat, lon] = params.get('spawn')!.split(',').map(Number);
    spawn = project(map, lat, lon);
  }
  let best = spawn, bd = Infinity;
  for (const p of city.roadPoints) {
    const d = Math.hypot(p[0] - spawn[0], p[1] - spawn[1]);
    if (d < bd) [bd, best] = [d, p];
  }
  ramu.position.set(best[0], 0, best[1]);
  ramu.yaw = Math.atan2(best[0] - m[0], best[1] - m[1]); // camera looks toward the metro

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
    if (!fixed) ramu.update(dt);
    if (!fixed && !paused) stats.update(dt, ramu.position.x, ramu.position.z, ramu.speed, ramu.jumps);
    const focus = fixed ? camera.position : ramu.position;
    sun.target.position.set(focus.x, 0, focus.z);
    if (!paused) {
      camera.getWorldDirection(lookDir);
      const l = Math.hypot(lookDir.x, lookDir.z) || 1;
      if (fixed) peds.update(dt, focus.x, focus.z, lookDir.x / l, lookDir.z / l);
      else peds.update(dt, focus.x, focus.z, lookDir.x / l, lookDir.z / l, focus.x, focus.z);
    }
    sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 200);
    if (!fixed) hud.update(ramu.position.x, ramu.position.z, ramu.yaw);
    renderer.info.reset();
    treeUniforms.time.value += dt;
    sky.position.copy(camera.position);
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
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      sun: { value: sunDir.clone() },
      zenith: { value: new THREE.Color('#7f9fc0') },
      horizon: { value: haze.clone() },
      glow: { value: new THREE.Color('#fff0d0') },
    },
    vertexShader: `varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w; // always at the far plane
}`,
    fragmentShader: `uniform vec3 sun, zenith, horizon, glow;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float up = max(d.y, 0.0);
  vec3 col = mix(horizon, zenith, pow(up, 0.45));
  float s = max(dot(d, sun), 0.0);
  col += glow * (pow(s, 8.0) * 0.25 + pow(s, 300.0) * 1.5);
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
