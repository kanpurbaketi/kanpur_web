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
