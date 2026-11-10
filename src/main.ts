import * as THREE from 'three';
import { CollisionWorld } from './player/collide';
import { Ramu } from './player/ramu';
import { Hud } from './ui/hud';
import { City } from './world/city';
import { makeOccupancy, StreetDetail } from './world/streetDetail';
import { MapData, project } from './world/types';

/*
 Debug URL params:
   ?cam=x,y,z,yaw,pitch   fixed camera (meters, radians), player hidden
   ?at=lat,lon,heading    camera at eye height at a real spot, heading in compass degrees (Mapillary photo spots)
   ?spawn=lat,lon         start Ramu at a real spot
   ?debug                 FPS / draw-call overlay
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
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.body.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const haze = new THREE.Color('#d6d3c4');   // Kanpur afternoon haze
  scene.background = haze;
  scene.fog = new THREE.Fog(haze, 120, 700);
  scene.add(skyDome());

  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 2500);
  scene.add(new THREE.HemisphereLight('#dfe6ee', '#8a7a60', 1.1));
  const sun = new THREE.DirectionalLight('#fff1d6', 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 400 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.4;
  scene.add(sun, sun.target);
  const SUN_DIR = new THREE.Vector3(-0.45, 0.75, 0.5).normalize(); // afternoon, sun to the south-west

  const t0 = performance.now();
  const city = new City(map);
  scene.add(city.group);
  const detail = new StreetDetail(map, makeOccupancy(map));
  scene.add(detail.group);
  const world = new CollisionWorld(map);
  for (const [x, z] of city.pillars) world.addPost(x, z, 0.9);
  for (const [x, z, r] of detail.obstacles) world.addPost(x, z, r);
  const ramu = new Ramu(camera, world, renderer.domElement);
  scene.add(ramu.root);
  const hud = new Hud(map);
  console.log(`city built in ${(performance.now() - t0).toFixed(0)} ms`, city.stats);

  // Spawn: near the Moti Jheel metro on the nearest road point.
  let spawn = map.landmarks.moti_jheel_metro ?? [0, 0];
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

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  const clock = new THREE.Clock();
  let frames = 0, acc = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.05, clock.getDelta());
    if (!fixed) ramu.update(dt);
    const focus = fixed ? camera.position : ramu.position;
    sun.target.position.set(focus.x, 0, focus.z);
    sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 200);
    if (!fixed) hud.update(ramu.position.x, ramu.position.z, ramu.yaw);
    renderer.render(scene, camera);
    (window as unknown as { __ready: boolean }).__ready = true;
    frames++;
    acc += dt;
    if (showDebug && acc > 0.5) {
      const i = renderer.info.render;
      debugEl.textContent = `${(frames / acc).toFixed(0)} fps · ${i.calls} calls · ${(i.triangles / 1000).toFixed(0)}k tris · ` +
        `${city.stats.buildings} buildings · x ${focus.x.toFixed(0)} z ${focus.z.toFixed(0)}`;
      frames = 0;
      acc = 0;
    }
  });
}

/** Big inverted sphere with a vertical haze gradient. */
function skyDome(): THREE.Mesh {
  const g = new THREE.SphereGeometry(2000, 24, 12);
  const top = new THREE.Color('#9fb8cf'), bottom = new THREE.Color('#d6d3c4');
  const pos = g.getAttribute('position');
  const cols: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, pos.getY(i) / 2000);
    c.copy(bottom).lerp(top, Math.pow(t, 0.6));
    cols.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
}

main().catch((e) => {
  document.getElementById('status')!.textContent = 'Failed to load: ' + e;
  console.error(e);
});
