// Tail and brake lamps of parked vehicles at night, from behind and above (as when driving) and from behind at eye height.
// Usage: BASE=... node scripts/tailshot.mjs <outprefix> [kind,kind]
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const out = process.argv[2] ?? '/tmp/tail';
const kinds = (process.argv[3] ?? 'swift,bolero').split(',');
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
await page.goto(`${BASE}?debug&spawn=shivaji&time=night&peds=0`);
await page.waitForFunction(() => window.__ready === true && window.__traffic, null, { timeout: 90000 });
await page.waitForTimeout(1500);
for (const kind of kinds) {
  const ok = await page.evaluate((kind) => {
    const t = window.__traffic, r = window.__ramu;
    const c = t.cars.find((c) => (c.pinned || c.parked) && t.kinds[c.kind].name === kind);
    if (!c) return false;
    const k = t.kinds[c.kind];
    const [x, z] = t.toWorld(c, 0, -(k.halfL + 2.4));
    r.position.set(x, 0, z);
    r.yaw = c.heading + Math.PI;              // looking along its heading, at its back
    clearInterval(window.__brake);
    window.__brake = setInterval(() => { c.lamps = 1; }, 2);
    return true;
  }, kind);
  if (!ok) { console.log(kind, 'none parked'); continue; }
  for (const [name, pitch] of [['eye', 0.02], ['above', -0.5]]) {
    await page.evaluate((p) => { window.__ramu.pitch = p; window.__ramu.model.visible = false; }, pitch);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}_${kind}_${name}.png` });
  }
}
await browser.close();
