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

/** a fist-sized rock off the mela's ground: a lumpy grey-brown stone, its origin in its middle */
export function rock(): THREE.Mesh {
  const geo = new THREE.IcosahedronGeometry(0.075, 1);
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const k = 0.8 + 0.4 * Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1);
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
  return g;
}
