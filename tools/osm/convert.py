#!/usr/bin/env python3
"""Merge OSM + Overture (+ Mapillary) raw data into one web-ready map.json.

Usage: python3 tools/osm/convert.py --area moti_jheel
Input : data/raw/<area>.osm.json, data/raw/<area>.overture.json (optional), data/raw/<area>.mapillary.json (optional)
Output: public/data/<area>/map.json

Coordinates: local meters around the bbox center. +X east, +Z south, Y up (three.js friendly).
No procedural infill: every building is a real footprint (OSM first, then Overture/ML footprints).
Heights: OSM tags -> Overture height/floors -> estimate (tagged hsrc="est").
"""
import argparse
import hashlib
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geom import Grid, bbox_of, centroid, overlap_fraction, point_in_poly, polys_overlap, seg_point_dist, signed_area  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FLOOR_H = 3.2

# Full carriageway width (m) per class when OSM has no lanes tag. Tuned to Kanpur streets.
ROAD_WIDTH = {
    "motorway": 16, "trunk": 14, "primary": 12, "secondary": 10, "tertiary": 8,
    "motorway_link": 7, "trunk_link": 7, "primary_link": 7, "secondary_link": 7, "tertiary_link": 6.5,
    "unclassified": 6, "residential": 5.5, "living_street": 4.5, "service": 4,
    "pedestrian": 4, "footway": 2, "path": 1.8, "steps": 2, "cycleway": 2, "track": 3.5,
}
DRIVABLE = {
    "motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link",
    "primary_link", "secondary_link", "tertiary_link", "unclassified", "residential",
    "living_street", "service",
}
MAJOR = {"trunk", "primary", "secondary", "tertiary", "secondary_link", "trunk_link", "primary_link"}
SIDEWALK_DEFAULT = {"trunk": "both", "primary": "both", "secondary": "both", "tertiary": "both"}


def stable_rand(*keys):
    """Deterministic 0..1 from keys (same output every run, independent of processing order)."""
    h = hashlib.md5(("|".join(str(k) for k in keys)).encode()).hexdigest()
    return int(h[:8], 16) / 0xFFFFFFFF


def num(v):
    try:
        return float(str(v).split()[0].replace(",", "."))
    except (ValueError, IndexError):
        return None


def osm_height(t):
    h = num(t["height"]) if "height" in t else None
    if h is None and "building:levels" in t:
        lv = num(t["building:levels"])
        h = lv * FLOOR_H if lv else None
    base = 0.0
    ml = t.get("building:min_level") or t.get("building:min_levels")
    if ml and num(ml):
        base = num(ml) * FLOOR_H
    return h, base


