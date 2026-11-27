// Close-ups of the traffic, one kind of vehicle at a time: the nearest one of each kind is stopped and photographed from
// its front-left and from its side.
// Usage: node scripts/kindshot.mjs <outDir> <kind,kind,...> [query, e.g. time=day]
// Needs the dev server (BASE) and ?debug (window.__traffic, window.__camera).
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const [out, kinds, q = 'time=day'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('  console:', m.text()));
await page.goto(`${BASE}?debug&peds=0&cam=${process.env.CAM ?? '0,3,260'},0,0&fov=30&${q}`);
await page.waitForFunction(() => window.__ready === true && window.__traffic, null, { timeout: 90000 });
await page.waitForTimeout(6000);
await page.evaluate(() => { for (const c of window.__traffic.cars) { c.vmax = 0; c.v = 0; } });
await page.waitForTimeout(800);
for (const kind of kinds.split(',')) {
  for (const [tag, fwd, side, up] of [['a', 4.2, 3.2, 1.7], ['b', 0, 5.5, 1.2]]) {
    const ok = await page.evaluate(([kind, fwd, side, up]) => {
      const t = window.__traffic, cam = window.__camera;
      const ki = t.kinds.findIndex((k) => k.name === kind);
      const c = t.cars.filter((c) => c.kind === ki && !c.fresh).sort((a, b) => Math.hypot(a.x - cam.position.x, a.z - cam.position.z) - Math.hypot(b.x - cam.position.x, b.z - cam.position.z))[0];
      if (!c) return false;
      const L = t.kinds[ki].halfL / 1.6;
      const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
      // (fz, -fx) is the vehicle's left
      cam.position.set(c.x + fx * fwd * L + fz * side * Math.max(1, L), up * Math.max(1, L * 0.8), c.z + fz * fwd * L - fx * side * Math.max(1, L));
      cam.lookAt(c.x, 0.8 * Math.max(1, L * 0.7), c.z);
      return true;
    }, [kind, fwd, side, up]);
    if (!ok) { console.log('none on the road:', kind); break; }
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${out}/${kind}_${tag}.png` });
  }
}
console.log(await page.textContent('#debug'));
await browser.close();
