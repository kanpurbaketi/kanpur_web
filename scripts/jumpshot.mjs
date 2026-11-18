// Frames through Ramu's jump, seen from the side: a standing jump, then a running one. Saves <out>_stand_N.png, <out>_run_N.png.
// Usage: BASE=... node scripts/jumpshot.mjs <outprefix>
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const out = process.argv[2] ?? '/tmp/jump';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 520, height: 520 } });
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
await page.goto(`${BASE}?debug&spawn=shivaji&time=day&peds=0&traffic=0`);
await page.waitForFunction(() => window.__ready === true && window.__ramu, null, { timeout: 90000 });
await page.waitForTimeout(2500);
const setup = () => page.evaluate(() => { const r = window.__ramu; r.position.set(-34, 0, 120); r.yaw = Math.PI / 2; r.pitch = -0.05; });
await setup();
await page.waitForTimeout(800);
// standing: he faces across the view (the camera looks west; he faces south)
await page.evaluate(() => { window.__ramu.model.rotation.y = Math.PI; });
await page.keyboard.press('Space');
for (let i = 0; i < 9; i++) { await page.screenshot({ path: `${out}_stand_${i}.png` }); await page.waitForTimeout(110); }
await setup();
await page.waitForTimeout(800);
// running south (the camera looks west: he crosses the view), jump mid-run
await page.evaluate(() => { const r = window.__ramu; r.yaw = Math.PI / 2; });
await page.keyboard.down('KeyA');   // strafe left = south when looking west
await page.keyboard.down('ShiftLeft');
await page.waitForTimeout(900);
await page.keyboard.press('Space');
for (let i = 0; i < 9; i++) { await page.screenshot({ path: `${out}_run_${i}.png` }); await page.waitForTimeout(110); }
await page.keyboard.up('KeyA'); await page.keyboard.up('ShiftLeft');
await browser.close();
