#!/usr/bin/env node
/*
 Shrinks the game's models for deploying, after `vite build` (npm run build runs it): every .glb under <dir>/models
 gets its animation keys thinned where they change nothing, its geometry and animation meshopt-compressed (losslessly: not
 quantised, see below; EXT_meshopt_compression: the game's loaders decode it, src/world/gltf.ts), and its textures turned to WebP
 (EXT_texture_webp); the clothes' looks (models/looks/*.jpg) become .webp in their place, which the built game asks for.
 public/models stays as Blender and the import scripts write it (the dev server serves those as they are).
   node scripts/compress-models.mjs dist          (default: dist)
*/
import { readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, resample, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const root = join(process.argv[2] ?? 'dist', 'models');
const files = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : [p];
});

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

let before = 0, after = 0;
const t0 = Date.now();
for (const f of files(root)) {
  if (f.endsWith('.glb')) {
    const a = statSync(f).size;
    const doc = await io.read(f);
    if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'EXT_meshopt_compression')) { console.log(`  ${f}: already compressed`); continue; }
    await doc.transform(
      dedup(),
      // keep what the game reads that no material uses: extras (the faces' landmarks), every vertex attribute
      prune({ keepAttributes: true, keepExtras: true, keepLeaves: true }),
      resample({ tolerance: 1e-4 }),
      textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 88 }),
    );
    // meshopt-compressed losslessly, the vertices left as they are: quantising them (gltf-transform's meshopt()) moves
    // each mesh's scale onto its node and stores its positions as -1..1 integers, and the game bakes meshes' matrices
    // into their geometry (vehicles, chairs, carts: clipped to -1..1, crumpled) and reads face landmarks and seat
    // heights in the model's own units (teeth gone, people sunk); so no quantising
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    await io.write(f, doc);
    const b = statSync(f).size;
    before += a; after += b;
    console.log(`  ${f}: ${(a / 1e6).toFixed(2)} -> ${(b / 1e6).toFixed(2)} MB`);
  } else if (f.endsWith('.jpg') && f.includes(`${join('models', 'looks')}`)) {
    const out = f.replace(/\.jpg$/, '.webp');
    const buf = await sharp(readFileSync(f)).webp({ quality: 86 }).toBuffer();
    writeFileSync(out, buf);
    const a = statSync(f).size;
    unlinkSync(f);                                   // the built game asks for the .webp
    before += a; after += buf.length;
    console.log(`  ${out}: ${(a / 1e6).toFixed(2)} -> ${(buf.length / 1e6).toFixed(2)} MB`);
  }
}
console.log(`models: ${(before / 1e6).toFixed(1)} -> ${(after / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
