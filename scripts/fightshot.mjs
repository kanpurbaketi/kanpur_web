// Stage a fight for screenshots: Ramu walks up to one of the mela crowd and punches them `n` times.
// Usage: node scripts/fightshot.mjs <outPrefix> <who: uncle|security> [punches=3]
// Needs the dev server (BASE) and ?debug (window.__ramu, window.__melaCrowd).
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5180/';
const [out, who = 'uncle', n = '3'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => m.type() === 'error' && console.log('  console:', m.text()));
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
await page.goto(`${BASE}?debug&peds=0&traffic=0&fov=45`);
await page.waitForFunction(() => window.__ready === true && window.__melaCrowd.rigged.length >= 10, null, { timeout: 60000 });
await page.waitForTimeout(1500);
const state = () => page.evaluate(() => { const p = window.__victim, r = window.__ramu; return { hits: p.hits, blocks: p.blockN, kicks: window.__kicks = (window.__kicks ?? 0) + (p.atkKind === 2 ? 1 : 0), flinch: +p.flinch.toFixed(2), angry: +p.angry.toFixed(1), out: p.out, mode: p.mode, atk: p.atkKind, d: +Math.hypot(p.x - r.position.x, p.z - r.position.z).toFixed(2), life: Math.round(window.__health.value) }; });
await page.evaluate((who) => {
  const c = window.__melaCrowd, r = window.__ramu;
  for (const q of c.peds) q.hostile = false;      // no goons joining in: one fight at a time
  const rig = c.rigged.map((i) => c.peds[i]);
  const tough = who === 'security' ? 5 : 3;
  const p = rig.find((p) => p.rig === who && p.tough === tough);
  window.__victim = p;
  p.wait = 60;
  r.position.set(p.x + 1.15, 0, p.z);
  r.model.rotation.y = Math.PI / 2;      // facing -x, towards them
  r.yaw = 0.25; r.pitch = -0.12;
}, who);
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}_0_before.png` });
// some punches are blocked, so `n` is how many to throw at most: the fight stops when they are laid out
for (let k = 1; k <= Number(n); k++) {
  if ((await state()).out) break;
  await page.evaluate(() => { const r = window.__ramu, p = window.__victim; r.position.set(p.x + 1.15, 0, p.z); r.punchQueued = true; });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}_${k}a_hit.png` });
  console.log(`punch ${k} +0.7s`, JSON.stringify(await state()));
  await page.waitForTimeout(1100);
  await page.screenshot({ path: `${out}_${k}b_after.png` });
  console.log(`punch ${k} +1.8s`, JSON.stringify(await state()));
}
await page.evaluate(() => { const r = window.__ramu; r.yaw = 1.2; r.pitch = -0.75; });      // look down on where they lie
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}_z_end.png` });
// then walk into a bystander: they should step back and aside, not fall
const bump = await page.evaluate(async () => {
  const c = window.__melaCrowd, r = window.__ramu, v = window.__victim;
  const p = c.peds.find((q) => q !== v && !q.hostile && !q.out && q.moving > 0.5 && Math.hypot(q.x - v.x, q.z - v.z) > 12);
  const at = [p.x, p.z];
  r.position.set(p.x + 0.3, 0, p.z + 0.2);
  await new Promise((ok) => setTimeout(ok, 500));
  const mid = { off: +Math.hypot(p.ox, p.oz).toFixed(2), hold: +p.hold.toFixed(2), down: p.down, out: p.out, d: +Math.hypot(p.x - r.position.x, p.z - r.position.z).toFixed(2) };
  await new Promise((ok) => setTimeout(ok, 2500));
  return { mid, later: { off: +Math.hypot(p.ox, p.oz).toFixed(2), moved: +Math.hypot(p.x - at[0], p.z - at[1]).toFixed(2), moving: +p.moving.toFixed(2), hits: p.hits } };
});
console.log('bump', JSON.stringify(bump));
console.log('end', JSON.stringify(await state()));
await browser.close();
