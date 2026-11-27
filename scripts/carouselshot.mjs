// The carousel (ghoda jhoola) in the mela: from across the aisle, close by the platform, and a moment later (it turns,
// the horses rise and fall). Usage: BASE=... node scripts/carouselshot.mjs <outprefix> [day|night]
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const out = process.argv[2] ?? '/tmp/carousel';
const time = process.argv[3] ?? 'night';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
await page.goto(`${BASE}?debug&spawn=mela&time=${time}&peds=0`);
await page.waitForFunction(() => window.__ready === true && window.__ramu, null, { timeout: 90000 });
await page.waitForTimeout(3000);
const CX = -200.36, CZ = 300.4;              // melaSite CAROUSEL
// [name, distance, bearing from the ride, eye pitch]
const shots = [['far', 15, 0.3, 0.12], ['near', 7.5, 1.2, 0.05], ['near2', 7.5, 1.2, 0.05], ['up', 6.5, 2.4, 0.4], ['riders', 5.4, 0.8, -0.05]];
for (const [name, d, a, pitch] of shots) {
  await page.evaluate(([x, z, a, pitch]) => { const r = window.__ramu; r.position.set(x, 0, z); r.yaw = a; r.pitch = pitch; r.model.visible = pitch > -0.01; },
    [CX + Math.sin(a) * d, CZ + Math.cos(a) * d, a, pitch]);
  await page.waitForTimeout(name === 'near2' ? 1600 : 1000);
  await page.screenshot({ path: `${out}_${name}.png` });
}
await browser.close();
