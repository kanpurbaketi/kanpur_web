import * as THREE from 'three';
import { gltfLoader } from './gltf';

/*
 Clumps of grass (models/grass.glb: tools/blender/build_props.py --only grass, from assets/common_assets/grass.zip):
 'tuft', a clump about knee-low at full size, and 'sprig', a little one. Blade cards cut out by their alpha. Each stands
 on its own origin. Many of one are drawn as one InstancedMesh per material; the blades sway a little in the wind (the
 higher up a blade, the more).
*/

export type GrassName = 'tuft' | 'sprig';
export interface GrassSpot { name: GrassName; x: number; y: number; z: number; ry: number; s: number }

type Part = { geo: THREE.BufferGeometry; mat: THREE.Material };
let cache: Promise<Map<string, Part[]>> | null = null;
const wind = { value: 0 };

function load() {
  return (cache ??= gltfLoader().loadAsync('models/grass.glb').then((gltf) => {
    const out = new Map<string, Part[]>();
    const mats = new Map<THREE.Material, THREE.Material>();
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const name = (m.parent && m.parent !== gltf.scene ? m.parent.name : m.name).replace(/_\d+$/, '');
      const src = m.material as THREE.MeshStandardMaterial;
      let mat = mats.get(src);
      if (!mat) {
        const mm = new THREE.MeshStandardMaterial({ map: src.map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
        mm.onBeforeCompile = (sh) => {
          sh.uniforms.uWind = wind;
          sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
            #ifdef USE_INSTANCING
              vec2 wp = instanceMatrix[3].xz;
            #else
              vec2 wp = vec2(0.0);
            #endif
            float sway = sin(uWind * 1.7 + wp.x * 0.35 + wp.y * 0.27) * 0.6 + sin(uWind * 2.9 + wp.x * 0.9) * 0.4;
            transformed.xz += vec2(0.06, 0.03) * sway * transformed.y * transformed.y * 4.0;`);
        };
        mat = mm;
        mats.set(src, mat);
      }
      (out.get(name) ?? out.set(name, []).get(name)!).push({ geo: m.geometry.clone().applyMatrix4(m.matrixWorld), mat });
    });
    return out;
  }));
}

/** Put grass at `spots` under `parent` (in its frame); it appears once the model is in. */
export function addGrass(parent: THREE.Object3D, spots: GrassSpot[]): void {
  load().then((items) => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const name of ['tuft', 'sprig'] as GrassName[]) {
      const list = spots.filter((s) => s.name === name);
      const parts = items.get(name);
      if (!list.length || !parts) continue;
      for (const p of parts) {
        const im = new THREE.InstancedMesh(p.geo, p.mat, list.length);
        list.forEach((s, i) => im.setMatrixAt(i, m.compose(v.set(s.x, s.y, s.z), q.setFromAxisAngle(up, s.ry), sc.setScalar(s.s))));
        im.receiveShadow = true;
        im.computeBoundingSphere();
        parent.add(im);
      }
    }
  }).catch((err) => console.error('grass failed to load', err));
}

/** the wind's clock (seconds) */
export function grassWind(t: number): void { wind.value = t; }
