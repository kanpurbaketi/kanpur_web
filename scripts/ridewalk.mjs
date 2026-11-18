// Walk Ramu round a ride on a circle and straight at it; reports where he stalls, and whether he gets inside.
// Usage: BASE=... node scripts/ridewalk.mjs <cx> <cz> <radius> [inner]   (inner: the radius he must stay outside)
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const [CX, CZ, RAD, INNER] = process.argv.slice(2, 6).map(Number);
const browser = await chromium.launch({ args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
await page.goto(`${BASE}?debug&spawn=mela&time=night&peds=0`);
await page.waitForFunction(() => window.__ready === true && window.__ramu, null, { timeout: 90000 });
await page.waitForTimeout(1500);
const state = () => page.evaluate(() => { const p = window.__ramu.position; return [p.x, p.y, p.z]; });
// round it, counter-clockwise, steering along the tangent and back to the circle
await page.evaluate(([x, z]) => window.__ramu.position.set(x, 0, z), [CX + RAD, CZ]);
await page.keyboard.down('KeyW');
let stalls = 0, prev = null, travelled = 0;
for (let i = 0; i < 160; i++) {
  await page.evaluate(([CX, CZ, RAD]) => {
    const r = window.__ramu, dx = r.position.x - CX, dz = r.position.z - CZ, d = Math.hypot(dx, dz);
    const k = (RAD - d) * 0.6, tx = -dz / d + (dx / d) * k, tz = dx / d + (dz / d) * k;
    r.yaw = Math.atan2(-tx, -tz);
  }, [CX, CZ, RAD]);
  await page.waitForTimeout(120);
  const s = await state();
  if (prev) {
    const m = Math.hypot(s[0] - prev[0], s[2] - prev[2]);
    travelled += m;
    if (m < 0.02) { stalls++; if (stalls === 4) console.log('stalled at', s.map((v) => v.toFixed(2)).join(' '), 'angle', Math.atan2(s[2] - CZ, s[0] - CX).toFixed(2)); } else stalls = 0;
  }
  prev = s;
}
await page.keyboard.up('KeyW');
console.log('round: travelled', travelled.toFixed(1), 'm of', (2 * Math.PI * RAD).toFixed(1));
// straight at it from eight sides
if (INNER) for (let k = 0; k < 8; k++) {
  const a = (k / 8) * Math.PI * 2;
  await page.evaluate(([x, z, yaw]) => { const r = window.__ramu; r.position.set(x, 0, z); r.yaw = yaw; }, [CX + Math.cos(a) * (INNER + 4), CZ + Math.sin(a) * (INNER + 4), Math.atan2(Math.cos(a), Math.sin(a))]);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(2500); await page.keyboard.up('KeyW');
  const s = await state(), d = Math.hypot(s[0] - CX, s[2] - CZ);
  console.log('from', a.toFixed(2), 'got to', d.toFixed(2), 'from the middle, y', s[1].toFixed(2), d < INNER ? 'INSIDE' : '');
}
await browser.close();
