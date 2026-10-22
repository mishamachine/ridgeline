#!/usr/bin/env python3
"""
Build hosted trail data from an OpenStreetMap extract.

Reads an .osm.pbf (e.g. Geofabrik's washington-latest.osm.pbf) and writes:
  <out>/index.json        coverage, cell size, list of cells, build date
  <out>/<x>_<y>.json      trails touching each 0.25° grid cell

Trails are the same two kinds the app searches for:
  - route relations tagged route=hiking|foot (with a name or ref)
  - named paths (highway=path|footway|track|bridleway) not already part of such a route

Usage: build_trails.py <input.osm.pbf> <output dir> [source label]
"""
import json
import math
import os
import re
import sys
from datetime import datetime, timezone

import osmium

CELL = 0.25  # degrees, ~28 km north-south, ~19 km east-west at 47°N
ROUTE_RE = re.compile(r'^(hiking|foot)$')
PATH_RE = re.compile(r'^(path|footway|track|bridleway)$')
KEEP = ['name', 'ref', 'route', 'sac_scale', 'surface', 'dog', 'operator', 'description', 'trail_visibility', 'website']
MAX_DESC = 300


def keep_tags(tags):
    out = {}
    for k in KEEP:
        v = tags.get(k)
        if v:
            out[k] = v[:MAX_DESC] if k == 'description' else v
    return out


def cell_of(lon, lat):
    return math.floor((lon + 180) / CELL), math.floor((lat + 90) / CELL)


def cells_for(coords):
    """All cells touched by a line's bounding box. coords: [(lon, lat), ...]"""
    xs = [c[0] for c in coords]
    ys = [c[1] for c in coords]
    x0, y0 = cell_of(min(xs), min(ys))
    x1, y1 = cell_of(max(xs), max(ys))
    return [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]


class RouteHandler(osmium.SimpleHandler):
    """Pass 1: hiking/foot route relations and the ways they use."""

    def __init__(self):
        super().__init__()
        self.routes = {}       # relation id -> {tags, ways: [way ids]}
        self.member_ways = set()

    def relation(self, r):
        if not ROUTE_RE.match(r.tags.get('route', '')):
            return
        if not (r.tags.get('name') or r.tags.get('ref')):
            return
        ways = [m.ref for m in r.members if m.type == 'w']
        if not ways:
            return
        self.routes[r.id] = {'tags': keep_tags(r.tags), 'ways': ways}
        self.member_ways.update(ways)


class WayHandler(osmium.SimpleHandler):
    """Pass 2: geometry for route members and named paths."""

    def __init__(self, member_ways):
        super().__init__()
        self.member_ways = member_ways
        self.geoms = {}        # way id -> [(lon, lat)]
        self.paths = {}        # way id -> tags, for named paths not in a route

    def way(self, w):
        is_member = w.id in self.member_ways
        is_path = bool(PATH_RE.match(w.tags.get('highway', ''))) and bool(w.tags.get('name'))
        if not (is_member or is_path):
            return
        coords = []
        for n in w.nodes:
            if n.location.valid():
                coords.append((round(n.location.lon, 5), round(n.location.lat, 5)))
        if len(coords) < 2:
            return
        self.geoms[w.id] = coords
        if is_path and not is_member:
            self.paths[w.id] = keep_tags(w.tags)


def flat(coords):
    return [v for c in coords for v in c]


def build(pbf, out_dir, source):
    routes = RouteHandler()
    routes.apply_file(pbf)
    ways = WayHandler(routes.member_ways)
    ways.apply_file(pbf, locations=True, idx='flex_mem')

    cells = {}  # (x, y) -> {'r': {rel id: entry}, 'w': [entries]}

    def cell(key):
        return cells.setdefault(key, {'r': {}, 'w': []})

    for rid, route in routes.routes.items():
        total = len(route['ways'])
        for wid in route['ways']:
            g = ways.geoms.get(wid)
            if not g:
                continue
            for key in cells_for(g):
                entry = cell(key)['r'].setdefault(rid, {'id': rid, 't': route['tags'], 'n': total, 'm': []})
                entry['m'].append([wid, flat(g)])

    for wid, tags in ways.paths.items():
        g = ways.geoms[wid]
        for key in cells_for(g):
            cell(key)['w'].append({'id': wid, 't': tags, 'g': flat(g)})

    os.makedirs(out_dir, exist_ok=True)
    total_bytes = 0
    for (x, y), c in cells.items():
        body = json.dumps({'v': 1, 'r': list(c['r'].values()), 'w': c['w']}, separators=(',', ':'))
        with open(os.path.join(out_dir, f'{x}_{y}.json'), 'w') as f:
            f.write(body)
        total_bytes += len(body)

    keys = sorted(cells)
    bbox = None
    if keys:
        xs = [k[0] for k in keys]
        ys = [k[1] for k in keys]
        bbox = [min(xs) * CELL - 180, min(ys) * CELL - 90, (max(xs) + 1) * CELL - 180, (max(ys) + 1) * CELL - 90]
    index = {
        'v': 1,
        'built': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'source': source,
        'cell': CELL,
        'bbox': bbox,
        'cells': [f'{x}_{y}' for x, y in keys],
    }
    with open(os.path.join(out_dir, 'index.json'), 'w') as f:
        json.dump(index, f, separators=(',', ':'))

    print(f'routes: {len(routes.routes)}, named paths: {len(ways.paths)}, cells: {len(cells)}, '
          f'size: {total_bytes / 1e6:.1f} MB (before gzip), largest cell: '
          f'{max((os.path.getsize(os.path.join(out_dir, k + ".json")) for k in index["cells"]), default=0) / 1e3:.0f} KB')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    build(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else 'OpenStreetMap')
