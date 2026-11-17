// Lists vehicles inside each other (kinds, how they face each other, speeds), sampled every second for 30 s.
// Usage: node scripts/vvcheck.mjs   (dev server on BASE, ?debug)
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto(`${BASE}?debug&spawn=metro&time=day`);
await page.waitForFunction(() => window.__ready === true && window.__traffic, null, { timeout: 90000 });
await page.waitForTimeout(3000);
for (let s = 0; s < 30; s++) {
  const o = await page.evaluate(() => {
    const t = window.__traffic, cs = t.cars.filter((c) => !c.fresh), out = [];
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const a = t.circles(cs[i]), b = t.circles(cs[j]);
      const need = t.kinds[cs[i].kind].halfW + t.kinds[cs[j].kind].halfW - 0.25;
      if (a.some(([ax, az]) => b.some(([bx, bz]) => Math.hypot(ax - bx, az - bz) < need)))
        out.push(`${t.kinds[cs[i].kind].name}/${t.kinds[cs[j].kind].name} dot ${Math.cos(cs[i].heading - cs[j].heading).toFixed(2)} v ${cs[i].v.toFixed(1)},${cs[j].v.toFixed(1)}`);
    }
    return out;
  });
  if (o.length) console.log(s, o.join(' | '));
  await page.waitForTimeout(1000);
}
await browser.close();
