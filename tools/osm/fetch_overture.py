#!/usr/bin/env python3
"""Fetch Overture Maps building footprints for an area (bbox filter on the public S3 GeoParquet).

Usage: .venv/bin/python tools/osm/fetch_overture.py --area moti_jheel [--release 2026-10-21.0]
Output: data/raw/<area>.overture.json  (list of {id, source, height, floors, roof, pts:[[lon,lat],...]})
Data: Overture Maps Foundation (ODbL / CC-BY 4.0 depending on source; Google Open Buildings, Microsoft ML footprints, OSM).
Needs: pip install duckdb (in .venv).
"""
import argparse
import json
import os
import sys
import urllib.request

import duckdb

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def latest_release():
    with urllib.request.urlopen("https://stac.overturemaps.org/catalog.json", timeout=30) as r:
        return json.load(r)["latest"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--area", required=True)
    ap.add_argument("--release")
    args = ap.parse_args()
    areas = json.load(open(os.path.join(ROOT, "tools", "osm", "areas.json")))
    if args.area not in areas:
        sys.exit("Unknown area " + args.area)
    s, w, n, e = areas[args.area]["bbox"]
    rel = args.release or latest_release()
    print("Overture release", rel)

    con = duckdb.connect()
    for stmt in ("INSTALL httpfs", "LOAD httpfs", "INSTALL spatial", "LOAD spatial",
                 "SET s3_region='us-west-2'"):
        con.execute(stmt)
    url = "s3://overturemaps-us-west-2/release/%s/theme=buildings/type=building/*" % rel
    q = """
    SELECT id, sources[1].dataset AS source, height, num_floors, roof_shape, class,
           ST_AsGeoJSON(geometry) AS geom
    FROM read_parquet('%s', hive_partitioning=1)
    WHERE bbox.xmin <= %f AND bbox.xmax >= %f AND bbox.ymin <= %f AND bbox.ymax >= %f
    """ % (url, e, w, n, s)
    rows = con.execute(q).fetchall()
    out = []
    for bid, src, h, floors, roof, cls, geom in rows:
        g = json.loads(geom)
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"] if g["type"] == "MultiPolygon" else []
        for poly in polys:
            out.append({"id": bid, "source": src or "", "height": h, "floors": floors, "roof": roof,
                        "cls": cls, "pts": [[round(x, 7), round(y, 7)] for x, y in poly[0]]})
    path = os.path.join(ROOT, "data", "raw", args.area + ".overture.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump({"release": rel, "buildings": out}, open(path, "w"))
    srcs = {}
    for b in out:
        srcs[b["source"]] = srcs.get(b["source"], 0) + 1
    print("Saved %s: %d footprints, sources %s, with height %d, with floors %d" % (
        path, len(out), srcs, sum(1 for b in out if b["height"]), sum(1 for b in out if b["floors"])))


if __name__ == "__main__":
    main()
