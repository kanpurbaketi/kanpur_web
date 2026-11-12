#!/usr/bin/env python3
"""Build the data of every part of Kanpur in bulk (much faster than build_part.py one part at a time).

Usage: .venv/bin/python tools/osm/build_city.py [--stage overture|osm|convert|all] [--only id,id,...] [--block 4]
  overture  ONE scan of the Overture buildings for the whole city, split into data/raw/<part>.overture.json   (~15-25 min)
  osm       Overpass queries for blocks of --block x --block parts (default 4x4), filtered per part -> data/raw/<part>.osm.json
  convert   tools/osm/convert.py for every part with both inputs -> public/data/<part>/map.json
Every stage skips what already exists, so it can be stopped and restarted. Run tools/osm/make_parts.py first.
Needs duckdb (in .venv). Data: OpenStreetMap contributors (ODbL), Overture Maps (ODbL / CC-BY).
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW = os.path.join(ROOT, "data", "raw")
MANIFEST = os.path.join(ROOT, "public", "data", "parts.json")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetch_osm  # noqa: E402  (QUERY, ENDPOINTS, _post)


def manifest():
    return json.load(open(MANIFEST))


def save_manifest(m):
    json.dump(m, open(MANIFEST, "w"), indent=0, ensure_ascii=False)


# ---------------------------------------------------------------- overture
def stage_overture(m, only):
    import duckdb
    g = m["grid"]
    parts = {(p["row"], p["col"]): p for p in m["parts"] if not only or p["id"] in only}
    todo = {k: p for k, p in parts.items() if not os.path.exists(os.path.join(RAW, p["id"] + ".overture.json"))}
    if not todo:
        print("overture: nothing to do")
        return
    rel = json.load(urllib.request.urlopen("https://stac.overturemaps.org/catalog.json", timeout=30))["latest"]
    south = min(p["bbox"][0] for p in todo.values()); west = min(p["bbox"][1] for p in todo.values())
    north = max(p["bbox"][2] for p in todo.values()); east = max(p["bbox"][3] for p in todo.values())
    print("overture %s: one scan of %.2f..%.2f N, %.2f..%.2f E for %d parts" % (rel, south, north, west, east, len(todo)))
    con = duckdb.connect()
    for stmt in ("INSTALL httpfs", "LOAD httpfs", "SET s3_region='us-west-2'"):
        con.execute(stmt)
    for stmt in ("INSTALL spatial", "LOAD spatial"):
        con.execute(stmt)
    url = "s3://overturemaps-us-west-2/release/%s/theme=buildings/type=building/*" % rel
    q = """
    SELECT id, sources[1].dataset, height, num_floors, roof_shape, class, ST_AsGeoJSON(geometry),
           bbox.xmin, bbox.xmax, bbox.ymin, bbox.ymax
    FROM read_parquet('%s', hive_partitioning=1)
    WHERE bbox.xmin <= %f AND bbox.xmax >= %f AND bbox.ymin <= %f AND bbox.ymax >= %f
    """ % (url, east, west, north, south)
    t0 = time.time()
    cur = con.execute(q)
    buckets = {k: [] for k in todo}
    n = 0
    while True:
        rows = cur.fetchmany(20000)
        if not rows:
            break
        for bid, src, h, floors, roof, cls, geom, x0, x1, y0, y1 in rows:
            n += 1
            i0, i1 = int((y0 - g["south"]) // g["dlat"]), int((y1 - g["south"]) // g["dlat"])
            j0, j1 = int((x0 - g["west"]) // g["dlon"]), int((x1 - g["west"]) // g["dlon"])
            for i in range(i0, i1 + 1):
                for j in range(j0, j1 + 1):
                    b = buckets.get((i, j))
                    if b is not None:
                        b.append((bid, src, h, floors, roof, cls, geom))
        print("  %d buildings (%.0f s)" % (n, time.time() - t0), flush=True)
    for (i, j), p in todo.items():
        out = []
        for bid, src, h, floors, roof, cls, geom in buckets[(i, j)]:
            gj = json.loads(geom)
            polys = [gj["coordinates"]] if gj["type"] == "Polygon" else gj["coordinates"] if gj["type"] == "MultiPolygon" else []
            for poly in polys:
                out.append({"id": bid, "source": src or "", "height": h, "floors": floors, "roof": roof, "cls": cls,
                            "pts": [[round(x, 7), round(y, 7)] for x, y in poly[0]]})
        json.dump({"release": rel, "buildings": out}, open(os.path.join(RAW, p["id"] + ".overture.json"), "w"))
    print("overture: wrote %d parts (%d building rows scanned, %.0f s)" % (len(todo), n, time.time() - t0))


# ---------------------------------------------------------------- osm
def query_block(bbox):
    s, w, n, e = bbox
    q = fetch_osm.QUERY.replace("{b}", "%f,%f,%f,%f" % (s, w, n, e))
    data = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for attempt in range(3):
        for url in fetch_osm.ENDPOINTS:
            try:
                print("  querying", url, flush=True)
                return json.loads(fetch_osm._post(url, data))
            except Exception as ex:  # noqa: BLE001
                last = ex
                print("   failed:", str(ex)[:120], flush=True)
        time.sleep(30)
    raise RuntimeError("Overpass failed: %s" % last)


def filter_elements(elements, bbox, pad=0.0006):
    """Keep what touches the part: nodes inside, ways with a node inside (plus all their nodes), relations of kept ways."""
    s, w, n, e = bbox
    s -= pad; w -= pad; n += pad; e += pad
    nodes = {el["id"]: el for el in elements if el["type"] == "node"}
    inside = {i for i, el in nodes.items() if s <= el["lat"] <= n and w <= el["lon"] <= e}
    keep_ways, need = [], set()
    for el in elements:
        if el["type"] == "way" and any(r in inside for r in el.get("nodes", [])):
            keep_ways.append(el)
            need.update(el["nodes"])
    kept = {el["id"] for el in keep_ways}
    rels = [el for el in elements if el["type"] == "relation" and any(mm["type"] == "way" and mm["ref"] in kept for mm in el.get("members", []))]
    # relation member ways must be there too (they may lie outside the pad)
    for el in rels:
        for mm in el["members"]:
            if mm["type"] == "way" and mm["ref"] not in kept:
                w_el = next((x for x in elements if x["type"] == "way" and x["id"] == mm["ref"]), None)
                if w_el:
                    keep_ways.append(w_el); kept.add(mm["ref"]); need.update(w_el["nodes"])
    out = [nodes[i] for i in need | inside if i in nodes] + keep_ways + rels
    return out


def stage_osm(m, only, block):
    todo = [p for p in m["parts"] if (not only or p["id"] in only) and not os.path.exists(os.path.join(RAW, p["id"] + ".osm.json"))]
    groups = {}
    for p in todo:
        groups.setdefault((p["row"] // block, p["col"] // block), []).append(p)
    print("osm: %d parts in %d blocks" % (len(todo), len(groups)))
    for gi, (key, ps) in enumerate(sorted(groups.items())):
        bbox = [min(p["bbox"][0] for p in ps), min(p["bbox"][1] for p in ps), max(p["bbox"][2] for p in ps), max(p["bbox"][3] for p in ps)]
        print("block %s (%d/%d): %d parts" % (key, gi + 1, len(groups), len(ps)), flush=True)
        try:
            data = query_block(bbox)
        except RuntimeError as ex:
            print("  giving up on this block for now:", ex)
            continue
        els = data.get("elements", [])
        for p in ps:
            sub = filter_elements(els, p["bbox"])
            json.dump({**{k: v for k, v in data.items() if k != "elements"}, "elements": sub}, open(os.path.join(RAW, p["id"] + ".osm.json"), "w"))
        print("  %d elements -> %d parts" % (len(els), len(ps)), flush=True)
        time.sleep(15)   # be polite to the public Overpass servers


# ---------------------------------------------------------------- convert
def stage_convert(m, only):
    py = sys.executable
    n = 0
    for p in m["parts"]:
        if only and p["id"] not in only:
            continue
        out = os.path.join(ROOT, "public", "data", p["id"], "map.json")
        have = all(os.path.exists(os.path.join(RAW, p["id"] + ext)) for ext in (".osm.json", ".overture.json"))
        if os.path.exists(out) or not have:
            continue
        r = subprocess.run([py, os.path.join(HERE, "convert.py"), "--area", p["id"]], cwd=ROOT, capture_output=True, text=True)
        ok = os.path.exists(out)
        print("convert %-40s %s" % (p["id"], "ok" if ok else "FAILED: " + (r.stderr or r.stdout)[-200:]), flush=True)
        if ok:
            p["built"] = True
            n += 1
            save_manifest(m)
    print("convert: built %d parts" % n)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", default="all", choices=["overture", "osm", "convert", "all"])
    ap.add_argument("--only", default="")
    ap.add_argument("--block", type=int, default=4)
    args = ap.parse_args()
    only = set(x for x in args.only.split(",") if x)
    os.makedirs(RAW, exist_ok=True)
    m = manifest()
    if args.stage in ("overture", "all"):
        stage_overture(m, only)
    if args.stage in ("osm", "all"):
        stage_osm(m, only, args.block)
    if args.stage in ("convert", "all"):
        stage_convert(manifest(), only)


if __name__ == "__main__":
    main()
