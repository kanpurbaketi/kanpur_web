#!/usr/bin/env python3
"""Divide Kanpur into parts (map tiles of the same size as the Moti Jheel part) and write the manifest.

Usage: .venv/bin/python tools/osm/make_parts.py [--min-buildings 150] [--no-names]
Needs: duckdb (in .venv). Network: Overture (S3) for building counts, Nominatim for names (1 request / second, cached).

Output:
  tools/osm/areas.json     one entry per part (what fetch_osm / fetch_overture / convert read); Moti Jheel's hand-made
                           entry (landmarks, lake name) is kept as it is
  public/data/parts.json   the manifest the game and the admin page read: id, title, bbox, centre, buildings, built
The grid is anchored on the Moti Jheel bbox, so that part is exactly one cell and the others tile around it.
Build the data of a part with:  python3 tools/osm/build_part.py <id>   (or  --all)
"""
import argparse
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AREAS = os.path.join(ROOT, "tools", "osm", "areas.json")
MANIFEST = os.path.join(ROOT, "public", "data", "parts.json")
CACHE = os.path.join(ROOT, "tools", "osm", "names.cache.json")

# Moti Jheel's bbox: the grid cell every other part is aligned to.
S0, W0, N0, E0 = 26.4736, 80.3119, 26.4846, 80.3239
DLAT, DLON = N0 - S0, E0 - W0
# Kanpur and its surroundings (the built-up area is well inside this)
CITY = (26.36, 80.20, 26.58, 80.50)   # south, west, north, east


def cell_bbox(i, j):
    s = S0 + i * DLAT
    w = W0 + j * DLON
    return [round(s, 5), round(w, 5), round(s + DLAT, 5), round(w + DLON, 5)]


def building_counts():
    import duckdb
    rel = json.load(urllib.request.urlopen("https://stac.overturemaps.org/catalog.json", timeout=30))["latest"]
    print("Overture release", rel)
    con = duckdb.connect()
    for stmt in ("INSTALL httpfs", "LOAD httpfs", "SET s3_region='us-west-2'"):
        con.execute(stmt)
    url = "s3://overturemaps-us-west-2/release/%s/theme=buildings/type=building/*" % rel
    s, w, n, e = CITY
    q = """
    SELECT CAST(floor((bbox.ymin - %f) / %f) AS INTEGER) AS i, CAST(floor((bbox.xmin - %f) / %f) AS INTEGER) AS j, count(*) AS c
    FROM read_parquet('%s', hive_partitioning=1)
    WHERE bbox.xmin BETWEEN %f AND %f AND bbox.ymin BETWEEN %f AND %f
    GROUP BY 1, 2
    """ % (S0, DLAT, W0, DLON, url, w, e, s, n)
    t = time.time()
    rows = con.execute(q).fetchall()
    print("counted buildings in %d cells (%.0f s)" % (len(rows), time.time() - t))
    return {(i, j): c for i, j, c in rows}


def load_cache():
    try:
        return json.load(open(CACHE))
    except (OSError, ValueError):
        return {}


def reverse_name(lat, lon, cache, allow_net=True):
    key = "%.4f,%.4f" % (lat, lon)
    if key in cache:
        return cache[key]
    if not allow_net:
        return ""
    url = "https://nominatim.openstreetmap.org/reverse?" + urllib.parse.urlencode(
        {"lat": lat, "lon": lon, "zoom": 15, "format": "jsonv2", "accept-language": "en"})
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "kanpur-web-game/0.1 (personal project)"})
        a = json.load(urllib.request.urlopen(req, timeout=30)).get("address", {})
    except Exception as ex:  # noqa: BLE001
        print("  name lookup failed:", ex)
        return ""
    time.sleep(1.1)  # Nominatim usage policy: at most one request per second
    name = ""
    for k in ("suburb", "neighbourhood", "quarter", "city_district", "residential", "village", "town", "hamlet", "road"):
        if a.get(k):
            name = a[k]
            break
    cache[key] = name
    json.dump(cache, open(CACHE, "w"), indent=0)
    return name


def slug(s):
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_") or "part"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-buildings", type=int, default=150, help="keep cells with at least this many buildings")
    ap.add_argument("--reuse-counts", action="store_true", help="reuse the building counts of the last run (tools/osm/building_counts.json) instead of querying Overture again (~12 min)")
    ap.add_argument("--no-names", action="store_true", help="do not call Nominatim (uses cached names or 'Kanpur r,c')")
    args = ap.parse_args()

    cc = os.path.join(ROOT, "tools", "osm", "building_counts.json")
    if args.reuse_counts and os.path.exists(cc):
        counts = {tuple(int(x) for x in k.split(",")): v for k, v in json.load(open(cc)).items()}
    else:
        counts = building_counts()
        json.dump({"%d,%d" % k: v for k, v in counts.items()}, open(cc, "w"))
    keep = sorted(((k, c) for k, c in counts.items() if c >= args.min_buildings), key=lambda kc: (-kc[0][0], kc[0][1]))
    print("%d cells with >= %d buildings" % (len(keep), args.min_buildings))

    areas = json.load(open(AREAS))
    moti = areas.get("moti_jheel")
    cache = load_cache()
    parts, used = [], {"moti_jheel"}
    for (i, j), c in keep:
        bbox = cell_bbox(i, j)
        lat, lon = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
        if (i, j) == (0, 0):
            pid, title = "moti_jheel", "Moti Jheel"
        else:
            name = reverse_name(lat, lon, cache, not args.no_names)
            if len(name) > 36:
                name = name[:36].rsplit(" ", 1)[0]
            # unnamed cells: a grid label, e.g. "Kanpur grid N3 E5" (N/S = rows north / south of Moti Jheel, E/W = columns east / west)
            title = name or "Kanpur grid %s%d %s%d" % ("N" if i >= 0 else "S", abs(i), "E" if j >= 0 else "W", abs(j))
            pid = slug(title)
            n = 2
            base = pid
            while pid in used:
                pid = "%s_%d" % (base, n)
                n += 1
            if pid != base:
                title = "%s %d" % (title, n - 1)
            used.add(pid)
        parts.append({"id": pid, "title": title, "row": i, "col": j, "bbox": bbox, "center": [round(lat, 5), round(lon, 5)], "buildings": c})
        if pid != "moti_jheel":
            areas[pid] = {"title": title + ", Kanpur", "bbox": bbox, "note": "generated by make_parts.py"}
    if moti is None or (0, 0) not in [(p["row"], p["col"]) for p in parts]:
        print("warning: the Moti Jheel cell is not in the list")
    json.dump(areas, open(AREAS, "w"), indent=1, ensure_ascii=False)
    # which parts already have data
    for p in parts:
        p["built"] = os.path.exists(os.path.join(ROOT, "public", "data", p["id"], "map.json"))
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    json.dump({"grid": {"south": S0, "west": W0, "dlat": DLAT, "dlon": DLON}, "parts": parts}, open(MANIFEST, "w"), indent=0, ensure_ascii=False)
    print("wrote %d parts -> %s" % (len(parts), MANIFEST))


if __name__ == "__main__":
    main()
