import * as THREE from 'three';

/*
 Procedural textures, generated once at startup (no image assets to license or download).
   noiseTexture(): tileable 256² RGBA fBm. R = fine grain, G = mid blotches, B = large patches, A = ridged / cracks.
                   Shaders sample it in world or facade meters at several scales to avoid visible tiling.
   leafTexture():  alpha-cut leaf cluster for tree crown cards.
   waterNormal():  tileable ripple normal map for the lake.
*/

const N = 256;
let noiseCache: THREE.DataTexture | null = null;

/** Tileable value noise with `cells` lattice cells across the texture. */
function valueNoise(cells: number, seed: number): Float32Array {
  const lat = new Float32Array(cells * cells);
  for (let i = 0; i < lat.length; i++) {
    const s = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
    lat[i] = s - Math.floor(s);
  }
  const out = new Float32Array(N * N);
  const k = cells / N;
  for (let y = 0; y < N; y++) {
    const fy = y * k, iy = Math.floor(fy), ty = fy - iy;
    const sy = ty * ty * (3 - 2 * ty);
    const y0 = iy % cells, y1 = (iy + 1) % cells;
    for (let x = 0; x < N; x++) {
      const fx = x * k, ix = Math.floor(fx), tx = fx - ix;
      const sx = tx * tx * (3 - 2 * tx);
      const x0 = ix % cells, x1 = (ix + 1) % cells;
      const a = lat[y0 * cells + x0], b = lat[y0 * cells + x1];
      const c = lat[y1 * cells + x0], d = lat[y1 * cells + x1];
      out[y * N + x] = a + (b - a) * sx + (c - a + (a - b - c + d) * sx) * sy;
    }
  }
  return out;
}

function fbm(base: number, octaves: number, seed: number, ridged = false): Float32Array {
  const out = new Float32Array(N * N);
  let amp = 0.5, total = 0;
  for (let o = 0; o < octaves; o++) {
    const v = valueNoise(base << o, seed + o * 17);
    for (let i = 0; i < out.length; i++) out[i] += amp * (ridged ? 1 - Math.abs(v[i] * 2 - 1) : v[i]);
    total += amp;
    amp *= 0.5;
  }
  // normalise to 0..1 so every channel uses its full range
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < out.length; i++) {
    out[i] /= total;
    lo = Math.min(lo, out[i]);
    hi = Math.max(hi, out[i]);
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo);
  return out;
}

export function noiseTexture(): THREE.DataTexture {
  if (noiseCache) return noiseCache;
  const ch = [fbm(32, 3, 1), fbm(8, 4, 2), fbm(4, 4, 3), fbm(6, 4, 4, true)];
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) for (let c = 0; c < 4; c++) data[i * 4 + c] = Math.round(ch[c][i] * 255);
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  noiseCache = t;
  return t;
}

