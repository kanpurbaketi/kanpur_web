#!/usr/bin/env python3
"""Convert raw Overpass JSON into game-ready chunk files.

Usage: python3 tools/osm/convert.py --area swaroop_nagar
Input : data/osm/raw/<area>.json
Output: game/data/map/<area>/index.json, chunk_<cx>_<cz>.json, roads_graph.json

Coordinates: local meters around the bbox center. Godot axes: +X east, -Z north, Y up.
Kanpur OSM building coverage is sparse, so buildings are procedurally added along
streets ("infill") wherever they don't overlap roads, parks, water or mapped buildings.
"""
import argparse
import json
import math
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CHUNK = 250.0

# Full road width (m) per highway class. None = not rendered.
ROAD_WIDTH = {
    "motorway": 16, "trunk": 14, "primary": 12, "secondary": 11, "tertiary": 9,
    "motorway_link": 7, "trunk_link": 7, "primary_link": 7, "secondary_link": 7, "tertiary_link": 7,
    "unclassified": 6.5, "residential": 6, "living_street": 5, "service": 4.5,
    "pedestrian": 4, "footway": 2, "path": 1.8, "steps": 2, "cycleway": 2, "track": 3.5,
}
DRIVABLE = {
    "motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link",
    "primary_link", "secondary_link", "tertiary_link", "unclassified", "residential",
    "living_street", "service",
}
INFILL_ON = {"trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street"}
# Kanpur-ish facade palette (pastels, sandstone, whitewash).
WALL_COLORS = [
    "#e8d7b9", "#f1e3c6", "#e7b9a3", "#f2c6c2", "#cfe0e8", "#f4efe2", "#e9d27f",
    "#c9b49a", "#d8c3a5", "#eaa979", "#b9d4b0", "#f0f0ea", "#d9a6b8", "#c7c3e0",
]


# ---------------------------------------------------------------- geometry helpers
def signed_area(poly):
    a = 0.0
    for i in range(len(poly)):
        x1, z1 = poly[i]
        x2, z2 = poly[(i + 1) % len(poly)]
        a += x1 * z2 - x2 * z1
    return a / 2.0


def centroid(poly):
    xs = sum(p[0] for p in poly) / len(poly)
    zs = sum(p[1] for p in poly) / len(poly)
    return xs, zs


def point_in_poly(pt, poly):
    x, z = pt
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, zi = poly[i]
        xj, zj = poly[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def seg_point_dist(a, b, p):
    ax, az = a
    bx, bz = b
    px, pz = p
    dx, dz = bx - ax, bz - az
    l2 = dx * dx + dz * dz
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / l2))
    cx, cz = ax + t * dx, az + t * dz
    return math.hypot(px - cx, pz - cz)


