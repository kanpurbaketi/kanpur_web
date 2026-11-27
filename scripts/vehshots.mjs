// Screenshots of traffic vehicles, close up. Usage: node scripts/vehshots.mjs <outDir> kind[:day|night] ...   (dev server on :5180)
import { chromium } from 'playwright';
const [out, ...jobs] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('err', e.message));
for (const job of jobs) {
  const [kind, time = 'day'] = job.split(':');
  await p.goto(`http://localhost:5180/?debug&cam=60,3,20,0,0${time === 'day' ? '&time=day' : ''}`);
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
  await p.waitForTimeout(3000);
  const ok = await p.evaluate((kind) => {
    const t = window.__traffic.positions().filter((c) => c.kind === kind);
    if (!t.length) return false;
    const c = t[0], s = Math.sin(c.heading), co = Math.cos(c.heading), cam = window.__camera;
    const d = kind === 'bus' ? 13 : 5.5;
    cam.position.set(c.x + s * d * 0.8 + co * d * 0.6, kind === 'bus' ? 3.2 : 1.7, c.z + co * d * 0.8 - s * d * 0.6);
    cam.lookAt(c.x, kind === 'bus' ? 1.5 : 0.8, c.z);
    return true;
  }, kind);
  await p.waitForTimeout(60);
  await p.screenshot({ path: `${out}/${kind}_${time}.png` });
  console.log(kind, time, ok);
}
await b.close();
