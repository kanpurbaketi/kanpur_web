#!/usr/bin/env python3
"""Extract Microsoft Global ML Building Footprints for an area (fallback / complement to Overture).

Download the quadkey tile first (see dataset-links.csv at
https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv), e.g. for Moti Jheel:
  quadkey 123132010 -> data/raw/ms_123132010.csv.gz
Usage: python3 tools/osm/fetch_msbuildings.py --area moti_jheel --tile data/raw/ms_123132010.csv.gz
Output: data/raw/<area>.ms.json  (same shape as <area>.overture.json)
Data: Microsoft, ODbL.
"""
import argparse
import gzip
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--area", required=True)
    ap.add_argument("--tile", required=True)
    args = ap.parse_args()
    s, w, n, e = json.load(open(os.path.join(ROOT, "tools", "osm", "areas.json")))[args.area]["bbox"]
    pad = 0.001
    out = []
    with gzip.open(args.tile, "rt") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            feat = json.loads(line)
            g = feat["geometry"]
            if g["type"] != "Polygon":
                continue
            ring = g["coordinates"][0]
            lon, lat = ring[0]
            if not (s - pad <= lat <= n + pad and w - pad <= lon <= e + pad):
                continue
            h = feat.get("properties", {}).get("height")
            out.append({"id": "", "source": "Microsoft ML Buildings", "height": h if h and h > 0 else None,
                        "floors": None, "roof": None, "cls": None,
                        "pts": [[round(x, 7), round(y, 7)] for x, y in ring]})
    path = os.path.join(ROOT, "data", "raw", args.area + ".ms.json")
    json.dump({"release": os.path.basename(args.tile), "buildings": out}, open(path, "w"))
    print("Saved %s: %d footprints, %d with height" % (path, len(out), sum(1 for b in out if b["height"])))


if __name__ == "__main__":
    main()
