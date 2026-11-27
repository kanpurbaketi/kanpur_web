// Vehicle lamps: Ramu takes a vehicle of each kind (night by default) and screenshots it braking, reversing,
// indicating (steering slowly) and with its headlights switched off (L).
// Usage: node scripts/lampshot.mjs <outDir> <kind,kind,...> [query]
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const [out, kinds, q = 'time=night'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
await page.goto(`${BASE}?debug&spawn=metro&${q}`);
await page.waitForFunction(() => window.__ready === true && window.__traffic && window.__driving, null, { timeout: 90000 });
await page.waitForTimeout(4000);
const lamps = () => page.evaluate(() => { const c = window.__driving.car; return c ? `lamps ${c.lamps} v ${c.v.toFixed(1)}` : '-'; });
for (const kind of kinds.split(',')) {
  const ok = await page.evaluate((kind) => {
    const t = window.__traffic, r = window.__ramu;
    const ki = t.kinds.findIndex((k) => k.name === kind);
    const c = t.cars.filter((c) => c.kind === ki && !c.fresh && !c.player)
      .sort((a, b) => Math.hypot(a.x - r.position.x, a.z - r.position.z) - Math.hypot(b.x - r.position.x, b.z - r.position.z))[0];
    if (!c) return false;
    c.vmax = 0; c.v = 0;
    const [x, z] = t.toWorld(c, -(t.kinds[ki].halfW + 0.8), 0);
    r.position.set(x, 0, z);
    return true;
  }, kind);
  if (!ok) { console.log('none on the road:', kind); continue; }
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(800);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1800);
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(350);
  console.log(kind, 'braking', await lamps());
  await page.screenshot({ path: `${out}/${kind}_brake.png` });
  await page.waitForTimeout(2200);
  console.log(kind, 'reversing', await lamps());
  await page.screenshot({ path: `${out}/${kind}_reverse.png` });
  await page.keyboard.up('KeyS');
  await page.waitForTimeout(1200);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${kind}_indicate_a.png` });
  await page.waitForTimeout(330);
  console.log(kind, 'indicating', await lamps());
  await page.screenshot({ path: `${out}/${kind}_indicate_b.png` });
  await page.keyboard.up('KeyD');
  await page.keyboard.press('KeyL');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${kind}_lightsoff.png` });
  await page.keyboard.press('KeyL');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  await page.screenshot({ path: `${out}/${kind}_beams.png` });
  await page.keyboard.down('Space');
  await page.waitForTimeout(2500);
  await page.keyboard.up('Space');
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(600);
}
console.log(await page.textContent('#debug'));
await browser.close();
