// Screenshot the running game after placing Ramu somewhere (needs ?debug, which exposes window.__ramu).
// Usage: node scripts/playshot.mjs <out.png> "<query>" "<x,y,z,yaw,pitch>" [waitMs] [js]
//   js: an expression run in the page after the wait (e.g. to move Ramu next to somebody); a further second is then waited
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const [out, q, pose, wait, js] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => m.type() === 'error' && console.log('  console:', m.text()));
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
await page.goto(`${BASE}?debug&${q}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
if (pose) {
  const [x, y, z, yaw, pitch] = pose.split(',').map(Number);
  await page.evaluate(([x, y, z, yaw, pitch]) => { const r = window.__ramu; r.position.set(x, y, z); r.yaw = yaw; r.pitch = pitch; }, [x, y, z, yaw, pitch]);
}
await page.waitForTimeout(Number(wait ?? 1500));
if (js) { console.log('  js:', JSON.stringify(await page.evaluate(js))); await page.waitForTimeout(1000); }
await page.screenshot({ path: out });
console.log('saved', out, await page.textContent('#debug'));
await browser.close();
