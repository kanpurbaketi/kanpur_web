// Ramu takes a vehicle: he is put beside the nearest one of a kind, presses E (whoever was on it is thrown off), drives
// it forward a while, and gets off. Screenshots: <outDir>/<kind>_{on,thrown,drive,off}.png
// Usage: node scripts/driveshot.mjs <outDir> <kind,kind,...> [query]
// Needs the dev server (BASE) and ?debug (window.__ramu, __traffic, __driving).
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const [out, kinds, q = 'time=day'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('  console:', m.text()));
await page.goto(`${BASE}?debug&spawn=metro&${q}`);
await page.waitForFunction(() => window.__ready === true && window.__traffic && window.__driving, null, { timeout: 90000 });
await page.waitForTimeout(5000);
const info = () => page.evaluate(() => {
  const d = window.__driving, c = d.car;
  return c ? { kind: window.__traffic.kindOf(c), v: +c.v.toFixed(1), x: +c.x.toFixed(1), z: +c.z.toFixed(1) } : null;
});
for (const kind of kinds.split(',')) {
  // stand Ramu beside the nearest vehicle of the kind, stopping it
  const ok = await page.evaluate((kind) => {
    const t = window.__traffic, r = window.__ramu;
    const ki = t.kinds.findIndex((k) => k.name === kind);
    const c = t.cars.filter((c) => c.kind === ki && !c.fresh && !c.player)
      .sort((a, b) => Math.hypot(a.x - r.position.x, a.z - r.position.z) - Math.hypot(b.x - r.position.x, b.z - r.position.z))[0];
    if (!c) return false;
    c.vmax = 0; c.v = 0;
    const k = t.kinds[ki];
    const [x, z] = t.toWorld(c, -(k.halfW + 0.8), 0);
    r.position.set(x, 0, z);
    r.yaw = c.heading + Math.PI / 2 + 0.6;
    return true;
  }, kind);
  if (!ok) { console.log('none on the road:', kind); continue; }
  await page.waitForTimeout(600);
  console.log(kind, 'tip:', await page.textContent('#use-tip'));
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${kind}_thrown.png` });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${kind}_on.png` });
  console.log('  on:', JSON.stringify(await info()));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyA');
  await page.screenshot({ path: `${out}/${kind}_drive.png` });
  console.log('  driving:', JSON.stringify(await info()));
  await page.keyboard.up('KeyW');
  await page.keyboard.down('Space');
  await page.waitForTimeout(2500);
  await page.keyboard.up('Space');
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${kind}_off.png` });
  console.log('  off:', JSON.stringify(await info()), await page.textContent('#debug'));
}
await browser.close();
