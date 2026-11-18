// Walk Ramu west at the sammelan's east fence: blocked beside the gate, through it at the gate.
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
await page.goto(`${BASE}?debug&spawn=mela&time=night&peds=0`);
await page.waitForFunction(() => window.__ready === true && window.__ramu, null, { timeout: 90000 });
await page.waitForTimeout(2000);
for (const z of [270, 278.2, 286]) {
  await page.evaluate((z) => { const r = window.__ramu; r.position.set(-176, 0, z); r.yaw = Math.PI / 2; }, z);
  await page.waitForTimeout(300);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(2500); await page.keyboard.up('KeyW');
  console.log('z', z, 'x after', await page.evaluate(() => window.__ramu.position.x.toFixed(2)));
}
await page.evaluate(() => { const r = window.__ramu; r.position.set(-186.7, 0, 259.5); r.yaw = Math.PI; r.pitch = 0.15; });
await page.waitForTimeout(1000);
await page.screenshot({ path: process.argv[2] });
await browser.close();
