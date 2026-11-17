// Vehicle physics telemetry: Ramu takes a vehicle of each kind and runs a fixed drill (full throttle, a turn, the hand
// brake mid-turn, the brakes to a stop), printing the sim state every 0.5 s and a screenshot after the slide.
// Usage: node scripts/simcheck.mjs <outDir> <kind,kind,...> [query]
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const [out, kinds, q = 'time=day'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
await page.goto(`${BASE}?debug&spawn=metro&${q}`);
await page.waitForFunction(() => window.__ready === true && window.__traffic && window.__driving, null, { timeout: 90000 });
await page.waitForTimeout(4000);
const state = () => page.evaluate(() => {
  const c = window.__driving.car, b = c?.sim;
  if (!b) return 'no sim';
  const f = (v, n = 1) => (+v).toFixed(n);
  return `v ${f(b.vx)} vy ${f(b.vy)} yaw ${f(b.yaw, 2)} steer ${f(b.steer, 2)} slip ${f(b.slipF, 1)}/${f(b.slipR, 1)} g${b.gear} ${Math.round(b.rpm)}rpm knock ${f(b.knock)} road ${window.__traffic.onRoad(c.x, c.z) ? 1 : 0}`;
});
const hold = async (keys, ms, label) => {
  for (const k of keys) await page.keyboard.down(k);
  for (let t = 0; t < ms; t += 500) {
    await page.waitForTimeout(500);
    console.log(`  ${label} ${((t + 500) / 1000).toFixed(1)}s`, await state());
  }
  for (const k of keys) await page.keyboard.up(k);
};
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
  await page.waitForTimeout(800);
  console.log(kind);
  await hold(['KeyW'], 4000, 'throttle');
  await hold(['KeyW', 'KeyA'], 1500, 'turn    ');
  await hold(['KeyA', 'Space'], 1500, 'handbrk ');
  await page.screenshot({ path: `${out}/${kind}_slide.png` });
  await hold(['KeyS'], 2500, 'brake   ');
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(800);
}
await browser.close();
