// The owner comes for Ramu at their car: starts picking a parked car's lock with an owner forced (nearest person) who
// notices at once; reports whether they chase, how far they were, and his health after 12 s.
// Usage: BASE=... node scripts/ownercheck.mjs [shot.png]
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
await page.goto(`${BASE}?debug&spawn=shivaji&time=day`);
await page.waitForFunction(() => window.__ready === true && window.__traffic && window.__driving && window.__peds, null, { timeout: 90000 });
await page.waitForTimeout(6000);
const start = await page.evaluate(() => {
  const t = window.__traffic, r = window.__ramu, peds = window.__peds;
  const cars = t.cars.filter((c) => c.pinned && c.locked && t.seatOf(c).pose !== 'ride');
  // the car with somebody nearest it
  let best = null, bd = 1e9;
  for (const c of cars) { const i = peds.ownerNear(c.x, c.z, 25); if (i >= 0) { const w = peds.where(i), d = Math.hypot(w.x - c.x, w.z - c.z); if (d < bd) { bd = d; best = c; } } }
  if (!best) return null;
  const k = t.kinds[best.kind];
  const [x, z] = t.toWorld(best, -(k.halfW + 0.5), 0);
  r.position.set(x, 0, z);
  return { car: t.kinds[best.kind].name, ownerAt: bd.toFixed(1) };
});
console.log('start', JSON.stringify(start));
await page.waitForTimeout(400);
await page.keyboard.press('KeyE');
await page.evaluate(() => { const d = window.__driving, k = d.pick, c = k.car; k.owner = window.__peds.ownerNear(c.x, c.z, 25); k.notice = 0.5; });
await page.waitForTimeout(1500);
const tip = await page.textContent('#use-tip');
await page.waitForTimeout(10000);
if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
console.log('tip', JSON.stringify(tip), JSON.stringify(await page.evaluate(() => ({
  health: window.__health.value, picking: window.__driving.picking,
  after: window.__peds.peds.filter((p) => p.grudge > 0).map((p) => ({ rig: p.rig, mode: p.mode, d: Math.hypot(p.x - window.__ramu.position.x, p.z - window.__ramu.position.z).toFixed(1) })),
}))));
await browser.close();
