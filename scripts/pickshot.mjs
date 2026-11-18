// Ramu picking locks, for a look at the pose: a parked car's door and a parked bike's front disc, from the side and
// three-quarters, a few frames apart. Saves <out>_<kind>_<view>_N.png.
// Usage: BASE=... node scripts/pickshot.mjs <outprefix>
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const out = process.argv[2] ?? '/tmp/pick';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 560, height: 560 } });
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
await page.goto(`${BASE}?debug&spawn=shivaji&time=day&peds=0`);
await page.waitForFunction(() => window.__ready === true && window.__traffic && window.__driving, null, { timeout: 90000 });
await page.waitForTimeout(1500);
for (const kinds of [['swift', 'maruti', 'bolero'], ['pulsar', 'splendor', 'activa']]) {
  const h = await page.evaluate((kinds) => {
    const t = window.__traffic, r = window.__ramu;
    const c = t.cars.find((c) => c.pinned && c.locked && kinds.includes(t.kinds[c.kind].name));
    if (!c) return null;
    const k = t.kinds[c.kind];
    const [x, z] = t.toWorld(c, -(k.halfW + 1.2), 0.5);
    r.position.set(x, 0, z);
    return { h: c.heading, kind: k.name };
  }, kinds);
  if (!h) { console.log(kinds[0], 'none parked'); continue; }
  await page.waitForTimeout(500);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(900);
  for (const [view, dy] of [['side', 0], ['three', 0.7], ['front', 1.5]]) {
    await page.evaluate(([h, dy]) => { const r = window.__ramu; r.yaw = h + Math.PI + dy; r.pitch = -0.12; }, [h.h, dy]);
    for (let i = 0; i < 2; i++) { await page.waitForTimeout(350); await page.screenshot({ path: `${out}_${h.kind}_${view}_${i}.png` }); }
  }
  console.log(h.kind, JSON.stringify(await page.evaluate(() => window.__driving.picking)));
  await page.keyboard.press('KeyE');      // give up
  await page.waitForTimeout(600);
}
await browser.close();
