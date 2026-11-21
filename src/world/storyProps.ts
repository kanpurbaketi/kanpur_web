import * as THREE from 'three';

/*
 Small things the story hands about (stage 1, part 2): a brass lota. Made here, from a turned profile; each stands on
 its own origin.
*/

/** a brass lota, 20 cm tall: a small foot, a round belly, a narrow neck (held by it: 0.165 m up) and a flared lip */
export function lota(): THREE.Mesh {
  const outer: [number, number][] = [
    [0, 0], [0.034, 0], [0.04, 0.006], [0.036, 0.016], [0.05, 0.028], [0.07, 0.05], [0.081, 0.078], [0.08, 0.1],
    [0.07, 0.122], [0.052, 0.142], [0.036, 0.158], [0.031, 0.172], [0.036, 0.186], [0.05, 0.198], [0.054, 0.203],
  ];
  // the lip folds over and the inside goes down into the neck (it is seen into from above)
  const inner: [number, number][] = [[0.048, 0.204], [0.034, 0.19], [0.027, 0.172], [0.027, 0.15]];
  const pts = [...outer, ...inner].map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(pts, 28);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#c99636', metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide }));
  m.castShadow = true;
  m.name = 'lota';
  return m;
}

export const LOTA_NECK = 0.165;
