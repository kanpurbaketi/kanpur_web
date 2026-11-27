import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { gltfLoader } from './gltf';

/*
 Small things the story hands about (stage 1, part 2): Kumar's enamel mug (models/mug.glb). The candy floss (stage 1, part 3) is the modelled one in models/cotton_candy.glb. Each stands on its own origin.
*/

/** the enamel mug's handle (models/mug.glb, tools/blender/build_props.py build_mug): its bar's middle, this far out from
 the body's axis toward +x and this high; the hand holds it there */
export const MUG_HANDLE = { out: 0.064, up: 0.05 };

let mugModel: Promise<THREE.Object3D> | null = null;
/** the enamel mug (Kumar's, for the toilet): 9.5 cm tall, standing on its origin, the handle toward +x. A plain tub of
 its size stands in until the model has loaded */
export function mug(): THREE.Group {
  const g = new THREE.Group();
  const tub = new THREE.Mesh(new THREE.CylinderGeometry(0.051, 0.051, 0.095, 20, 1, true).translate(0, 0.0475, 0),
    new THREE.MeshStandardMaterial({ color: '#8a6420', roughness: 0.5, side: THREE.DoubleSide }));
  tub.castShadow = true;
  g.add(tub);
  g.name = 'mug';
  mugModel ??= gltfLoader().loadAsync('models/mug.glb').then((gltf) => {
    gltf.scene.traverse((o) => { o.castShadow = true; });
    return gltf.scene;
  });
  void mugModel.then((m) => { g.clear(); g.add(m.clone()); }).catch(() => {});
  return g;
}

/** a foot's outline, `len` long (toe at +x), for soles */
function footShape(len: number, wide: number): THREE.Shape {
  const s = new THREE.Shape(), h = len / 2;
  s.moveTo(-h, 0);
  s.bezierCurveTo(-h, wide * 0.42, -h * 0.4, wide * 0.4, 0, wide * 0.42);
  s.bezierCurveTo(h * 0.5, wide * 0.46, h, wide * 0.4, h, 0);
  s.bezierCurveTo(h, -wide * 0.4, h * 0.5, -wide * 0.5, 0, -wide * 0.44);
  s.bezierCurveTo(-h * 0.4, -wide * 0.38, -h, -wide * 0.42, -h, 0);
  return s;
}

/** a rubber chappal: a blue sole, a white V strap; its origin in its middle */
export function chappal(): THREE.Group {
  const g = new THREE.Group();
  const sole = new THREE.Mesh(new THREE.ExtrudeGeometry(footShape(0.26, 0.1), { depth: 0.018, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, -0.009, 0),
    new THREE.MeshStandardMaterial({ color: '#2f5fa8', roughness: 0.8 }));
  const strapMat = new THREE.MeshStandardMaterial({ color: '#e8e8e2', roughness: 0.7 });
  for (const sz of [-1, 1]) {
    const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0.07, 0.01, 0), new THREE.Vector3(0.0, 0.05, sz * 0.03), new THREE.Vector3(-0.04, 0.01, sz * 0.045));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(c, 8, 0.006, 5), strapMat));
  }
  g.add(sole);
  g.traverse((o) => { o.castShadow = true; });
  g.name = 'chappal';
  return g;
}

/** an old leather shoe: a sole and a rounded upper, dark brown; its origin in its middle */
export function shoe(): THREE.Group {
  const g = new THREE.Group();
  const sole = new THREE.Mesh(new THREE.ExtrudeGeometry(footShape(0.28, 0.1), { depth: 0.022, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, -0.04, 0),
    new THREE.MeshStandardMaterial({ color: '#2a2018', roughness: 0.9 }));
  const upper = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.13, 0.07, 0.048).translate(-0.005, -0.02, 0),
    new THREE.MeshStandardMaterial({ color: '#4a2e1c', roughness: 0.55 }));
  g.add(sole, upper);
  g.traverse((o) => { o.castShadow = true; });
  g.name = 'shoe';
  return g;
}

/** a fist-sized rock off the mela's ground: a lumpy grey-brown stone, its origin in its middle */
export function rock(): THREE.Mesh {
  // (its corners joined first: each shared corner is pushed out the same, so the surface stays whole, not torn into spikes)
  const geo = mergeVertices(new THREE.IcosahedronGeometry(0.06, 1).deleteAttribute('normal').deleteAttribute('uv'));
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const h = Math.abs(Math.sin(p.getX(i) * 127.1 + p.getY(i) * 311.7 + p.getZ(i) * 74.7) * 43758.5453) % 1;
    const k = 0.85 + 0.3 * h;
    p.setXYZ(i, p.getX(i) * k * 1.15, p.getY(i) * k * 0.8, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#7a7064', roughness: 0.95, flatShading: true }));
  m.castShadow = true;
  m.name = 'rock';
  return m;
}

/** buddhi ke baal (candy floss) on a thin stick: a soft pink cloud, 30 cm across; its origin at the stick's foot, +y up */
export function candyFloss(): THREE.Group {
  const g = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.34, 6).translate(0, 0.17, 0), new THREE.MeshStandardMaterial({ color: '#efe6d2', roughness: 0.8 }));
  const mat = new THREE.MeshStandardMaterial({ color: '#ff9cc8', roughness: 1, emissive: '#5a1f38', emissiveIntensity: 0.35, transparent: true, opacity: 0.93 });
  // a cloud of puffs about the stick's top
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4, r = i ? 0.06 + (i % 3) * 0.015 : 0;
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(i ? 0.07 + (i % 2) * 0.015 : 0.1, 2), mat);
    puff.position.set(Math.cos(a) * r, 0.36 + (i % 4) * 0.025 - (i ? 0.02 : 0), Math.sin(a) * r);
    g.add(puff);
  }
  g.add(stick);
  g.traverse((o) => { o.castShadow = true; });
  g.name = 'candyfloss';
  // the modelled one (models/cotton_candy.glb) takes the puffs' place once it has loaded
  void cottonCandy().then((m) => { g.clear(); g.add(m); }).catch(() => {});
  return g;
}

let cotton: Promise<THREE.Object3D> | null = null;
/** the cotton candy model, 0.5 m tall, set on the stick's foot (+y up); a copy each time */
async function cottonCandy(): Promise<THREE.Object3D> {
  cotton ??= gltfLoader().loadAsync('models/cotton_candy.glb').then((gltf) => {
    const m = gltf.scene;
    m.updateMatrixWorld(true);
    // the stick: the slimmer of its two meshes; its lowest point is where the hand holds it from
    const boxes: THREE.Box3[] = [];
    m.traverse((o) => { if ((o as THREE.Mesh).isMesh) boxes.push(new THREE.Box3().setFromObject(o)); });
    const all = new THREE.Box3().setFromObject(m), size = new THREE.Vector3();
    const stick = boxes.reduce((a, b) => (b.getSize(size).x * size.z < a.getSize(new THREE.Vector3()).x * a.getSize(new THREE.Vector3()).z ? b : a));
    const foot = stick.getCenter(new THREE.Vector3()).setY(all.min.y);
    const k = 0.5 / (all.max.y - all.min.y);
    const wrap = new THREE.Group();
    m.position.sub(foot);
    m.traverse((o) => { o.castShadow = true; });
    wrap.add(m);
    wrap.scale.setScalar(k);
    return wrap;
  });
  return (await cotton).clone();
}
