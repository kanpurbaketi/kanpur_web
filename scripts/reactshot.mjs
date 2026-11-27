// Stage the other reactions for screenshots: a rigged person thrown by a vehicle and getting up, one punched from behind,
// and Ramu knocked out and getting up. Usage: node scripts/reactshot.mjs <outPrefix>   (dev server on BASE, uses ?debug)
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const [out] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => m.type() === 'error' && console.log('  console:', m.text()));
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
await page.goto(`${BASE}?debug&peds=0&traffic=0&fov=45`);
await page.waitForFunction(() => window.__ready === true && window.__melaCrowd.rigged.length >= 10, null, { timeout: 60000 });
await page.waitForTimeout(1500);
const shot = (name) => page.screenshot({ path: `${out}_${name}.png` });
// 1. thrown by a vehicle
await page.evaluate(() => {
  const c = window.__melaCrowd, r = window.__ramu;
  for (const q of c.peds) q.hostile = false;
  const p = c.rigged.map((i) => c.peds[i]).find((q) => q.rig === 'uncle' && q.x > 20 && q.x < 80);
  window.__v = p;
  r.position.set(p.x + 0.5, 0, p.z + 3.2); r.yaw = 0.15; r.pitch = -0.3;
  c.knockDown(p, 2.5, 0, 3.6);
  // where the hips really are, every frame: a jump between the fall and the get-up shows as a big step
  const hips = []; p.actor.root.traverse((o) => { if (/Hips$/.test(o.name)) hips.push(o); });
  const v = new hips[0].position.constructor(); let last = null; window.__jump = 0;
  const tick = () => { hips[0].getWorldPosition(v); if (last) { const st = Math.hypot(v.x - last[0], v.z - last[1]); if (st > window.__jump) { window.__jump = st; window.__jumpAt = +p.down.toFixed(2); } } last = [v.x, v.z]; if (p.down > 0) requestAnimationFrame(tick); else window.__done = true; };
  requestAnimationFrame(tick);
});
await page.waitForTimeout(2300); await shot('1_thrown_down');
await page.waitForTimeout(1300); await shot('2_getting_up');
await page.waitForFunction(() => window.__done === true, null, { timeout: 10000 });
await page.waitForTimeout(600); await shot('3_up');
console.log('thrown: biggest hips step in one frame (m)', await page.evaluate(() => [+window.__jump.toFixed(3), 'at down=', window.__jumpAt]), 'state', JSON.stringify(await page.evaluate(() => ({ down: window.__v.down, out: window.__v.out, panic: +window.__v.panic.toFixed(1) }))));
// 2. punched from behind until laid out
await page.evaluate(() => { const c = window.__melaCrowd; window.__b = c.rigged.map((i) => c.peds[i]).find((q) => q !== window.__v && q.rig === 'uncle'); window.__b.wait = 60; });
for (let k = 0; k < 3; k++) {
  await page.evaluate(() => { const p = window.__b, c = window.__melaCrowd; const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading); if (window.__k === undefined) window.__k = 0;
    // from directly behind, facing the same way as them (the first two turn them round, so stand behind again each time)
    // nobody else in the way of the punch
    for (const q of c.peds) if (q !== p && Math.hypot(q.x - p.x, q.z - p.z) < 4) { q.x += 6; q.wait = 30; }
    c.hit(p.x - fx * 1.1, p.z - fz * 1.1, fx, fz); });
  await page.waitForTimeout(1100);
}
await page.evaluate(() => { const p = window.__b, r = window.__ramu; r.position.set(p.x + 0.5, 0, p.z + 3.2); r.yaw = 0.15; r.pitch = -0.35; });
await page.waitForTimeout(2600); await shot('4_fell_forward');
console.log('from behind', JSON.stringify(await page.evaluate(() => ({ hits: window.__b.hits, out: window.__b.out, fwd: window.__b.fwd }))));
// 2b. a blocked punch and a kick (forced, to see the clips)
const bk = await page.evaluate(async () => {
  const c = window.__melaCrowd, r = window.__ramu;
  const p = c.rigged.map((i) => c.peds[i]).find((q) => !q.out && q.rig === 'security');
  window.__g = p; p.wait = 60;
  for (const q of c.peds) if (q !== p && Math.hypot(q.x - p.x, q.z - p.z) < 4) { q.x += 6; q.wait = 30; }
  r.position.set(p.x + 1.15, 0, p.z); r.model.rotation.y = Math.PI / 2; r.yaw = 0.25; r.pitch = -0.12;
  c.hit(p.x + 1.15, p.z, -1, 0);
  await new Promise((ok) => setTimeout(ok, 1100));
  const rnd = Math.random; Math.random = () => 0;          // the next punch is blocked for certain
  p.atkKind = 0; p.cool = 5;
  c.hit(p.x + 1.15, p.z, -1, 0);
  Math.random = rnd;
  return { hits: p.hits, blocks: p.blockN, block: +p.block.toFixed(2) };
});
await page.waitForTimeout(350); await shot('4b_block');
console.log('block', JSON.stringify(bk));
await page.evaluate(() => { const p = window.__g; p.block = 0; p.flinch = 0; p.cool = 5; p.atkKind = 2; p.atkT = 0; p.struck = false; p.atkN++; });
await page.waitForTimeout(430); await shot('4c_kick');
await page.waitForTimeout(900); await page.evaluate(() => { window.__g.cool = 5; }); await page.waitForTimeout(500); await shot('4d_fight_idle');
// 3. Ramu knocked out, then waking
await page.evaluate(() => { const r = window.__ramu; r.position.set(40 - 203, 0, 150 + 115.5); r.yaw = 2.3; r.pitch = -0.3; window.__health.hurt(500); });
await page.waitForTimeout(1900); await shot('5_ramu_out');
await page.waitForTimeout(1300);
await page.evaluate(() => { const r = window.__ramu; r.yaw = 2.3; r.pitch = -0.3; });
await page.waitForTimeout(300); await shot('6_ramu_getting_up');
console.log('ramu', JSON.stringify(await page.evaluate(() => ({ wake: +window.__ramu.wake.toFixed(2), out: window.__ramu.knockedOut, life: window.__health.value }))));
await page.waitForTimeout(2000);
console.log('ramu later', JSON.stringify(await page.evaluate(() => ({ wake: +window.__ramu.wake.toFixed(2) }))));
await browser.close();
