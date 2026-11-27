// Where the stage 1 crowd is: counts by stretch of the corridor. Usage: BASE=... node scripts/crowdwhere.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 300 } });
await page.goto(`${BASE}?debug&spawn=shivaji&time=day`);
await page.waitForFunction(() => window.__ready === true && window.__peds, null, { timeout: 90000 });
await page.waitForTimeout(8000);
console.log(JSON.stringify(await page.evaluate(() => {
  const p = window.__peds, act = p.peds.slice(0, p.count);
  const by = { start: 0, parkRoad: 0, melaFront: 0, other: 0, standing: 0 };
  for (const q of act) {
    if (q.wait > 0) by.standing++;
    if (q.z < 80) by.start++; else if (q.x > -55) by.parkRoad++; else if (q.z > 300) by.melaFront++; else by.other++;
  }
  return { n: act.length, nodes: p.nodes.length, ...by };
})));
await browser.close();
