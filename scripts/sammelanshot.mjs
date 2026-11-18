// The kavi sammelan from the audience's side and from behind / above. Usage: BASE=... node scripts/sammelanshot.mjs <outprefix>
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const out = process.argv[2] ?? '/tmp/sammelan';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
await page.goto(`${BASE}?debug&spawn=mela&time=night&peds=0`);
await page.waitForFunction(() => window.__ready === true && window.__ramu, null, { timeout: 90000 });
await page.waitForTimeout(3000);
// the stage: centre (-202.4, 278.2), its front to the east, the audience east of it
const shots = process.env.SHOTS ? JSON.parse(process.env.SHOTS) : [['aud', -172, 0, 278.2, Math.PI / 2, 0.08], ['corner', -168, 0, 296, Math.PI / 2 + 0.75, 0.15], ['back', -222, 0, 262, -Math.PI / 4 - 0.2, 0.1], ['side', -185, 0, 300, Math.PI * 0.95, 0.15]];
for (const [name, x, y, z, yaw, pitch] of shots) {
  await page.evaluate(([x, y, z, yaw, pitch]) => { const r = window.__ramu; r.position.set(x, y, z); r.yaw = yaw; r.pitch = pitch; }, [x, y, z, yaw, pitch]);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}_${name}.png` });
}
await browser.close();
