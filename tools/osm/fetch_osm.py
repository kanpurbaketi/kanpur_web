#!/usr/bin/env python3
"""Fetch OpenStreetMap data for a named area via the Overpass API.

Usage: python3 tools/osm/fetch_osm.py --area swaroop_nagar
Output: data/osm/raw/<area>.json   (OSM data © OpenStreetMap contributors, ODbL)
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
AREAS = os.path.join(ROOT, "tools", "osm", "areas.json")
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

QUERY = """
[out:json][timeout:180];
(
  way["highway"]({b});
  way["building"]({b});
  relation["building"]({b});
  way["natural"="water"]({b});
  relation["natural"="water"]({b});
  way["water"]({b});
  way["leisure"~"park|garden|playground|pitch|stadium"]({b});
  relation["leisure"~"park|garden"]({b});
  way["landuse"~"grass|recreation_ground|forest|meadow"]({b});
  way["railway"="rail"]({b});
  node["amenity"]["name"]({b});
  node["shop"]["name"]({b});
  node["tourism"]["name"]({b});
);
(._;>;);
out body;
"""


def _post(url, data):
    """POST via urllib; fall back to curl (macOS system Python's LibreSSL fails some TLS handshakes)."""
    try:
        req = urllib.request.Request(url, data=data, headers={"User-Agent": "ramu-kanpur-game/0.1"})
        with urllib.request.urlopen(req, timeout=240) as r:
            return r.read()
    except Exception as ex:
        if not shutil.which("curl"):
            raise
        print("  urllib failed (%s), retrying with curl" % ex)
        return subprocess.run(
            ["curl", "-sS", "--fail", "--compressed", "--max-time", "400", "-A", "ramu-kanpur-game/0.1",
             "--data-binary", "@-", url],
            input=data, capture_output=True, check=True).stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--area", required=True)
    args = ap.parse_args()
    with open(AREAS) as f:
        areas = json.load(f)
    if args.area not in areas:
        sys.exit("Unknown area '%s'. Known: %s" % (args.area, ", ".join(areas)))
    s, w, n, e = areas[args.area]["bbox"]
    query = QUERY.replace("{b}", "%f,%f,%f,%f" % (s, w, n, e))
    data = urllib.parse.urlencode({"data": query}).encode()
    last_err = None
    for url in ENDPOINTS:
        try:
            print("Querying", url)
            body = _post(url, data)
            parsed = json.loads(body)
            break
        except Exception as ex:  # try next mirror
            last_err = ex
            print("  failed:", ex)
    else:
        sys.exit("All Overpass endpoints failed: %s" % last_err)
    out_dir = os.path.join(ROOT, "data", "osm", "raw")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, args.area + ".json")
    with open(out, "w") as f:
        json.dump(parsed, f)
    kinds = {}
    for el in parsed.get("elements", []):
        kinds[el["type"]] = kinds.get(el["type"], 0) + 1
    print("Saved %s (%s)" % (out, kinds))


if __name__ == "__main__":
    main()
