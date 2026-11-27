// Walk Ramu up the round stair of the maut ka kuan, steering along it; logs where he is as he goes.
// Usage: BASE=... node scripts/kuanclimb.mjs [shot.png]
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
await page.goto(`${BASE}?debug&spawn=mela&time=night&peds=0`);
await page.waitForFunction(() => window.__ready === true && window.__ramu, null, { timeout: 90000 });
await page.waitForTimeout(2000);
const KX = -112.5, KZ = 300, RM = 14.9, A0 = 2.356;
// the well's frame is turned by -pi/2: world = (KX - lz, KZ + lx)
const W = (a, r) => [KX - Math.sin(a) * r, KZ + Math.cos(a) * r];
await page.evaluate(([x, z]) => { const r = window.__ramu; r.position.set(x, 0, z); }, W(A0 + 0.12, RM));
await page.keyboard.down('KeyW');
let last = null;
for (let i = 0; i < 120; i++) {
  const s = await page.evaluate(([KX, KZ, RM]) => {
    const r = window.__ramu, lx = r.position.z - KZ, lz = KX - r.position.x;
    const a = Math.atan2(lz, lx), rr = Math.hypot(lx, lz);
    // along the stair (the angle falls as it climbs), steered back to the middle of the treads
    // at the landing (the stair's end, a < A0 - 3.33) turn in onto the gallery
    const k = a < 2.356 - 3.36 ? -3 : (RM - rr) * 0.8;
    const dx = Math.cos(a) - Math.sin(a) * k, dz = Math.sin(a) + Math.cos(a) * k;
    r.yaw = Math.atan2(-dx, -dz);
    return { a: +a.toFixed(3), r: +rr.toFixed(2), y: +r.position.y.toFixed(2) };
  }, [KX, KZ, RM]);
  if (i % 4 === 0) console.log(JSON.stringify(s));
  if (last && Math.abs(s.a - last.a) < 0.002 && Math.abs(s.r - last.r) < 0.01 && i > 6) { console.log('STUCK', JSON.stringify(s)); break; }
  last = s;
  await page.waitForTimeout(250);
}
await page.keyboard.up('KeyW');
if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
await browser.close();
