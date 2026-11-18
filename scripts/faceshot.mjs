// Faces that talk and blink: each character's model held close in front of the camera, talking and blinking,
// photographed a few moments apart (mouth open / shut, eyes open / shut). Saves <out>_<n>.png.
// Usage: BASE=... node scripts/faceshot.mjs <outprefix> [rig,rig,...]
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const out = process.argv[2] ?? '/tmp/face';
const rigs = (process.argv[3] ?? 'ramu,uncle,security,college_girl,college_boy,aunty').split(',');
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 360 } });
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('  console:', m.text()); });
await page.goto(`${BASE}?debug&spawn=mela&time=night&peds=0`);
await page.waitForFunction(() => window.__ready === true && window.__ramu && window.__camera, null, { timeout: 90000 });
await page.waitForTimeout(1000);
const n = await page.evaluate(async (rigs) => {
  const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
  const { clone } = await import('/node_modules/three/examples/jsm/utils/SkeletonUtils.js');
  const { Face } = await import('/src/world/face.ts');
  const cam = window.__camera, scene = window.__ramu.root.parent;
  window.__ramu.model.visible = false;
  const people = [];
  for (const r of rigs) {
    const gltf = await new GLTFLoader().loadAsync(`models/${r}_rig.glb`);
    const body = clone(gltf.scene);
    body.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    const face = new Face(body);
    face.talking = true; face.blinking = true;
    const holder = new gltf.scene.constructor();
    holder.add(body);
    scene.add(holder);
    people.push({ holder, face, top: { ramu: 1.52, uncle: 1.66, security: 1.72, college_girl: 1.58, college_boy: 1.7, aunty: 1.56 }[r] });
  }
  let t = performance.now();
  const tick = () => {
    const now = performance.now(), dt = (now - t) / 1000; t = now;
    cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements, right = [e[0], e[1], e[2]], up = [e[4], e[5], e[6]], fwd = [-e[8], -e[9], -e[10]];
    people.forEach((p, i) => {
      const s = (i - (people.length - 1) / 2) * 0.2, d = 0.42;
      p.holder.position.set(cam.position.x + fwd[0] * d + right[0] * s, cam.position.y + fwd[1] * d + right[1] * s - (p.top - 0.12), cam.position.z + fwd[2] * d + right[2] * s);
      p.holder.rotation.set(0, Math.atan2(-fwd[0], -fwd[2]), 0);       // the file faces +z: turned to the camera
      p.face.update(dt);
    });
    requestAnimationFrame(tick);
  };
  tick();
  return people.map((p) => p.face.has);
}, rigs);
console.log('faces found', JSON.stringify(n));
await page.evaluate(() => { window.__ramu.pitch = 0; });
for (let i = 0; i < 6; i++) { await page.waitForTimeout(230); await page.screenshot({ path: `${out}_${i}.png` }); }
await browser.close();
