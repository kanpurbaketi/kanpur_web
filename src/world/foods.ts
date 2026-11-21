import * as THREE from 'three';
import { gltfLoader } from './gltf';

/*
 Food and its leftovers (models/foods.glb: tools/blender/build_foods.py, from the food pack in assets/common_assets):
 fruit, water bottles and biscuit packets for the poets' table, chip packets, wrappers, a can and a carton thrown on the
 mela's ground. Each item stands on its own origin (the middle of its underside), at its real size.
 Many of one item are drawn as one InstancedMesh.
*/

export type FoodName = 'banana' | 'apple' | 'orange' | 'grapes' | 'mango' | 'water' | 'water_small' | 'biscuits' | 'biscuits_b'
  | 'popcorn' | 'coconut' | 'chips' | 'chips_b' | 'chips_c' | 'flat_bag' | 'wrapper' | 'wrapper_b' | 'can' | 'carton' | 'cookie_pack';

export interface FoodSpot { name: FoodName; x: number; y: number; z: number; ry: number; rx?: number; rz?: number; s?: number }

let cache: Promise<Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material }>> | null = null;

function load() {
  return (cache ??= gltfLoader().loadAsync('models/foods.glb').then((gltf) => {
    const out = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material }>();
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      // the item's name is on the mesh, or on its node when the mesh has several parts
      const name = (m.parent && m.parent !== gltf.scene ? m.parent.name : m.name).replace(/_\d+$/, '') || m.name;
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.roughness = 0.7;
      mat.metalness = 0;
      out.set(out.has(name) ? m.name : name, { geo: m.geometry.clone().applyMatrix4(m.matrixWorld), mat });
    });
    return out;
  }));
}

/** one item on its own (to be held, or thrown), its origin in its middle; `s` scales it */
export async function foodMesh(name: FoodName, s = 1): Promise<THREE.Mesh> {
  const it = (await load()).get(name);
  if (!it) throw new Error(`no food ${name}`);
  const m = new THREE.Mesh(it.geo.clone().center().scale(s, s, s), it.mat);
  m.castShadow = true;
  m.name = name;
  return m;
}

/** Put food items at `spots` under `parent` (in its frame); they appear once the model is in. */
export function addFoods(parent: THREE.Object3D, spots: FoodSpot[], shadows = false): void {
  load().then((items) => {
    const by = new Map<string, FoodSpot[]>();
    for (const s of spots) (by.get(s.name) ?? by.set(s.name, []).get(s.name)!).push(s);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const [name, list] of by) {
      const it = items.get(name);
      if (!it) { console.warn('no food', name); continue; }
      const im = new THREE.InstancedMesh(it.geo, it.mat, list.length);
      list.forEach((s, i) => {
        e.set(s.rx ?? 0, s.ry, s.rz ?? 0, 'YXZ');
        im.setMatrixAt(i, m.compose(v.set(s.x, s.y, s.z), q.setFromEuler(e), sc.setScalar(s.s ?? 1)));
      });
      im.castShadow = shadows;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      parent.add(im);
    }
  }).catch((err) => console.error('foods failed to load', err));
}
