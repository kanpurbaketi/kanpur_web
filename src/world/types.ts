// Shape of public/data/<area>/map.json (written by tools/osm/convert.py).
export type P2 = [number, number]; // [x east, z south] in meters

export interface Road {
  id: number;
  pts: P2[];
  w: number;
  cls: string;
  name: string;
  oneway: boolean;
  lanes: number;
  bridge: boolean;
  layer: number;
  divider: boolean;
  sidewalk: string;
  surface: string;
}

export interface Building {
  pts: P2[];
  h: number;
  base: number;
  name: string;
  src: string;
  hsrc: string;
  kind: string;
  roof: string;
  style: string;
  color: string;
  front: number[]; // indices of edges facing a drivable road
  shop: boolean;
  seed: number;
}

export interface Style {
  covered: boolean;
  palette: string[];
  shop_share: number;
  shutters: string[];
  signs: string[];
  balcony_share: number;
  boundary_wall?: boolean;
  tree_every_m: number;
}

export interface MapData {
  area: string;
  title: string;
  origin_latlon: [number, number];
  meters_per_deg: [number, number];
  bounds: [number, number, number, number];
  floor_h: number;
  roads: Road[];
  buildings: Building[];
  water: { pts: P2[]; name: string }[];
  parks: { pts: P2[]; name: string; kind: string }[];
  rails: { pts: P2[]; kind: string; layer: number; bridge: boolean; name: string }[];
  platforms: { pts: P2[]; name: string }[];
  barriers: { pts: P2[]; kind: string }[];
  power_lines: { pts: P2[]; kind: string }[];
  landuse: { pts: P2[]; kind: string; name: string }[];
  furniture: { t: string; p: P2; src: string }[];
  pois: { p: P2; name: string; name_hi: string; kind: string }[];
  photos: { id: string; p: P2; heading: number; lat: number; lon: number }[];
  landmarks: Record<string, P2>;
  styles: Record<string, Style>;
  attribution: string;
}

export const DRIVABLE = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link',
  'primary_link', 'secondary_link', 'tertiary_link', 'unclassified', 'residential',
  'living_street', 'service',
]);
export const MARKED = new Set(['trunk', 'primary', 'secondary', 'tertiary']);

/** lat/lon -> local meters, same projection as convert.py. */
export function project(map: MapData, lat: number, lon: number): P2 {
  const [lat0, lon0] = map.origin_latlon;
  const [kx, kz] = map.meters_per_deg;
  return [(lon - lon0) * kx, -(lat - lat0) * kz];
}

/** Deterministic 0..1 hash for stable per-object variation. */
export function hash2(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export function signedArea(poly: P2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}

export function pointInPoly(x: number, z: number, poly: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

export function centroid(poly: P2[]): P2 {
  let x = 0;
  let z = 0;
  for (const p of poly) {
    x += p[0];
    z += p[1];
  }
  return [x / poly.length, z / poly.length];
}
