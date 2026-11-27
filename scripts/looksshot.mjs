// Line up every look of the rigged people (see LOOKS in src/world/actors.ts) in front of the camera and screenshot them.
// Usage: node scripts/looksshot.mjs <out.png> [query, e.g. time=day]
// Needs the dev server (BASE) and ?debug (window.__ramu, window.__camera).
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const [out, q = 'time=day'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 720 } });
page.on('console', (m) => m.type() === 'error' && console.log('  console:', m.text()));
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
await page.goto(`${BASE}?debug&peds=0&traffic=0&fov=30&${q}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
await page.waitForTimeout(1500);
const n = await page.evaluate(async () => {
  const { makeActors } = await import('/src/world/actors.ts');
  const people = [...await makeActors('uncle', 4), ...await makeActors('aunty', 6), ...await makeActors('girl', 6), ...await makeActors('boy', 6), ...await makeActors('security', 4), ...await makeActors('goon', 2)];
  const ramu = window.__ramu, cam = window.__camera, scene = ramu.root.parent;
  for (const c of scene.children) if (!c.isLight) c.visible = false;      // nothing but the line-up, under the game's own lights
  cam.updateMatrixWorld();
  const e = cam.matrixWorld.elements;
  const right = [e[0], e[2]], fwd = [-e[8], -e[10]];
  const fl = Math.hypot(fwd[0], fwd[1]), rl = Math.hypot(right[0], right[1]);
  people.forEach((a, i) => {
    const s = (i - (people.length - 1) / 2) * 0.95;
    a.root.position.set(cam.position.x + fwd[0] / fl * 28 + right[0] / rl * s, ramu.position.y - 3.5, cam.position.z + fwd[1] / fl * 28 + right[1] / rl * s);
    a.root.rotation.y = Math.atan2(fwd[0], fwd[1]);      // facing the camera
    a.play(i % 2 ? 'look_around' : 'idle');
    scene.add(a.root);
  });
  let t = performance.now();
  const tick = () => { const now = performance.now(); for (const a of people) a.update((now - t) / 1000); t = now; requestAnimationFrame(tick); };
  tick();
  return people.length;
});
await page.waitForTimeout(1500);
await page.screenshot({ path: out });
console.log('saved', out, n, 'people');
await browser.close();
