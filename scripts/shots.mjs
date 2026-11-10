// Render debug views to PNG.
// Usage: node scripts/shots.mjs <outDir> "<query>" ["<query>" ...]
//   e.g. node scripts/shots.mjs shots "cam=0,300,300,0,-0.9" "at=26.4791,80.3179,90"
//   --photos  : also render every Mapillary photo spot from map.json (and copy the photo next to it)
// Needs the dev server running (npm run dev) on BASE (default http://localhost:5180/).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE ?? 'http://localhost:5180/';
const [outDir, ...rest] = process.argv.slice(2);
if (!outDir) {
  console.error('usage: node scripts/shots.mjs <outDir> "<query>" ...');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const queries = rest.filter((q) => !q.startsWith('--'));
const pairs = [];
if (rest.includes('--photos')) {
  const map = JSON.parse(fs.readFileSync('public/data/moti_jheel/map.json', 'utf8'));
  const max = Number(process.env.MAX_PHOTOS ?? 15);
  const step = Math.max(1, Math.floor(map.photos.length / max));
  for (let i = 0; i < map.photos.length && pairs.length < max; i += step) {
    const p = map.photos[i];
    pairs.push(p);
    queries.push(`at=${p.lat},${p.lon},${p.heading}&id=${p.id}`);
  }
}

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => m.type() === 'error' && console.log('  console:', m.text()));
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
for (const q of queries) {
  await page.goto(`${BASE}?${q}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  await page.waitForTimeout(400);
  const name = q.replace(/[^a-z0-9.,=_-]+/gi, '_').slice(0, 80) + '.png';
  await page.screenshot({ path: path.join(outDir, name) });
  console.log('saved', path.join(outDir, name));
  if (/(^|&)debug/.test(q)) {
    await page.waitForTimeout(1500);
    console.log('  stats:', await page.textContent('#debug'));
  }
}
await browser.close();

// Side-by-side comparison page for photo spots.
if (pairs.length) {
  const rows = pairs.map((p) => {
    const q = `at=${p.lat},${p.lon},${p.heading}&id=${p.id}`;
    const shot = q.replace(/[^a-z0-9.,=_-]+/gi, '_').slice(0, 80) + '.png';
    const photo = path.relative(outDir, `reference/mapillary/${p.id}.jpg`);
    return `<tr><td><img src="${photo}"></td><td><img src="${shot}"></td><td>${p.id}<br>${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}<br>heading ${Math.round(p.heading)}°</td></tr>`;
  });
  fs.writeFileSync(path.join(outDir, 'compare.html'), `<!doctype html><meta charset="utf-8"><title>Photo vs game</title>
<style>body{font:13px system-ui;margin:16px}img{width:480px}td{vertical-align:top;padding:4px}</style>
<table><tr><th>Mapillary (CC-BY-SA)</th><th>Game</th><th></th></tr>${rows.join('')}</table>`);
  console.log('saved', path.join(outDir, 'compare.html'));
}