def estimate_floors(area_m2, near_major, key):
    """Kanpur residential colonies: mostly 2-3 floors; big footprints on main roads go higher."""
    r = stable_rand("floors", key)
    if area_m2 < 25:
        return 1
    if area_m2 < 60:
        return 1 if r < 0.35 else 2
    if area_m2 < 200:
        opts = [2, 2, 3, 3, 3, 4] if not near_major else [2, 3, 3, 4, 4, 5]
    elif area_m2 < 600:
        opts = [2, 3, 3, 4] if not near_major else [3, 4, 4, 5]
    else:
        opts = [2, 3, 4, 5]
    return opts[int(r * len(opts)) % len(opts)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--area", required=True)
    args = ap.parse_args()

    areas = json.load(open(os.path.join(ROOT, "tools", "osm", "areas.json")))
    area = areas[args.area]
    styles = json.load(open(os.path.join(ROOT, "tools", "osm", "street_styles.json")))
    s, w, n, e = area["bbox"]
    lat0, lon0 = (s + n) / 2, (w + e) / 2
    kx = math.cos(math.radians(lat0)) * 111320.0
    kz = 110540.0

    def proj(lat, lon):
        return [round((lon - lon0) * kx, 2), round(-(lat - lat0) * kz, 2)]

    minx, maxz = proj(s, w)
    maxx, minz = proj(n, e)
    bounds = [minx, minz, maxx, maxz]

    CLIP = 80.0  # keep a margin of street beyond the play area

    def clip_line(pts, pad=CLIP):
        """Clip a polyline to the padded bbox; returns a list of pieces."""
        x0, z0, x1, z1 = bounds[0] - pad, bounds[1] - pad, bounds[2] + pad, bounds[3] + pad

        def clip_seg(a, b):
            t0, t1 = 0.0, 1.0
            dx, dz = b[0] - a[0], b[1] - a[1]
            for p_, q_ in ((-dx, a[0] - x0), (dx, x1 - a[0]), (-dz, a[1] - z0), (dz, z1 - a[1])):
                if p_ == 0:
                    if q_ < 0:
                        return None
                    continue
                t = q_ / p_
                if p_ < 0:
                    t0 = max(t0, t)
                else:
                    t1 = min(t1, t)
                if t0 > t1:
                    return None
            return ([round(a[0] + dx * t0, 2), round(a[1] + dz * t0, 2)],
                    [round(a[0] + dx * t1, 2), round(a[1] + dz * t1, 2)])

        pieces, cur = [], []
        for a, b in zip(pts, pts[1:]):
            c = clip_seg(a, b)
            if c is None:
                if len(cur) >= 2:
                    pieces.append(cur)
                cur = []
                continue
            if not cur or cur[-1] != c[0]:
                if len(cur) >= 2:
                    pieces.append(cur)
                cur = [c[0]]
            cur.append(c[1])
        if len(cur) >= 2:
            pieces.append(cur)
        return pieces

    def inside(p, pad=0.0):
        return bounds[0] - pad <= p[0] <= bounds[2] + pad and bounds[1] - pad <= p[1] <= bounds[3] + pad

    raw_dir = os.path.join(ROOT, "data", "raw")
    raw = json.load(open(os.path.join(raw_dir, args.area + ".osm.json")))
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

    def ring(pts):
        if len(pts) >= 4 and pts[0] == pts[-1]:
            pts = pts[:-1]
        return pts if len(pts) >= 3 and abs(signed_area(pts)) >= 4 else None

    roads, rails, water, parks, barriers, power_lines, platforms, landuse = [], [], [], [], [], [], [], []
    osm_buildings, furniture, pois = [], [], []


    for wid, way in ways.items():
        t = way.get("tags", {})
        pts = way_pts(way)
        if len(pts) < 2:
            continue
        if "highway" in t:
            hw = t["highway"]
            if hw not in ROAD_WIDTH or t.get("tunnel") in ("yes", "building_passage") or t.get("area") == "yes":
                continue
            lanes = num(t.get("lanes")) if t.get("lanes") else None
            width = ROAD_WIDTH[hw]
            if "width" in t and num(t["width"]):
                width = num(t["width"])
            elif lanes and hw in DRIVABLE:
                width = max(width * 0.8, lanes * 3.2)
            divider = t.get("dual_carriageway") == "yes" or t.get("divider") not in (None, "no")
            sidewalk = t.get("sidewalk") or t.get("sidewalk:both") or SIDEWALK_DEFAULT.get(hw, "")
            for piece in clip_line(pts):
                roads.append({"id": wid, "pts": piece, "w": round(width, 2), "cls": hw,
                              "name": t.get("name", ""), "oneway": t.get("oneway") == "yes", "lanes": lanes or 0,
                              "bridge": t.get("bridge") not in (None, "no"),
                              "layer": int(num(t.get("layer", 0)) or 0),
                              "divider": divider, "sidewalk": sidewalk, "surface": t.get("surface", "")})
        elif "building" in t:
            r = ring(pts)
            if r:
                h, base = osm_height(t)
                osm_buildings.append({"pts": r, "h": h, "base": base, "name": t.get("name", ""),
                                      "src": "osm", "kind": t["building"],
                                      "colour": t.get("building:colour", ""), "roof": t.get("roof:shape", "")})
        elif t.get("natural") == "water" or "water" in t or t.get("landuse") in ("reservoir", "basin"):
            r = ring(pts)
            if r:
                water.append({"pts": r, "name": t.get("name", "")})
        elif t.get("leisure") in ("park", "garden", "playground", "pitch", "stadium") or \
                t.get("landuse") in ("grass", "recreation_ground", "forest", "meadow"):
            r = ring(pts)
            if r:
                parks.append({"pts": r, "name": t.get("name", ""), "kind": t.get("leisure") or t.get("landuse")})
        elif t.get("railway") in ("rail", "subway", "light_rail") and t.get("tunnel") != "yes":
            for piece in clip_line(pts):
                rails.append({"pts": piece, "kind": t["railway"], "layer": int(num(t.get("layer", 0)) or 0),
                          "bridge": t.get("bridge") not in (None, "no"), "name": t.get("name", "")})
        elif t.get("railway") == "platform" or t.get("public_transport") == "platform":
            platforms.append({"pts": pts, "name": t.get("name", "")})
        elif "barrier" in t:
            for piece in clip_line(pts):
                barriers.append({"pts": piece, "kind": t["barrier"]})
        elif t.get("power") in ("line", "minor_line"):
            for piece in clip_line(pts):
                power_lines.append({"pts": piece, "kind": t["power"]})
        elif "landuse" in t or "amenity" in t:
            r = ring(pts)
            if r:
                landuse.append({"pts": r, "kind": t.get("landuse") or t.get("amenity"), "name": t.get("name", "")})

    for rel in rels:
        t = rel.get("tags", {})
        for m in rel.get("members", []):
            if m["type"] != "way" or m.get("role") != "outer" or m["ref"] not in ways:
                continue
            r = ring(way_pts(ways[m["ref"]]))
            if not r:
                continue
            if "building" in t:
                h, base = osm_height(t)
                osm_buildings.append({"pts": r, "h": h, "base": base, "name": t.get("name", ""), "src": "osm",
                                      "kind": t["building"], "colour": t.get("building:colour", ""), "roof": ""})
            elif t.get("natural") == "water":
                water.append({"pts": r, "name": t.get("name", "")})
            elif t.get("leisure") in ("park", "garden"):
                parks.append({"pts": r, "name": t.get("name", ""), "kind": t.get("leisure")})

    FURN = {("highway", "street_lamp"): "lamp", ("highway", "traffic_signals"): "signal",
            ("highway", "bus_stop"): "bus_stop", ("highway", "crossing"): "crossing",
            ("natural", "tree"): "tree", ("power", "pole"): "pole", ("power", "tower"): "tower",
            ("barrier", "gate"): "gate", ("railway", "subway_entrance"): "metro_entrance"}
    for nd in nodes.values():
        t = nd.get("tags", {})
        if not t:
            continue
        p = proj(nd["lat"], nd["lon"])
        if not inside(p, CLIP):
            continue
        for (k, v), kind in FURN.items():
            if t.get(k) == v:
                furniture.append({"t": kind, "p": p, "src": "osm"})
        if t.get("name") and ("amenity" in t or "shop" in t or "tourism" in t or "railway" in t):
            pois.append({"p": p, "name": t["name"], "name_hi": t.get("name:hi", ""),
                         "kind": t.get("amenity") or t.get("shop") or t.get("tourism") or t.get("railway")})

    # Name unnamed water (Moti Jheel is unnamed in OSM).
    for name, (lat, lon), radius in area.get("water_names", []):
        px, pz = proj(lat, lon)
        best = max((wb for wb in water if not wb["name"] and
                    math.hypot(centroid(wb["pts"])[0] - px, centroid(wb["pts"])[1] - pz) < radius),
                   key=lambda wb: abs(signed_area(wb["pts"])), default=None)
        if best:
            best["name"] = name

    # ---------------------------------------------------------------- buildings: OSM + Overture
    bgrid = Grid(30.0)
    buildings = []
    for b in osm_buildings:
        buildings.append(b)
        bgrid.add(bbox_of(b["pts"]), b["pts"])

    ov_path = os.path.join(raw_dir, args.area + ".overture.json")
    n_ov, n_ov_dup, n_ov_road = 0, 0, 0
    road_grid = Grid(30.0)
    for r in roads:
        if r["bridge"] or r["layer"] > 0:
            continue
        for a, b in zip(r["pts"], r["pts"][1:]):
            road_grid.add(bbox_of([a, b], r["w"] / 2), (a, b, r["w"] / 2, r))

    ml_files = [p for p in (ov_path, os.path.join(raw_dir, args.area + ".ms.json")) if os.path.exists(p)]
    for path_ in ml_files:
        ov = json.load(open(path_))
        for ob in ov["buildings"]:
            pts = ring([proj(lat, lon) for lon, lat in ob["pts"]])
            if not pts or not inside(centroid(pts), 30):
                continue
            # Duplicate if it substantially covers an accepted footprint (OSM first); terraced
            # neighbours that merely touch or overlap by a sliver are kept.
            dup = False
            for q in bgrid.query(bbox_of(pts)):
                if polys_overlap(pts, q) and (overlap_fraction(pts, q) > 0.3 or overlap_fraction(q, pts) > 0.3):
                    dup = True
                    break
            if dup:
                n_ov_dup += 1
                continue
            c = centroid(pts)
            if any(seg_point_dist(a, b, c) < hw for a, b, hw, _ in road_grid.query(bbox_of([c], 2))):
                n_ov_road += 1   # footprint centered on a road: misdetection or stale OSM road
                continue
            h = ob["height"] if ob["height"] and ob["height"] > 2 else None
            hs = "overture" if h else None
            if not h and ob["floors"]:
                h, hs = ob["floors"] * FLOOR_H, "overture_floors"
            buildings.append({"pts": pts, "h": h, "base": 0.0, "name": "", "src": "ov:" + (ob["source"] or "?"),
                              "kind": ob.get("cls") or "", "colour": "", "roof": ob.get("roof") or "",
                              "_hs": hs})
            bgrid.add(bbox_of(pts), pts)
            n_ov += 1
    if not ml_files:
        print("WARNING: no Overture / MS file; only OSM buildings (run fetch_overture.py)")

    # Frontage, style and height for every building.
    def style_for(road):
        if road is None:
            return styles["roads"]["default"]
        return styles["roads"].get(str(road["id"])) or styles["roads"].get("cls:" + road["cls"]) or \
            styles["roads"]["default"]

    hcount = {}
    for i, b in enumerate(buildings):
        pts = b["pts"]
        if signed_area(pts) > 0:      # consistent winding (clockwise in x/z screen space)
            pts.reverse()
        c = centroid(pts)
        key = "%.1f,%.1f" % (c[0], c[1])
        area_m2 = abs(signed_area(pts))
        # nearest road (within 25 m) and the edges that face a road
        nearest, nd = None, 1e9
        front = []
        cand = list(road_grid.query(bbox_of(pts, 25)))
        for a, bb, hw, r in cand:
            d = seg_point_dist(a, bb, c) - hw
            if d < nd:
                nd, nearest = d, r
        for k in range(len(pts)):
            p, q = pts[k], pts[(k + 1) % len(pts)]
            L = math.hypot(q[0] - p[0], q[1] - p[1])
            if L < 2.5:
                continue
            mx, mz = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
            nx, nz = (q[1] - p[1]) / L, -(q[0] - p[0]) / L    # outward normal for this winding
            if point_in_poly((mx + nx * 0.5, mz + nz * 0.5), pts):
                nx, nz = -nx, -nz
            probe = (mx + nx * 6, mz + nz * 6)
            for a, bb, hw, r in cand:
                if r["cls"] in DRIVABLE and seg_point_dist(a, bb, probe) < hw + 5:
                    front.append(k)
                    break
        near_major = nearest is not None and nearest["cls"] in MAJOR and nd < 12
        st_name = style_for(nearest if nd < 25 else None)
        st = styles["styles"][st_name]
        if b["h"]:
            hs = b.pop("_hs", None) or "osm"
        else:
            b.pop("_hs", None)
            floors = estimate_floors(area_m2, near_major, key)
            b["h"], hs = floors * FLOOR_H, "est"
        b["h"] = round(b["h"], 2)
        b["hsrc"] = hs
        hcount[hs] = hcount.get(hs, 0) + 1
        b["style"] = st_name
        b["color"] = b.pop("colour") or st["palette"][int(stable_rand("col", key) * len(st["palette"])) % len(st["palette"])]
        b["front"] = front
        b["shop"] = bool(front) and stable_rand("shop", key) < st["shop_share"]
        b["seed"] = round(stable_rand("seed", key), 4)

    # ---------------------------------------------------------------- Mapillary
    mly_path = os.path.join(raw_dir, args.area + ".mapillary.json")
    photos = []
    if os.path.exists(mly_path):
        mly = json.load(open(mly_path))
        MAP = {"object--support--utility-pole": "pole", "object--street-light": "lamp",
               "object--traffic-light": "signal", "nature--tree": "tree", "object--bench": "bench",
               "object--trash-can": "bin", "object--fire-hydrant": "hydrant"}
        for f in mly["features"]:
            kind = next((v for k, v in MAP.items() if f["value"].startswith(k)), None)
            if kind is None and f["value"].startswith("object--sign"):
                kind = "sign"
            if kind:
                p = proj(f["lat"], f["lon"])
                if inside(p):
                    furniture.append({"t": kind, "p": p, "src": "mapillary"})
        for im in mly["images"]:
            if im.get("thumb"):
                photos.append({"id": im["id"], "p": proj(im["lat"], im["lon"]), "heading": im["heading"],
                               "lat": im["lat"], "lon": im["lon"]})

    # ---------------------------------------------------------------- write
    out = {
        "area": args.area, "title": area.get("title", args.area),
        "origin_latlon": [lat0, lon0], "meters_per_deg": [kx, kz], "bounds": bounds, "floor_h": FLOOR_H,
        "roads": roads, "buildings": buildings, "water": water, "parks": parks, "rails": rails,
        "platforms": platforms, "barriers": barriers, "power_lines": power_lines, "landuse": landuse,
        "furniture": furniture, "pois": pois, "photos": photos,
        "landmarks": {k: proj(lat, lon) for k, (lat, lon) in area.get("landmarks", {}).items()},
        "styles": styles["styles"],
        "attribution": "© OpenStreetMap contributors (ODbL) · Overture Maps Foundation · Mapillary (CC-BY-SA)",
    }
    out_dir = os.path.join(ROOT, "public", "data", args.area)
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "map.json")
    with open(path, "w") as f:
        json.dump(out, f, separators=(",", ":"))

    fc = {}
    for x in furniture:
        fc[x["t"]] = fc.get(x["t"], 0) + 1
    print("roads %d (named %d), rails %d, water %d %s, parks %d" % (
        len(roads), sum(1 for r in roads if r["name"]), len(rails), len(water),
        [x["name"] for x in water if x["name"]], len(parks)))
    print("buildings %d: osm %d, overture %d (skipped: %d dup, %d on roads)" % (
        len(buildings), len(osm_buildings), n_ov, n_ov_dup, n_ov_road))
    print("height sources", hcount, "| shops", sum(1 for b in buildings if b["shop"]))
    print("furniture", fc, "| photos", len(photos), "| pois", len(pois))
    print("-> %s (%.1f KB)" % (path, os.path.getsize(path) / 1024))


if __name__ == "__main__":
    main()
