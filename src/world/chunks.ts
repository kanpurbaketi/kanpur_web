import * as THREE from 'three';

/*
 Drawing less of what cannot be seen (the trees, the grass, the still figures, the street's small things):
 - splitInstances: one InstancedMesh over a whole area has one bounding sphere round all of it, so the whole of it is
   drawn whenever any of it is on screen (all the town's trees, for one tree in view); cut into squares of `cell` m,
   each square is its own mesh, left out when off screen;
 - cullFar: a static thing hidden past a distance from the camera (counted from its bounding sphere's nearest point,
   and as it looks on screen: a cutscene's long lens brings it nearer), or shown only from a distance on (`near`: the
   far, lighter version of something); main.ts calls updateCull every frame.
*/

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * A static InstancedMesh cut into one per `cell` m square of its instances (in its own frame), each with its own bounding
 * sphere. Returned in a group standing where the mesh stood, to take its place.
 */
export function splitInstances(im: THREE.InstancedMesh, cell: number): THREE.Group {
  const out = new THREE.Group();
  out.name = im.name;
  out.position.copy(im.position);
  out.quaternion.copy(im.quaternion);
  out.scale.copy(im.scale);
  const cells = new Map<string, number[]>();
  for (let i = 0; i < im.count; i++) {
    im.getMatrixAt(i, _m);
    _p.setFromMatrixPosition(_m);
    const k = `${Math.floor(_p.x / cell)},${Math.floor(_p.z / cell)}`;
    let l = cells.get(k);
    if (!l) cells.set(k, (l = []));
    l.push(i);
  }
  for (const list of cells.values()) {
    const part = new THREE.InstancedMesh(im.geometry, im.material, list.length);
    list.forEach((i, j) => {
      im.getMatrixAt(i, _m);
      part.setMatrixAt(j, _m);
      if (im.instanceColor) { im.getColorAt(i, _c); part.setColorAt(j, _c); }
    });
    part.castShadow = im.castShadow;
    part.receiveShadow = im.receiveShadow;
    part.renderOrder = im.renderOrder;
    part.userData = { ...im.userData };
    part.frustumCulled = true;
    part.computeBoundingSphere();
    out.add(part);
  }
  return out;
}

interface Entry { o: THREE.Object3D; far: number; near: number; c: THREE.Vector3; r: number; ready: boolean }
const entries: Entry[] = [];

/**
 * Hide `o` (static: its place is read once) past `far` m from the camera; with `near`, also nearer than that (the far
 * version of something). A group: each of its meshes on its own.
 */
export function cullFar(o: THREE.Object3D, far: number, near = 0): void {
  const add = (x: THREE.Object3D) => entries.push({ o: x, far, near, c: new THREE.Vector3(), r: 0, ready: false });
  if ((o as THREE.Mesh).isMesh) add(o);
  else o.traverse((x) => { if ((x as THREE.Mesh).isMesh) add(x); });
}

/** every frame: the camera's place, and its lens against the usual one (Actor.zoom: 1 the usual; less, a long lens: things look nearer) */
export function updateCull(cam: THREE.Vector3, zoom = 1): void {
  for (const e of entries) {
    if (!e.ready) {
      // its world bounding sphere, once it is in the scene
      const m = e.o as THREE.Mesh;
      if (!m.parent) continue;
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      const s = ((m as THREE.InstancedMesh).isInstancedMesh && (m as THREE.InstancedMesh).boundingSphere
        ? (m as THREE.InstancedMesh).boundingSphere! : m.geometry.boundingSphere!).clone();
      m.updateWorldMatrix(true, false);
      s.applyMatrix4(m.matrixWorld);
      e.c.copy(s.center);
      e.r = s.radius;
      e.ready = true;
    }
    const d = Math.max(0, e.c.distanceTo(cam) - e.r) * zoom;
    e.o.visible = d < e.far && d >= e.near;
  }
}
