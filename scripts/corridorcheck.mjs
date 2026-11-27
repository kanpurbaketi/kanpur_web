// Stage 1 containment: from just inside every edge of the corridor (src/world/stage1Route.ts CORRIDOR), Ramu runs and
// jumps straight at it, then rides a bike flat out at it. Prints any spot where he ended up outside.
// Usage: node scripts/corridorcheck.mjs [bike=1]
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const bike = process.argv[2] !== '0';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
await page.goto(`${BASE}?debug&spawn=shivaji&time=day&peds=0`);
await page.waitForFunction(() => window.__ready === true && window.__traffic && window.__driving, null, { timeout: 90000 });
await page.waitForTimeout(2000);
const ring = await page.evaluate(() => window.__corridor);
const inside = (x, z) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
// test spots: along every edge, 2.5 m in, facing out
const spots = [];
for (let i = 0; i < ring.length; i++) {
  const a = ring[i], b = ring[(i + 1) % ring.length];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
  for (let s = 2; s < L - 2; s += Math.max(4, L / 5)) {
    for (const k of [1, -1]) {
      const x = a[0] + dx * s - dz * k * 2.5, z = a[1] + dz * s + dx * k * 2.5;
      if (inside(x, z)) spots.push({ x, z, ox: dz * k, oz: -dx * k, edge: i });
    }
  }
}
console.log('edges', ring.length, 'spots', spots.length);
let bad = 0;
for (const p of spots) {
  await page.evaluate(({ x, z, ox, oz }) => { const r = window.__ramu; r.position.set(x, 0, z); r.yaw = Math.atan2(-ox, -oz); }, p);
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  for (let k = 0; k < 4; k++) { await page.waitForTimeout(250); await page.keyboard.press('Space'); }
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  const at = await page.evaluate(() => [window.__ramu.position.x, window.__ramu.position.z]);
  if (!inside(at[0], at[1])) { bad++; console.log('  OUT on foot: edge', p.edge, 'from', p.x.toFixed(1), p.z.toFixed(1), '->', at.map((v) => v.toFixed(1)).join(',')); }
}
console.log('on foot: out', bad, 'of', spots.length);
if (bike) {
  // take a two-wheeler, then ride it at the edges from 25 m in
  let rideBad = 0, tried = 0;
  for (const p of spots.filter((_, i) => i % 3 === 0)) {
    const x = p.x - p.ox * 22, z = p.z - p.oz * 22;
    if (!inside(x, z)) continue;
    const ok = await page.evaluate(({ x, z, ox, oz }) => {
      const d = window.__driving, t = window.__traffic, r = window.__ramu;
      if (!d.car) {
        const ki = t.kinds.findIndex((k) => k.name === 'pulsar');
        const c = t.cars.find((c) => c.kind === ki && !c.fresh && !c.player);
        if (!c) return false;
        c.vmax = 0; c.v = 0; c.locked = false;   // (a parked one is locked: no lock to pick in this test)
        const [sx, sz] = t.toWorld(c, -(t.kinds[ki].halfW + 0.8), 0);
        r.position.set(sx, 0, sz);
      }
      return true;
    }, { x, z, ox: p.ox, oz: p.oz });
    if (!ok) { console.log('  no bike to take'); break; }
    if (await page.evaluate(() => !window.__driving.car)) { await page.waitForTimeout(300); await page.keyboard.press('KeyE'); await page.waitForTimeout(1200); }
    if (await page.evaluate(() => !window.__driving.car)) { console.log('  could not get on'); break; }
    await page.evaluate(({ x, z, ox, oz }) => {
      const c = window.__driving.car;
      c.x = x; c.z = z; c.heading = Math.atan2(ox, oz); c.v = 0;
      c.sim = null;   // rebuilt from x, z, heading at the next step
    }, { x, z, ox: p.ox, oz: p.oz });
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(3500);
    await page.keyboard.up('KeyW');
    const at = await page.evaluate(() => [window.__driving.car.x, window.__driving.car.z]);
    tried++;
    if (!inside(at[0], at[1])) { rideBad++; console.log('  OUT on a bike: edge', p.edge, '->', at.map((v) => v.toFixed(1)).join(',')); }
  }
  console.log('on a bike: out', rideBad, 'of', tried);
}
await browser.close();