def segs_intersect(p1, p2, p3, p4):
    def orient(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    d1, d2 = orient(p3, p4, p1), orient(p3, p4, p2)
    d3, d4 = orient(p1, p2, p3), orient(p1, p2, p4)
    return (d1 > 0) != (d2 > 0) and (d3 > 0) != (d4 > 0)


def seg_poly_dist(a, b, poly):
    """Distance from segment ab to polygon (0 if they touch/overlap)."""
    if point_in_poly(a, poly) or point_in_poly(b, poly):
        return 0.0
    best = 1e9
    n = len(poly)
    for i in range(n):
        c, d = poly[i], poly[(i + 1) % n]
        if segs_intersect(a, b, c, d):
            return 0.0
        best = min(best, seg_point_dist(a, b, c), seg_point_dist(c, d, a), seg_point_dist(c, d, b))
    return best


def polys_overlap(p, q):
    """Polygon overlap test (works for simple polygons via edge crossing + containment)."""
    for i in range(len(p)):
        a, b = p[i], p[(i + 1) % len(p)]
        for j in range(len(q)):
            if segs_intersect(a, b, q[j], q[(j + 1) % len(q)]):
                return True
    return point_in_poly(p[0], q) or point_in_poly(q[0], p)


def bbox_of(poly, pad=0.0):
    xs = [p[0] for p in poly]
    zs = [p[1] for p in poly]
    return (min(xs) - pad, min(zs) - pad, max(xs) + pad, max(zs) + pad)


class Grid:
    """Uniform spatial hash of items keyed by bbox."""

    def __init__(self, cell=40.0):
        self.cell = cell
        self.cells = {}

    def _keys(self, bb):
        c = self.cell
        for gx in range(int(math.floor(bb[0] / c)), int(math.floor(bb[2] / c)) + 1):
            for gz in range(int(math.floor(bb[1] / c)), int(math.floor(bb[3] / c)) + 1):
                yield gx, gz

    def add(self, bb, item):
        for k in self._keys(bb):
            self.cells.setdefault(k, []).append(item)

    def query(self, bb):
        seen = set()
        for k in self._keys(bb):
            for it in self.cells.get(k, ()):
                if id(it) not in seen:
                    seen.add(id(it))
                    yield it


# ---------------------------------------------------------------- conversion
def parse_height(tags, rng):
    h = None
    if "height" in tags:
        try:
            h = float(tags["height"].split()[0])
        except ValueError:
            pass
    if h is None and "building:levels" in tags:
        try:
            h = float(tags["building:levels"]) * 3.2
        except ValueError:
            pass
    if h is None:
        h = rng.choice([2, 2, 3, 3, 3, 4]) * 3.2
    base = 0.0
    if "building:min_level" in tags or "building:min_levels" in tags:
        try:
            base = float(tags.get("building:min_level") or tags.get("building:min_levels")) * 3.2
        except ValueError:
            pass
    return round(h, 2), round(base, 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--area", required=True)
    ap.add_argument("--seed", type=int, default=1857)  # Kanpur's 1857 history
    ap.add_argument("--no-infill", action="store_true")
    args = ap.parse_args()

    areas = json.load(open(os.path.join(ROOT, "tools", "osm", "areas.json")))
    area = areas[args.area]
    s, w, n, e = area["bbox"]
    lat0, lon0 = (s + n) / 2, (w + e) / 2
    kx = math.cos(math.radians(lat0)) * 111320.0
    kz = 110540.0

    def proj(lat, lon):
        return (round((lon - lon0) * kx, 2), round(-(lat - lat0) * kz, 2))

    raw = json.load(open(os.path.join(ROOT, "data", "osm", "raw", args.area + ".json")))
    nodes, ways, rels = {}, {}, []
    for el in raw["elements"]:
        if el["type"] == "node":
            nodes[el["id"]] = el
        elif el["type"] == "way":
            ways[el["id"]] = el
        elif el["type"] == "relation":
            rels.append(el)

    def way_pts(way):
        return [proj(nodes[i]["lat"], nodes[i]["lon"]) for i in way["nodes"] if i in nodes]

    rng = random.Random(args.seed)
    roads, buildings, water, parks, rails, pois = [], [], [], [], [], []
    graph_nodes, graph_edges = {}, []

    def add_area(poly, target, extra):
        if len(poly) >= 4 and poly[0] == poly[-1]:
            poly = poly[:-1]
        if len(poly) < 3 or abs(signed_area(poly)) < 4:
            return
        d = {"pts": poly}
        d.update(extra)
        target.append(d)

    for way in ways.values():
        t = way.get("tags", {})
        pts = way_pts(way)
        if len(pts) < 2:
            continue
        if "highway" in t:
            hw = t["highway"]
            if hw not in ROAD_WIDTH or t.get("tunnel") in ("yes", "building_passage") or t.get("area") == "yes":
                continue
            width = ROAD_WIDTH[hw]
            if "lanes" in t and hw in DRIVABLE:
                try:
                    width = max(width, float(t["lanes"]) * 3.2)
                except ValueError:
                    pass
            roads.append({"pts": pts, "w": width, "cls": hw, "name": t.get("name", ""),
                          "oneway": t.get("oneway") == "yes", "bridge": t.get("bridge") == "yes"})
            if hw in DRIVABLE:
                ids = [i for i in way["nodes"] if i in nodes]
                for i in ids:
                    graph_nodes[i] = proj(nodes[i]["lat"], nodes[i]["lon"])
                for a, b in zip(ids, ids[1:]):
                    graph_edges.append([a, b, hw, 1 if t.get("oneway") == "yes" else 0])
        elif "building" in t:
            h, base = parse_height(t, rng)
            add_area(pts, buildings, {"h": h, "base": base, "name": t.get("name", ""),
                                      "color": rng.choice(WALL_COLORS), "src": "osm"})
        elif t.get("natural") == "water" or "water" in t or t.get("landuse") in ("reservoir", "basin"):
            add_area(pts, water, {"name": t.get("name", "")})
        elif t.get("leisure") in ("park", "garden", "playground", "pitch", "stadium") or \
                t.get("landuse") in ("grass", "recreation_ground", "forest", "meadow"):
            kind = t.get("leisure") or t.get("landuse")
            add_area(pts, parks, {"name": t.get("name", ""), "kind": kind})
        elif t.get("railway") == "rail" and t.get("bridge") != "yes" and t.get("tunnel") != "yes":
            rails.append({"pts": pts})

    # Multipolygon relations: use closed outer ways.
    for rel in rels:
        t = rel.get("tags", {})
        for m in rel.get("members", []):
            if m["type"] != "way" or m.get("role") != "outer" or m["ref"] not in ways:
                continue
            pts = way_pts(ways[m["ref"]])
            if "building" in t:
                h, base = parse_height(t, rng)
                add_area(pts, buildings, {"h": h, "base": base, "name": t.get("name", ""),
                                          "color": rng.choice(WALL_COLORS), "src": "osm"})
            elif t.get("natural") == "water":
                add_area(pts, water, {"name": t.get("name", "")})
            elif t.get("leisure") in ("park", "garden"):
                add_area(pts, parks, {"name": t.get("name", ""), "kind": t.get("leisure")})

    for nd in nodes.values():
        t = nd.get("tags", {})
        if t.get("name") and (("amenity" in t) or ("shop" in t) or ("tourism" in t) or t.get("railway") == "station"):
            x, z = proj(nd["lat"], nd["lon"])
            kind = t.get("amenity") or t.get("shop") or t.get("tourism") or "station"
            pois.append({"pos": [x, z], "name": t["name"], "name_hi": t.get("name:hi", ""), "kind": kind})

    # Name the largest water body near the Moti Jheel metro station "Moti Jheel" (lake is unnamed in OSM).
    for name, (lat, lon), radius in area.get("water_names", []):
        px, pz = proj(lat, lon)
        best, best_a = None, 0
        for wb in water:
            cx, cz = centroid(wb["pts"])
            a = abs(signed_area(wb["pts"]))
            if not wb["name"] and math.hypot(cx - px, cz - pz) < radius and a > best_a:
                best, best_a = wb, a
        if best:
            best["name"] = name

    # ------------------------------------------------------------ procedural infill
    infill = []
    if not args.no_infill:
        road_grid = Grid()
        for r in roads:
            for a, b in zip(r["pts"], r["pts"][1:]):
                seg = (a, b, r["w"] / 2.0)
                road_grid.add(bbox_of([a, b], r["w"] / 2.0), seg)
        block_grid = Grid()
        for coll in (water, parks, buildings):
            for f in coll:
                block_grid.add(bbox_of(f["pts"]), f["pts"])
        if rails:
            for r in rails:
                for a, b in zip(r["pts"], r["pts"][1:]):
                    road_grid.add(bbox_of([a, b], 4), (a, b, 4.0))

        def ok(poly):
            bb = bbox_of(poly, 1.0)
            for a, b, hw in road_grid.query(bbox_of(poly, 12)):
                if seg_poly_dist(a, b, poly) < hw + 1.2:
                    return False
            for other in block_grid.query(bb):
                if polys_overlap(poly, other):
                    return False
            return True

        for r in roads:
            if r["cls"] not in INFILL_ON or r["bridge"]:
                continue
            setback = r["w"] / 2.0 + 1.8
            for a, b in zip(r["pts"], r["pts"][1:]):
                dx, dz = b[0] - a[0], b[1] - a[1]
                L = math.hypot(dx, dz)
                if L < 8:
                    continue
                ux, uz = dx / L, dz / L
                for side in (-1, 1):
                    nx, nz = -uz * side, ux * side
                    s_pos = rng.uniform(2, 5)
                    while s_pos < L - 4:
                        front = rng.uniform(7, 12)
                        depth = rng.uniform(9, 16)
                        if s_pos + front > L - 1:
                            break
                        ox = a[0] + ux * s_pos + nx * setback
                        oz = a[1] + uz * s_pos + nz * setback
                        poly = [
                            (ox, oz),
                            (ox + ux * front, oz + uz * front),
                            (ox + ux * front + nx * depth, oz + uz * front + nz * depth),
                            (ox + nx * depth, oz + nz * depth),
                        ]
                        poly = [(round(x, 2), round(z, 2)) for x, z in poly]
                        if rng.random() < 0.9 and ok(poly):
                            floors = rng.choices([1, 2, 3, 4, 5], weights=[1, 4, 5, 3, 1])[0]
                            shop = r["cls"] in ("trunk", "primary", "secondary", "tertiary") and rng.random() < 0.7
                            bd = {"pts": poly, "h": round(floors * 3.2, 2), "base": 0.0, "name": "",
                                  "color": rng.choice(WALL_COLORS), "src": "gen", "shop": shop}
                            infill.append(bd)
                            block_grid.add(bbox_of(poly), poly)
                        s_pos += front + rng.uniform(0.0, 1.5)
        buildings.extend(infill)

    # ------------------------------------------------------------ chunking
    chunks = {}

    def chunk_of(x, z):
        return int(math.floor(x / CHUNK)), int(math.floor(z / CHUNK))

    def bucket(key):
        if key not in chunks:
            chunks[key] = {"roads": [], "buildings": [], "water": [], "parks": [], "rails": [], "pois": []}
        return chunks[key]

    def split_line(line, coll_name, extra):
        pts = line["pts"]
        cur, cur_key = [pts[0]], None
        for a, b in zip(pts, pts[1:]):
            k = chunk_of((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            if cur_key is not None and k != cur_key:
                bucket(cur_key)[coll_name].append(dict(extra, pts=cur))
                cur = [a]
            cur_key = k
            cur.append(b)
        if cur_key is not None and len(cur) >= 2:
            bucket(cur_key)[coll_name].append(dict(extra, pts=cur))

    for r in roads:
        split_line(r, "roads", {k: v for k, v in r.items() if k != "pts"})
    for r in rails:
        split_line(r, "rails", {})
    for coll_name, coll in (("buildings", buildings), ("water", water), ("parks", parks)):
        for f in coll:
            bucket(chunk_of(*centroid(f["pts"])))[coll_name].append(f)
    for p in pois:
        bucket(chunk_of(*p["pos"]))["pois"].append(p)

    out_dir = os.path.join(ROOT, "game", "data", "map", args.area)
    os.makedirs(out_dir, exist_ok=True)
    for old in os.listdir(out_dir):
        if old.endswith(".json"):
            os.remove(os.path.join(out_dir, old))
    for (cx, cz), data in chunks.items():
        with open(os.path.join(out_dir, "chunk_%d_%d.json" % (cx, cz)), "w") as f:
            json.dump(data, f, separators=(",", ":"))

    xs = [p[0] for r in roads for p in r["pts"]] or [0]
    zs = [p[1] for r in roads for p in r["pts"]] or [0]
    index = {
        "area": args.area, "title": area.get("title", args.area), "chunk_size": CHUNK,
        "origin_latlon": [lat0, lon0], "meters_per_deg": [kx, kz],
        "bounds": [min(xs), min(zs), max(xs), max(zs)],
        "chunks": sorted([[cx, cz] for cx, cz in chunks]),
        "landmarks": {name: list(proj(lat, lon)) for name, (lat, lon) in area.get("landmarks", {}).items()},
        "attribution": "Map data © OpenStreetMap contributors (ODbL)",
    }
    with open(os.path.join(out_dir, "index.json"), "w") as f:
        json.dump(index, f, indent=1)

    used = {}
    for a, b, _, _ in graph_edges:
        used[a] = graph_nodes[a]
        used[b] = graph_nodes[b]
    with open(os.path.join(out_dir, "roads_graph.json"), "w") as f:
        json.dump({"nodes": {str(k): v for k, v in used.items()}, "edges": graph_edges}, f, separators=(",", ":"))

    print("roads %d, buildings %d (osm %d + infill %d), water %d, parks %d, rails %d, pois %d, chunks %d"
          % (len(roads), len(buildings), len(buildings) - len(infill), len(infill), len(water), len(parks),
             len(rails), len(pois), len(chunks)))
    print("water names:", [wb["name"] for wb in water if wb["name"]])
    print("->", out_dir)


if __name__ == "__main__":
    sys.exit(main())
