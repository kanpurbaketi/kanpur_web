import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { NIGHT } from './night';

/*
 Detailed vehicles built by tools/blender/build_vehicles.py (public/models/<name>.glb): real PBR materials, not vertex colours.
   paint       white clear-coat, tinted per car
   glass       see-through; lamp_* lens materials glow at night
*/

const LAMP: Record<string, [string, number]> = { lamp_head: ['#fff1c8', 3.0], lamp_tail: ['#ff2a1a', 1.5], lamp_amber: ['#ffa030', 0.4] };

export interface PBRPart { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial }

const cache = new Map<string, Promise<PBRPart[]>>();

/** Every mesh of the model with its transform baked into the geometry, and its (shared) material. */
export function loadPBR(name: string): Promise<PBRPart[]> {
  let p = cache.get(name);
  if (!p) {
    p = new GLTFLoader().loadAsync(`models/${name}.glb`).then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const out: PBRPart[] = [];
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.MeshStandardMaterial;
        const lamp = LAMP[mat.name];
        if (lamp) {
          mat.emissive.set(lamp[0]);
          mat.emissiveIntensity = NIGHT ? lamp[1] : 0;
        }
        if (mat.name === 'glass') {
          mat.transparent = true;
          mat.depthWrite = false;
        }
        out.push({ geo: m.geometry.clone().applyMatrix4(m.matrixWorld), mat });
      });
      return out;
    });
    cache.set(name, p);
  }
  return p;
}

/** One car as a group of meshes; the paint material is copied so each car can have its own colour. */
export function cloneCar(parts: PBRPart[], paint: string): THREE.Group {
  const g = new THREE.Group();
  for (const { geo, mat } of parts) {
    let m = mat;
    if (mat.name === 'paint') {
      m = mat.clone();
      m.color.set(paint);
    } else if (mat.map) {
      m = mat.clone();                       // a photo-textured model: tint it lightly toward the colour asked for
      m.color.set(paint).lerp(new THREE.Color('#ffffff'), 0.55);
    }
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = mat.name !== 'glass';
    if (mat.name === 'glass') mesh.renderOrder = 1;
    g.add(mesh);
  }
  return g;
}
