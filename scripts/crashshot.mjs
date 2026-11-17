// Damage: Ramu takes a vehicle, it is put on an open road heading at a wall, and driven into it again and again.
// Prints the damage after each hit and screenshots the dents and the smoke.
// Usage: node scripts/crashshot.mjs <outDir> <kind> [query] [hits]
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const [out, kind, q = 'time=day', hits = '5'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
await page.goto(`${BASE}?debug&spawn=metro&${q}`);
await page.waitForFunction(() => window.__ready === true && window.__traffic && window.__driving, null, { timeout: 90000 });
await page.waitForTimeout(4000);
const ok = await page.evaluate((kind) => {
  const t = window.__traffic, r = window.__ramu;
  const ki = t.kinds.findIndex((k) => k.name === kind);
  const c = t.cars.filter((c) => c.kind === ki && !c.fresh && !c.player)[0];
  if (!c) return false;
  c.vmax = 0; c.v = 0;
  const [x, z] = t.toWorld(c, -(t.kinds[ki].halfW + 0.8), 0);
  r.position.set(x, 0, z);
  return true;
}, kind);
if (!ok) { console.log('none on the road:', kind); process.exit(0); }
await page.waitForTimeout(400);
await page.keyboard.press('KeyE');
await page.waitForTimeout(1000);
for (let i = 0; i < Number(hits); i++) {
  // run up at the nearest wall straight ahead: drive until it stops, then back off
  await page.keyboard.down('KeyW');
  for (let t = 0; t < 30; t++) {
    await page.waitForTimeout(150);
    const v = await page.evaluate(() => window.__driving.car.v);
    if (t > 8 && v < 0.5) break;
  }
  await page.keyboard.up('KeyW');
  const st = await page.evaluate(() => { const c = window.__driving.car; return `damage ${c.damage.toFixed(0)} broken ${c.broken}`; });
  console.log('hit', i + 1, st);
  await page.screenshot({ path: `${out}/${kind}_crash_${i + 1}.png` });
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(1600);
  await page.keyboard.up('KeyS');
  await page.waitForTimeout(400);
}
await page.evaluate(() => { const r = window.__ramu, c = window.__driving.car; r.yaw = c.heading + 0.4; r.pitch = -0.3; const cam = r.camera; cam.fov = 38; cam.updateProjectionMatrix(); });
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/${kind}_crash_front.png` });
await browser.close();
