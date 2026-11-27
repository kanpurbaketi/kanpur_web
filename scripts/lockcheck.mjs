// Lock picking (stage 1): stands Ramu by a parked car, a parked bike and a parked cycle and holds E-free still; times how
// long until he is on it. Then starts on a car and walks off: it must stop. Screenshot of the progress tip.
// Usage: BASE=http://localhost:5187/ node scripts/lockcheck.mjs [outdir]
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const out = process.argv[2] ?? '/tmp';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
await page.goto(`${BASE}?debug&spawn=shivaji&time=day&peds=0`);
await page.waitForFunction(() => window.__ready === true && window.__traffic && window.__driving, null, { timeout: 90000 });
await page.waitForTimeout(1500);
const counts = await page.evaluate(() => {
  const t = window.__traffic, c = {};
  for (const v of t.cars) if (v.pinned) c[t.kinds[v.kind].name] = (c[t.kinds[v.kind].name] ?? 0) + 1;
  return c;
});
console.log('parked', JSON.stringify(counts));
const goTo = (kind) => page.evaluate((kind) => {
  const t = window.__traffic, r = window.__ramu;
  const c = t.cars.find((c) => c.pinned && c.locked && t.kinds[c.kind].name === kind);
  if (!c) return null;
  const k = t.kinds[c.kind];
  const [x, z] = t.toWorld(c, -(k.halfW + 0.5), 0);
  r.position.set(x, 0, z);
  return [c.x, c.z];
}, kind);
for (const kind of ['cycle', 'pulsar', 'swift']) {
  if (!(await goTo(kind))) { console.log(kind, 'none parked'); continue; }
  await page.waitForTimeout(400);
  const t0 = Date.now();
  await page.keyboard.press('KeyE');
  let shot = false;
  while (!(await page.evaluate(() => !!window.__driving.car)) && Date.now() - t0 < 45000) {
    if (!shot && Date.now() - t0 > 4000 && kind === 'swift') { await page.screenshot({ path: `${out}/lock_${kind}.png` }); shot = true; }
    await page.waitForTimeout(250);
  }
  const on = await page.evaluate(() => !!window.__driving.car);
  console.log(kind, on ? `on it after ${((Date.now() - t0) / 1000).toFixed(1)} s` : 'never got on');
  if (on) { await page.keyboard.press('KeyE'); await page.waitForTimeout(1500); }
}
// start on a car, then walk away: picking stops
if (await page.evaluate(() => { const t = window.__traffic; return t.cars.filter((c) => c.pinned && c.locked && t.seatOf(c).pose !== 'ride').length > 0; })) {
  await goTo('maruti') ?? await goTo('bolero') ?? await goTo('ambassador');
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(2000);
  const during = await page.evaluate(() => window.__driving.picking);
  await page.keyboard.down('KeyS'); await page.waitForTimeout(800); await page.keyboard.up('KeyS');
  const after = await page.evaluate(() => window.__driving.picking);
  console.log('walk off: picking during', JSON.stringify(during), 'after', JSON.stringify(after));
}
await browser.close();
