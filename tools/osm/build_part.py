#!/usr/bin/env python3
"""Build the map data of one or more parts of Kanpur (OSM + Overture + Microsoft footprints -> public/data/<id>/map.json).

Usage:
  .venv/bin/python tools/osm/build_part.py civil_lines           one part
  .venv/bin/python tools/osm/build_part.py --all [--limit 10]    every part that is not built yet (largest first)
  .venv/bin/python tools/osm/build_part.py --list                what is built and what is not
Run tools/osm/make_parts.py first (it writes areas.json and public/data/parts.json).
Each part takes a minute or two (Overpass + an Overture query); Overpass is used politely (one request at a time, a pause between parts).
Then public/data/parts.json is updated ("built": true).
"""
import argparse
import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "public", "data", "parts.json")
HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable


def load():
    return json.load(open(MANIFEST))


def save(m):
    json.dump(m, open(MANIFEST, "w"), indent=0, ensure_ascii=False)


def built(pid):
    return os.path.exists(os.path.join(ROOT, "public", "data", pid, "map.json"))


def run(script, pid):
    r = subprocess.run([PY, os.path.join(HERE, script), "--area", pid], cwd=ROOT)
    return r.returncode == 0


def build(pid):
    print("== %s" % pid)
    t = time.time()
    # fetch_overture needs duckdb; fetch_osm / convert need only the standard library
    ok = run("fetch_osm.py", pid) and run("fetch_overture.py", pid) and run("convert.py", pid)
    print("== %s: %s (%.0f s)" % (pid, "built" if ok else "FAILED", time.time() - t))
    return ok and built(pid)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("part", nargs="?")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()
    m = load()
    parts = m["parts"]
    for p in parts:
        p["built"] = built(p["id"])
    if args.list:
        for p in sorted(parts, key=lambda p: -p["buildings"]):
            print("%-34s %6d buildings  %s" % (p["id"], p["buildings"], "built" if p["built"] else "-"))
        save(m)
        return
    todo = [p for p in parts if p["id"] == args.part] if args.part else \
        sorted([p for p in parts if not p["built"]], key=lambda p: -p["buildings"]) if args.all else []
    if not todo:
        sys.exit("Nothing to do (give a part id, or --all, or --list)")
    if args.limit:
        todo = todo[: args.limit]
    for i, p in enumerate(todo):
        if build(p["id"]):
            p["built"] = True
            save(m)
        if i + 1 < len(todo):
            time.sleep(20)   # be polite to the public Overpass server


if __name__ == "__main__":
    main()
