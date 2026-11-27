// Ramu's pose on each vehicle, standing still: side, front three-quarter, and steering hard left (hands follow the
// bars / wheel), plus a frame halfway through getting on.
// Usage: node scripts/poseshot.mjs <outDir> <kind,...> [query] [x,z: an open spot to take it to]
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const [out, kinds, q = 'time=day', where] = process.argv.slice(2);
const at = where ? where.split(',').map(Number) : null;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
await page.goto(`${BASE}?debug&spawn=metro&${q}`);
await page.waitForFunction(() => window.__ready === true && window.__traffic && window.__driving, null, { timeout: 90000 });
await page.waitForTimeout(4000);
const view = (yawOff, pitch) => page.evaluate(([yawOff, pitch]) => {
  const r = window.__ramu, c = window.__driving.car;
  r.yaw = c.heading + yawOff;
  r.pitch = pitch;
}, [yawOff, pitch]);
for (const kind of kinds.split(',')) {
  const ok = await page.evaluate((kind) => {
    const t = window.__traffic, r = window.__ramu;
    const ki = t.kinds.findIndex((k) => k.name === kind);
    const c = t.cars.filter((c) => c.kind === ki && !c.fresh && !c.player)
      .sort((a, b) => Math.hypot(a.x - r.position.x, a.z - r.position.z) - Math.hypot(b.x - r.position.x, b.z - r.position.z))[0];
    if (!c) return false;
    c.vmax = 0; c.v = 0;
    const [x, z] = t.toWorld(c, -(t.kinds[ki].halfW + 0.8), 0);
    r.position.set(x, 0, z);
    return true;
  }, kind);
  if (!ok) { console.log('none on the road:', kind); continue; }
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyE');
  // on it: moved to an open spot (?at=x,z), so the camera has room
  if (at) await page.evaluate(([x, z]) => { const c = window.__driving.car; c.x = x; c.z = z; }, at);
  await page.waitForTimeout(330);
  await view(-Math.PI / 2, -0.12);
  await page.screenshot({ path: `${out}/${kind}_mount.png` });
  await page.waitForTimeout(900);
  await view(-Math.PI / 2, -0.12);
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${out}/${kind}_side.png` });
  await view(-0.7, -0.25);
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${out}/${kind}_front.png` });
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(500);
  await view(-0.5, -0.45);
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${out}/${kind}_steer.png` });
  await page.keyboard.up('KeyA');
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${kind}_dismount.png` });
  await page.waitForTimeout(900);
  console.log(kind, 'done', await page.evaluate(() => !!window.__driving.car));
}
await browser.close();
