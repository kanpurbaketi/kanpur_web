// The corridor crowd: how many walkers are held up (meant to be walking, yet hardly moved in 4 s), and where; plus shots
// of Ramu standing on a raised footpath and of a roadside cart with its seller.
// Usage: BASE=... node scripts/stuckcheck.mjs <outprefix>
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const out = process.argv[2] ?? '/tmp/stuck';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
await page.goto(`${BASE}?debug&spawn=shivaji&time=night`);
await page.waitForFunction(() => window.__ready === true && window.__peds, null, { timeout: 90000 });
await page.waitForTimeout(6000);
const snap = () => page.evaluate(() => window.__peds.peds.slice(0, window.__peds.active).map((p) => [p.x, p.z, p.wait > 0 || p.hold > 0 || p.mode || p.out || p.down > 0 ? 0 : 1]));
let total = 0, stuck = 0;
const where = [];
for (let round = 0; round < 4; round++) {
  const a = await snap();
  await page.waitForTimeout(4000);
  const b = await snap();
  a.forEach(([x, z, w], i) => {
    if (!w || !b[i][2]) return;
    total++;
    if (Math.hypot(b[i][0] - x, b[i][1] - z) < 0.5) { stuck++; where.push(`${x.toFixed(1)},${z.toFixed(1)}`); }
  });
}
console.log(`walkers ${total}, held up ${stuck}`, where.slice(0, 12).join('  '));
// Ramu on the footpath: his feet and the slab
for (const x of [-45, -44, -43, -42.5, -35, -34, -33, -32]) {
  await page.evaluate((x) => { const r = window.__ramu; r.position.set(x, 0.3, 200); r.yaw = Math.PI / 2; r.pitch = -0.25; }, x);
  await page.waitForTimeout(300);
  console.log('x', x, 'ramu y', await page.evaluate(() => window.__ramu.position.y.toFixed(3)));
}
await page.evaluate(() => { const r = window.__ramu; r.position.set(-43.3, 0.3, 200); });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}_foot.png` });
await browser.close();
