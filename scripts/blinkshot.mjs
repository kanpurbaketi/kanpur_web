// AI indicators: finds a vehicle of the traffic indicating (choosing a turn at the next junction), puts the camera
// behind it and screenshots two moments of the blink. Usage: node scripts/blinkshot.mjs <outDir> [query]
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const [out, q = 'time=night'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
await page.goto(`${BASE}?debug&spawn=metro&${q}`);
await page.waitForFunction(() => window.__ready === true && window.__traffic, null, { timeout: 90000 });
await page.waitForTimeout(4000);
for (let tries = 0; tries < 40; tries++) {
  const got = await page.evaluate(() => {
    const t = window.__traffic, r = window.__ramu;
    const c = t.cars.find((c) => !c.fresh && !c.player && (c.lamps & 12) && t.kinds[c.kind].name !== 'cycle' && t.kinds[c.kind].name !== 'rickshaw'
      && Math.hypot(c.x - r.position.x, c.z - r.position.z) < 60);
    if (!c) return null;
    // Ramu stands behind it, looking along it
    const k = t.kinds[c.kind];
    const [x, z] = t.toWorld(c, 0, -k.halfL - 4.5);
    r.position.set(x, 0, z);
    r.yaw = c.heading + Math.PI;
    return `${k.name} lamps ${c.lamps} v ${c.v.toFixed(1)}`;
  });
  if (got) {
    console.log(got);
    for (const i of [0, 1, 2]) {
      await page.screenshot({ path: `${out}/blink_${i}.png` });
      await page.waitForTimeout(220);
    }
    break;
  }
  await page.waitForTimeout(500);
}
await browser.close();
