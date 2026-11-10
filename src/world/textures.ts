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
