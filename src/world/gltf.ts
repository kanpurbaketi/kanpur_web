import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/*
 The loader for every model: the built game's models are meshopt-compressed (scripts/compress-models.mjs, after
 `vite build`), and their textures WebP, which GLTFLoader reads by itself. The dev server's are as Blender wrote them;
 this reads both.

 On a phone or a tablet the textures are cut down as they come in (TEX_MAX on a side): a browser there gets far less
 memory than on a laptop (an iPhone's Safari closes the page past a point, "A problem repeatedly occurred"), and the
 models' textures at full size came to most of a GB.
*/
export const PHONE = matchMedia('(pointer: coarse)').matches;
/** the longest side a model's texture keeps on a phone (0: as made) */
export const TEX_MAX = PHONE ? 512 : 0;
/** what is seen close (Ramu himself, the faces) keeps more */
export const TEX_MAX_NEAR = PHONE ? 1024 : 0;

type Img = HTMLImageElement | HTMLCanvasElement | ImageBitmap;
const shrunk = new WeakMap<object, HTMLCanvasElement>();

/** `tex` cut down to `max` on its longer side (before it is first drawn); one canvas for an image several textures share */
export function shrinkTexture(tex: THREE.Texture, max = TEX_MAX): void {
  const im = tex.image as Img | undefined;
  if (!max || !im || !('width' in im) || Math.max(im.width, im.height) <= max) return;
  let c = shrunk.get(im);
  if (!c) {
    const k = max / Math.max(im.width, im.height);
    c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(im.width * k));
    c.height = Math.max(1, Math.round(im.height * k));
    c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
    shrunk.set(im, c);
    if ('close' in im) im.close();                 // an ImageBitmap's pixels: let them go now
  }
  tex.image = c;
  tex.needsUpdate = true;
}

/** every texture on the meshes under `root`, cut down to `max` */
export function shrinkTextures(root: THREE.Object3D, max = TEX_MAX): void {
  if (!max) return;
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      for (const v of Object.values(mat)) if (v && (v as THREE.Texture).isTexture) shrinkTexture(v as THREE.Texture, max);
    }
  });
}

class Loader extends GLTFLoader {
  constructor(private max: number) { super(); }
  loadAsync(url: string, onProgress?: (e: ProgressEvent) => void): Promise<GLTF> {
    return super.loadAsync(url, onProgress).then((g) => { shrinkTextures(g.scene, this.max); return g; });
  }
}

/** `max`: the longest side its textures keep (TEX_MAX: a phone's limit, nothing on a laptop) */
export function gltfLoader(max = TEX_MAX): GLTFLoader {
  return new Loader(max).setMeshoptDecoder(MeshoptDecoder);
}

/** a clothes look's texture: the .webp the build makes of it, or the .jpg as it is in development */
export const lookUrl = (name: string): string => `models/looks/${name}.${import.meta.env.PROD ? 'webp' : 'jpg'}`;
