#!/usr/bin/env python3
"""Fetch Mapillary street-photo metadata, thumbnails and detected map features for an area.

Usage: MAPILLARY_TOKEN=MLY|... python3 tools/osm/fetch_mapillary.py --area moti_jheel [--max-thumbs 400]
       (token: free client token from https://www.mapillary.com/dashboard/developers; can also go in .env)
Output: data/raw/<area>.mapillary.json   {images:[{id,lat,lon,heading,captured_at,seq}], features:[{value,lat,lon}]}
        reference/mapillary/<id>.jpg      1024px thumbnails (reference only, git-ignored)
Imagery © Mapillary contributors, CC-BY-SA 4.0.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
API = "https://graph.mapillary.com"
# object-detection classes worth placing in the world
FEATURE_PREFIXES = ("object--support--utility-pole", "object--street-light", "object--traffic-light",
                    "object--support--pole", "object--sign", "object--banner", "object--bench",
                    "object--fire-hydrant", "object--trash-can", "object--water-valve",
                    "marking--", "construction--barrier", "nature--tree")


def token():
    t = os.environ.get("MAPILLARY_TOKEN")
    env = os.path.join(ROOT, ".env")
    if not t and os.path.exists(env):
        for line in open(env):
            if line.startswith("MAPILLARY_TOKEN="):
                t = line.split("=", 1)[1].strip()
    if not t:
        sys.exit("Set MAPILLARY_TOKEN (free token: https://www.mapillary.com/dashboard/developers)")
    return t


def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "kanpur-web-game/0.1"}),
                                    timeout=60) as r:
            return r.read()
    except Exception:
        if not shutil.which("curl"):
            raise
        return subprocess.run(["curl", "-sS", "--fail", "--max-time", "120", url],
                              capture_output=True, check=True).stdout


def get_json(path, params, tok):
    params = dict(params, access_token=tok)
    return json.loads(get(API + path + "?" + urllib.parse.urlencode(params)))


def tiles(s, w, n, e, step=0.0025):
    """Mapillary limits bbox queries to small areas: split into ~250 m tiles."""
    lat = s
    while lat < n:
        lon = w
        while lon < e:
            yield lat, lon, min(lat + step, n), min(lon + step, e)
            lon += step
        lat += step


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--area", required=True)
    ap.add_argument("--max-thumbs", type=int, default=400)
    args = ap.parse_args()
    tok = token()
    area = json.load(open(os.path.join(ROOT, "tools", "osm", "areas.json")))[args.area]
    s, w, n, e = area["bbox"]

    images, features = {}, {}
    for ts, tw, tn, te in tiles(s, w, n, e):
        bb = "%f,%f,%f,%f" % (tw, ts, te, tn)
        res = get_json("/images", {"bbox": bb, "limit": 2000,
                                   "fields": "id,computed_geometry,geometry,compass_angle,computed_compass_angle,"
                                             "captured_at,sequence,is_pano"}, tok)
        for im in res.get("data", []):
            g = (im.get("computed_geometry") or im.get("geometry"))["coordinates"]
            images[im["id"]] = {"id": im["id"], "lon": g[0], "lat": g[1],
                                "heading": im.get("computed_compass_angle", im.get("compass_angle")),
                                "captured_at": im.get("captured_at"), "seq": im.get("sequence"),
                                "pano": im.get("is_pano", False)}
        res = get_json("/map_features", {"bbox": bb, "limit": 2000, "fields": "id,object_value,geometry"}, tok)
        for f in res.get("data", []):
            v = f.get("object_value", "")
            if v.startswith(FEATURE_PREFIXES):
                g = f["geometry"]["coordinates"]
                features[f["id"]] = {"value": v, "lon": g[0], "lat": g[1]}
        print("tile %.4f,%.4f: images %d, features %d" % (ts, tw, len(images), len(features)))

    # Thumbnails: spread over the area (newest first per ~25 m cell).
    cells = {}
    for im in sorted(images.values(), key=lambda i: -(i["captured_at"] or 0)):
        key = (round(im["lat"] / 0.00022), round(im["lon"] / 0.00025))
        cells.setdefault(key, im)
    picks = list(cells.values())[:args.max_thumbs]
    out_dir = os.path.join(ROOT, "reference", "mapillary")
    os.makedirs(out_dir, exist_ok=True)
    for i, im in enumerate(picks):
        path = os.path.join(out_dir, "%s.jpg" % im["id"])
        if os.path.exists(path):
            continue
        meta = get_json("/" + im["id"], {"fields": "thumb_1024_url,creator"}, tok)
        im["creator"] = (meta.get("creator") or {}).get("username", "")
        if meta.get("thumb_1024_url"):
            open(path, "wb").write(get(meta["thumb_1024_url"]))
        im["thumb"] = True
        if i % 25 == 0:
            print("thumbs %d/%d" % (i, len(picks)))

    path = os.path.join(ROOT, "data", "raw", args.area + ".mapillary.json")
    json.dump({"images": list(images.values()), "features": list(features.values())}, open(path, "w"))
    counts = {}
    for f in features.values():
        counts[f["value"]] = counts.get(f["value"], 0) + 1
    print("Saved %s: %d images (%d thumbs), %d features" % (path, len(images), len(picks), len(features)))
    for k, v in sorted(counts.items(), key=lambda kv: -kv[1])[:20]:
        print("  %4d %s" % (v, k))


if __name__ == "__main__":
    main()
