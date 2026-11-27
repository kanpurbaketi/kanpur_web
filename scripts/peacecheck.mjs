// Nobody attacks Ramu for nothing: he stands 25 s at the Shivaji gate and among the street crowd (no harm), then inside
// the mela, where its guards go for him. Prints health and who is after him.
// Usage: BASE=http://localhost:5187/ node scripts/peacecheck.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
for (const spawn of ['shivaji', 'inside']) {
  await page.goto(`${BASE}?debug&spawn=${spawn}&time=day`);
  await page.waitForFunction(() => window.__ready === true && window.__health, null, { timeout: 90000 });
  await page.waitForTimeout(25000);
  const r = await page.evaluate(() => ({
    health: window.__health.value,
    kinds: (() => { const c = {}; for (const p of window.__peds.peds) c[p.rig] = (c[p.rig] ?? 0) + 1; return c; })(),
    melaKinds: (() => { const c = {}; for (const p of window.__melaCrowd.peds) c[p.rig] = (c[p.rig] ?? 0) + 1; return c; })(),
    after: [...window.__peds.peds, ...window.__melaCrowd.peds].filter((p) => p.mode === 1).map((p) => p.rig),
  }));
  console.log(spawn, JSON.stringify(r));
}
await browser.close();
