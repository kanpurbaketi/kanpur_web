// Checks that nothing passes through anything: counts people standing inside each other and vehicles inside each other
// over 12 s, then puts Ramu right on top of the nearest person and sees him pushed off.
// Usage: node scripts/solidshot.mjs <spawn: metro | inside> <out.png>   (dev server on BASE, ?debug)
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const [spawn, out] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
await page.goto(`${BASE}?debug&spawn=${spawn}&time=day`);
await page.waitForFunction(() => window.__ready === true && window.__peds, null, { timeout: 90000 });
await page.waitForTimeout(4000);
// overlaps: people with people, vehicles with vehicles, sampled over 12 s
const sample = () => page.evaluate(() => {
  const crowds = [window.__peds, window.__melaCrowd].filter(Boolean);
  let pp = 0, n = 0;
  for (const c of crowds) {
    const ps = c.peds.slice(0, c.active).filter((p) => !p.fresh && !p.out && !(p.down > 0));
    n += ps.length;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++)
      if (Math.abs(ps[i].y - ps[j].y) < 1 && Math.hypot(ps[i].x - ps[j].x, ps[i].z - ps[j].z) < 0.4) pp++;
  }
  let vv = 0;
  const t = window.__traffic;
  if (t) {
    const cs = t.cars.filter((c) => !c.fresh);
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const a = t.circles(cs[i]), b = t.circles(cs[j]);
      const need = t.kinds[cs[i].kind].halfW + t.kinds[cs[j].kind].halfW - 0.25;
      if (a.some(([ax, az]) => b.some(([bx, bz]) => Math.hypot(ax - bx, az - bz) < need))) vv++;
    }
  }
  return { people: n, pp, vv };
});
for (let i = 0; i < 4; i++) { console.log(JSON.stringify(await sample())); await page.waitForTimeout(3000); }
// walk Ramu straight into the nearest person
const r = await page.evaluate(async () => {
  const c = window.__melaCrowd ?? window.__peds, R = window.__ramu;
  const p = c.peds.slice(0, c.active).filter((p) => !p.fresh && !(p.down > 0)).sort((a, b) => Math.hypot(a.x - R.position.x, a.z - R.position.z) - Math.hypot(b.x - R.position.x, b.z - R.position.z))[0];
  R.position.set(p.x, p.y, p.z);
  await new Promise((r) => setTimeout(r, 300));
  return { gap: +Math.hypot(p.x - R.position.x, p.z - R.position.z).toFixed(2) };
});
console.log('Ramu put on a person -> apart by', r.gap);
await page.screenshot({ path: out });
console.log(await page.textContent('#debug'));
await browser.close();
