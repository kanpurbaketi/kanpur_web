// The kavi sammelan stage: the poets on their sofas, the reciter at the mic. From the audience, then up on the stage.
// Usage: BASE=... node scripts/stageshot.mjs <outprefix>
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const out = process.argv[2] ?? '/tmp/stage';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
await page.goto(`${BASE}?debug&spawn=mela&time=night&peds=0`);
await page.waitForFunction(() => window.__ready === true && window.__ramu, null, { timeout: 90000 });
await page.waitForTimeout(3000);
// the stage: centre (-202.4, 278.2), its front to the east; the sofas along its back (x about -207)
const shots = [['front', -193.5, 0, 278.2, Math.PI / 2, 0.02], ['on', -201.0, 1.4, 281.5, Math.PI / 2 + 0.5, -0.12], ['side', -203.5, 1.4, 272.6, Math.PI * 0.9, -0.1], ['row', -205.9, 1.4, 273.0, Math.PI - 0.3, -0.12], ['close', -204.3, 1.4, 279.4, Math.PI / 2, -0.18]];
for (const [name, x, y, z, yaw, pitch] of shots) {
  await page.evaluate(([x, y, z, yaw, pitch]) => { const r = window.__ramu; r.position.set(x, y, z); r.yaw = yaw; r.pitch = pitch; }, [x, y, z, yaw, pitch]);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}_${name}.png` });
}
await browser.close();
