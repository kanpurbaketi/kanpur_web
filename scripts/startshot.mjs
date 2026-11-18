// The menu's "Start at" choice (Places): fresh profile starts at the Shivaji gate; choosing "Inside the mela" restarts
// there and is remembered; choosing the gate again goes back. Usage: node scripts/startshot.mjs <outDir>
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const out = process.argv[2] ?? '.';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
const ready = () => page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
const where = () => page.evaluate(() => [Math.round(window.__ramu.position.x), Math.round(window.__ramu.position.z)]);
const choose = async (title, shot) => {
  await page.click('.menu-btn');
  await page.click('.menu-item:has-text("Places")');
  await page.waitForSelector('.start-at');
  if (shot) await page.screenshot({ path: `${out}/start_menu.png` });
  await Promise.all([page.waitForNavigation(), page.click(`.start-at .place-row:has-text("${title}")`)]);
  await ready();
  await page.waitForTimeout(1500);
};
await page.goto(`${BASE}?debug&time=night`);
await ready();
console.log('fresh start at', await where(), await page.evaluate(() => localStorage.getItem('kanpur.start.v1')));
await choose('Inside the mela', true);
console.log('after "Inside the mela"', await where(), await page.evaluate(() => localStorage.getItem('kanpur.start.v1')));
await page.reload();
await ready();
console.log('after reload', await where());
await choose('Shivaji Putla gate', false);
console.log('after "Shivaji Putla gate"', await where(), await page.evaluate(() => localStorage.getItem('kanpur.start.v1')));
await browser.close();