/** Leaf cluster on transparent background: many small leaves, darker toward the centre. */
export function leafTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // twigs
  g.strokeStyle = '#4a3a26';
  g.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2;
    g.beginPath();
    g.moveTo(S / 2, S / 2);
    g.lineTo(S / 2 + Math.cos(a) * S * 0.38, S / 2 + Math.sin(a) * S * 0.38);
    g.stroke();
  }
  // dense, darker core so the crown reads as a mass rather than confetti
  for (let i = 0; i < 26; i++) {
    const r = Math.sqrt(rnd()) * S * 0.28, a = rnd() * Math.PI * 2;
    g.fillStyle = `hsl(${85 + rnd() * 20},${30 + rnd() * 15}%,${14 + rnd() * 8}%)`;
    g.beginPath();
    g.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 14 + rnd() * 16, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 650; i++) {
    const r = Math.sqrt(rnd()) * S * 0.45;
    const a = rnd() * Math.PI * 2;
    const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r;
    const lit = (1 - y / S) * 0.6 + rnd() * 0.4; // upper leaves catch more light
    const hue = 78 + rnd() * 28, sat = 28 + rnd() * 22, lig = 16 + lit * 26;
    g.fillStyle = `hsl(${hue},${sat}%,${lig}%)`;
    g.save();
    g.translate(x, y);
    g.rotate(rnd() * Math.PI * 2);
    g.beginPath();
    g.ellipse(0, 0, 5 + rnd() * 6, 2.2 + rnd() * 2.2, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Tileable ripple normal map built from two noise channels. */
export function waterNormal(): THREE.DataTexture {
  const h = fbm(16, 3, 9);
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = h[y * N + ((x + 1) % N)] - h[y * N + ((x + N - 1) % N)];
      const dy = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x];
      const v = new THREE.Vector3(-dx * 6, -dy * 6, 1).normalize();
      const i = (y * N + x) * 4;
      data[i] = (v.x * 0.5 + 0.5) * 255;
      data[i + 1] = (v.y * 0.5 + 0.5) * 255;
      data[i + 2] = (v.z * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export const SIGN_COLS = 2, SIGN_ROWS = 16;

/**
 * Shop signboards: 32 flex-print strips (8:1) in Hindi and English, 2 columns x 16 rows, top row first.
 * The facade shader picks one per shop frontage.
 */
export function signAtlas(): THREE.CanvasTexture {
  const TW = 1024, TH = 128;
  const c = document.createElement('canvas');
  c.width = TW * SIGN_COLS;
  c.height = TH * SIGN_ROWS;
  const g = c.getContext('2d')!;
  const names: [string, string, number][] = [
    ['राजू टी स्टॉल', 'RAJU TEA STALL', 0], ['कानपुर मेडिकल स्टोर', 'KANPUR MEDICAL STORE', 1],
    ['LLR HOSPITAL', 'मेडिकल शॉप्स • 24 घंटे', 3], ['श्री गणेश जनरल स्टोर', 'GENERAL & KIRANA STORE', 2],
    ['शर्मा स्वीट्स', 'SHARMA SWEETS & NAMKEEN', 4], ['न्यू आई केयर सेंटर', 'EYE CARE & OPTICALS', 3],
    ['मोती मोबाइल पॉइंट', 'MOBILE • RECHARGE • REPAIR', 0], ['जय माता दी होटल', 'HOTEL & RESTAURANT', 2],
    ['पैथोलॉजी लैब', 'PATHOLOGY • X-RAY • ECG', 3], ['बाबा चाय वाला', 'CHAI • SAMOSA • KACHORI', 4],
    ['कृष्णा फर्नीचर हाउस', 'KRISHNA FURNITURE', 1], ['सिटी हार्डवेयर', 'PAINTS • HARDWARE • SANITARY', 0],
    ['डॉ. वर्मा क्लिनिक', 'DR. VERMA CLINIC • ENT', 3], ['अग्रवाल कपड़ा भंडार', 'AGARWAL CLOTH HOUSE', 2],
    ['न्यू स्टार बेकरी', 'NEW STAR BAKERY', 4], ['गुप्ता ऑटो पार्ट्स', 'GUPTA AUTO PARTS', 1],
    ['दंत चिकित्सा केंद्र', 'DENTAL CLINIC', 3], ['मोतीझील फोटो स्टूडियो', 'PHOTO STUDIO • FLEX PRINTING', 0],
    ['सरस्वती स्टेशनरी', 'BOOKS • STATIONERY • XEROX', 2], ['जनता मेडिकोज़', 'MEDICOS • SURGICAL', 3],
    ['कानपुर टॉकीज़', 'CHAI NASHTA', 4], ['राधे राधे पान भंडार', 'PAN • CIGARETTE • COLD DRINK', 1],
    ['यादव डेयरी', 'YADAV DAIRY • DAHI • LASSI', 2], ['न्यू फैशन टेलर्स', 'LADIES & GENTS TAILORS', 0],
    ['सिटी फार्मेसी', 'MEDICINES • 24x7', 3], ['बालाजी इलेक्ट्रॉनिक्स', 'ELECTRICALS & APPLIANCES', 1],
    ['लक्ष्मी ज्वेलर्स', 'GOLD • SILVER', 4], ['मॉडर्न जिम', 'FITNESS CENTRE', 0],
    ['पंजाब ढाबा', 'PUNJABI & CHINESE', 2], ['हेल्थ केयर हॉस्पिटल', 'MULTI SPECIALITY • EMERGENCY', 3],
    ['विजय कम्प्यूटर्स', 'SALES • SERVICE • TRAINING', 1], ['मिश्रा बुक डिपो', 'MISHRA BOOK DEPOT', 4],
  ];
  // [background, main text, accent stripe]
  const schemes = [['#c62828', '#ffe45c', '#ffffff'], ['#1c4f9c', '#ffffff', '#f2c21b'], ['#1f7a45', '#ffffff', '#ffe45c'],
    ['#f3efe3', '#b3261e', '#1c4f9c'], ['#f2b822', '#7a1410', '#7a1410']];
  const fit = (txt: string, font: (px: number) => string, maxW: number, px: number) => {
    g.font = font(px);
    const w = g.measureText(txt).width;
    return w > maxW ? Math.floor(px * maxW / w) : px;
  };
  const face = "'Noto Sans Devanagari','Kohinoor Devanagari','Mangal','Devanagari Sangam MN','Nirmala UI',Arial,sans-serif";
  names.forEach(([a, b, k], i) => {
    const ox = (i % SIGN_COLS) * TW, oy = Math.floor(i / SIGN_COLS) * TH;
    let [bg, fg, ac] = schemes[(k + (i >> 2)) % schemes.length];
    if (k === 3) [bg, fg, ac] = schemes[3];
    g.save();
    g.translate(ox, oy);
    g.fillStyle = bg;
    g.fillRect(0, 0, TW, TH);
    g.fillStyle = ac;                                     // border stripes
    g.fillRect(0, 0, TW, 6);
    g.fillRect(0, TH - 6, TW, 6);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const pxA = fit(a, (p) => `bold ${p}px ${face}`, TW - 140, 70);
    g.font = `bold ${pxA}px ${face}`;
    g.fillStyle = fg;
    g.fillText(a, TW / 2 + 20, 48);
    const pxB = fit(b, (p) => `600 ${p}px Arial, sans-serif`, TW - 140, 30);
    g.font = `600 ${pxB}px Arial, sans-serif`;
    g.fillStyle = k === 4 ? '#3a0c08' : ac;
    g.fillText(b, TW / 2 + 20, 100);
    if (k === 3) {                                         // medical cross
      g.fillStyle = '#c62828';
      g.fillRect(40, 38, 52, 18);
      g.fillRect(57, 21, 18, 52);
    }
    // faded, dirty flex print: soft streaks and a grimy bottom edge
    for (let n = 0; n < 40; n++) {
      g.fillStyle = `rgba(${60 + (n * 7) % 40},${50 + (n * 5) % 30},40,${0.03 + (n % 5) * 0.012})`;
      g.fillRect((n * 197) % TW, 0, 8 + (n * 13) % 40, TH);
    }
    const gr = g.createLinearGradient(0, TH * 0.55, 0, TH);
    gr.addColorStop(0, 'rgba(40,30,20,0)');
    gr.addColorStop(1, 'rgba(40,30,20,0.28)');
    g.fillStyle = gr;
    g.fillRect(0, 0, TW, TH);
    g.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;                                          // row 0 is the top of the picture
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 8;
  return t;
}
