import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/*
 The loader for every model: the built game's models are meshopt-compressed (scripts/compress-models.mjs, after
 `vite build`), and their textures WebP, which GLTFLoader reads by itself. The dev server's are as Blender wrote them;
 this reads both.
*/
export function gltfLoader(): GLTFLoader {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
}

/** a clothes look's texture: the .webp the build makes of it, or the .jpg as it is in development */
export const lookUrl = (name: string): string => `models/looks/${name}.${import.meta.env.PROD ? 'webp' : 'jpg'}`;
