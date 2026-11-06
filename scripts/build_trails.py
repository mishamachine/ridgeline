#!/usr/bin/env python3
"""
Build hosted trail data from an OpenStreetMap extract.

Reads an .osm.pbf (e.g. Geofabrik's washington-latest.osm.pbf) and writes:
  <out>/index.json        coverage, cell size, list of cells, build date
  <out>/<x>_<y>.json      trails touching each 0.25° grid cell

Trails are the same two kinds the app searches for:
  - route relations tagged route=hiking|foot (with a name or ref)
  - named paths (highway=path|footway|track|bridleway) not already part of such a route

Every way also carries `z`: the elevation in whole metres at each of its vertices, sampled
from the Copernicus DEM GLO-90 (scripts/elevation.py) and delta-encoded ([z0, z1-z0, ...]).
Optional fields (old apps ignore them; `v` stays 1), see scripts/highlights.py:
  h   highlights of the route / connected path ('view','lake','falls','beach','bikes','horses',
      'dogs','nodogs'; a trailing '?' means partial or mixed evidence). 'climb' and 'long' come
      from the stitched trail in the app.
  th  trailhead [lon, lat, 1|0]: nearest amenity=parking within 300 m of a trail end (1), else a trail end (0)
  j   junctions on a way: [[vertex index, [[lon, lat, name?], ...]], ...], one point ~20 m along each
      other path that meets the trail at that vertex (routes: inside the member as a 4th item)
The app stitches ways into trails at run time and builds each trail's profile from these.
The build fails if a needed DEM tile cannot be fetched. Tiles are cached in $DEM_CACHE_DIR
(default scripts/.dem-cache, git-ignored).

Usage: build_trails.py <input.osm.pbf> <output dir> [source label]
"""
import json
import math
import os
import re
import sys
from datetime import datetime, timezone

import numpy as np
import osmium

import elevation
import highlights as hl

CELL = 0.25  # degrees, ~28 km north-south, ~19 km east-west at 47°N
ROUTE_RE = re.compile(r'^(hiking|foot)$')
PATH_RE = re.compile(r'^(path|footway|track|bridleway)$')
KEEP = ['name', 'ref', 'route', 'sac_scale', 'surface', 'dog', 'operator', 'description', 'trail_visibility', 'website']
MAX_DESC = 300
JUNCTION_RE = re.compile(r'^(path|footway|track|bridleway|steps)$')
MODE_KEYS = ('bicycle', 'horse', 'dog')
WATER_KINDS = {'', 'lake', 'pond', 'reservoir'}
ROAD_NUMBER_RE = re.compile(r'^[\d\s./-]+[A-Z]?$')            # "5030-612", "9030"
ROAD_WORD_RE = re.compile(r'\b(road|rd|forest service|fs)\b', re.I)


def is_trail_name(highway, name):
    """Skip forest/logging roads that are mapped as tracks or paths with road names."""
    if ROAD_NUMBER_RE.match(name) or ROAD_WORD_RE.search(name):
        return False
    if highway == 'track':  # dirt roads: only keep ones actually named as trails
        return bool(re.search(r'\btrail\b', name, re.I))
    return True


def keep_tags(tags):
    out = {}
    for k in KEEP:
        v = tags.get(k)
        if v:
            out[k] = v[:MAX_DESC] if k == 'description' else v
    return out


def mode_tags(tags):
    return {k: tags[k] for k in MODE_KEYS if tags.get(k)}


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
        self.water_outer = set()   # outer ways of natural=water multipolygons

    def relation(self, r):
        if r.tags.get('type') == 'multipolygon' and r.tags.get('natural') == 'water' \
                and r.tags.get('water', '') in WATER_KINDS:
            self.water_outer.update(m.ref for m in r.members if m.type == 'w' and m.role == 'outer')
            return
        if not ROUTE_RE.match(r.tags.get('route', '')):
            return
        if not (r.tags.get('name') or r.tags.get('ref')):
            return
        ways = [m.ref for m in r.members if m.type == 'w']
        if not ways:
            return
        self.routes[r.id] = {'tags': keep_tags(r.tags), 'ways': ways, 'modes': mode_tags(r.tags)}
        self.member_ways.update(ways)


class WayHandler(osmium.SimpleHandler):
    """Pass 2: geometry for route members and named paths, plus the places highlights are drawn from."""

    def __init__(self, member_ways, water_outer=()):
        super().__init__()
        self.member_ways = member_ways
        self.water_outer = water_outer
        self.geoms = {}        # way id -> [(lon, lat)]
        self.nodes = {}        # way id -> node ids, one per vertex in geoms
        self.names = {}        # way id -> name
        self.modes = {}        # way id -> bicycle/horse/dog tags
        self.paths = {}        # way id -> tags, for named paths not in a route
        self.features = {k: hl.PointIndex() for k in hl.FEATURES}
        self.parking = []      # (lon, lat)

    def _feature(self, tags, is_water_outer=False):
        if tags.get('tourism') == 'viewpoint' or tags.get('natural') == 'peak':
            return 'view'
        if tags.get('waterway') == 'waterfall' or tags.get('natural') == 'waterfall':
            return 'falls'
        if tags.get('natural') == 'beach':
            return 'beach'
        if (tags.get('natural') == 'water' and tags.get('water', '') in WATER_KINDS) or is_water_outer:
            return 'lake'
        return None

    def node(self, n):
        if not n.tags or not n.location.valid():
            return
        kind = self._feature(n.tags)
        if kind in ('view', 'falls', 'beach'):
            self.features[kind].add(hl.xy([(n.location.lon, n.location.lat)]))
        if n.tags.get('amenity') == 'parking':
            self.parking.append((round(n.location.lon, 5), round(n.location.lat, 5)))

    def way(self, w):
        is_member = w.id in self.member_ways
        hw = w.tags.get('highway', '')
        name = w.tags.get('name', '')
        is_path = bool(PATH_RE.match(hw)) and bool(name) and is_trail_name(hw, name)
        kind = self._feature(w.tags, w.id in self.water_outer)
        is_parking = w.tags.get('amenity') == 'parking'
        if not (is_member or is_path or kind or is_parking):
            return
        coords, refs = [], []
        for n in w.nodes:
            if n.location.valid():
                coords.append((round(n.location.lon, 5), round(n.location.lat, 5)))
                refs.append(n.ref)
        if len(coords) < 2:
            return
        if kind:
            self.features[kind].add(hl.densify(coords))
        if is_parking:
            self.parking.append((round(sum(c[0] for c in coords) / len(coords), 5), round(sum(c[1] for c in coords) / len(coords), 5)))
        if not (is_member or is_path):
            return
        self.geoms[w.id] = coords
        self.nodes[w.id] = refs
        self.names[w.id] = name
        self.modes[w.id] = mode_tags(w.tags)
        if is_path and not is_member:
            self.paths[w.id] = keep_tags(w.tags)


class JunctionHandler(osmium.SimpleHandler):
    """
    Pass 3: where another path, footway, track, bridleway or steps way meets a trail at a shared node.
    result: trail way id -> {vertex index: [[lon, lat, name?], ...]}, one point ~20 m along each branch.
    Ways of the same trail (same route or same name) are not branches.
    """

    def __init__(self, nodes, keys):
        super().__init__()
        self.at = {}           # node id -> [(trail way id, vertex index)]
        for wid, refs in nodes.items():
            for i, ref in enumerate(refs):
                self.at.setdefault(ref, []).append((wid, i))
        self.nodeset = {wid: set(refs) for wid, refs in nodes.items()}
        self.keys = keys
        self.result = {}

    def way(self, w):
        if not JUNCTION_RE.match(w.tags.get('highway', '')):
            return
        refs = [n.ref for n in w.nodes if n.location.valid()]
        if not any(r in self.at for r in refs):
            return
        pts = [(round(n.location.lon, 5), round(n.location.lat, 5)) for n in w.nodes if n.location.valid()]
        name = w.tags.get('name', '')
        mine = self.keys.get(w.id) or ({('n', name)} if name else set())
        for i, ref in enumerate(refs):
            for wid, vi in self.at.get(ref, ()):
                if wid == w.id or (self.keys[wid] & mine):
                    continue
                for step, rng in ((-1, range(i - 1, -1, -1)), (1, range(i + 1, len(refs)))):
                    nxt = i + step
                    if not 0 <= nxt < len(refs) or refs[nxt] in self.nodeset[wid]:
                        continue  # no branch this way, or it runs along the trail
                    p = hl.branch_point(pts[i], [pts[k] for k in rng])
                    if not p:
                        continue
                    branch = p + [name] if name else p
                    lst = self.result.setdefault(wid, {}).setdefault(vi, [])
                    if branch not in lst:
                        lst.append(branch)


def flat(coords):
    return [v for c in coords for v in c]


def sample_elevations(geoms, tiles):
    """way id -> delta-encoded integer elevations, one per vertex."""
    ids = list(geoms)
    lons = np.array([c[0] for i in ids for c in geoms[i]])
    lats = np.array([c[1] for i in ids for c in geoms[i]])
    z = elevation.sample(lons, lats, tiles)
    elevation.check_sea_fraction(tiles)
    out, pos = {}, 0
    for i in ids:
        n = len(geoms[i])
        out[i] = elevation.encode_deltas(z[pos:pos + n].tolist())
        pos += n
    return out


def junction_list(by_vertex):
    """{vertex index: branches} -> [[index, [[lon, lat, name?], ...]], ...] in vertex order."""
    return [[i, by_vertex[i]] for i in sorted(by_vertex)]


def path_groups(ways):
    """Named paths outside routes -> lists of way ids: same name and connected by a shared node."""
    parent = {w: w for w in ways.paths}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    owner = {}
    for wid in ways.paths:
        for key in {(ways.names[wid], n) for n in ways.nodes[wid]}:
            if key in owner:
                parent[find(wid)] = find(owner[key])
            else:
                owner[key] = wid
    groups = {}
    for wid in ways.paths:
        groups.setdefault(find(wid), []).append(wid)
    return list(groups.values())


def way_length(coords):
    p = hl.xy(coords)
    return float(np.hypot(*(p[1:] - p[:-1]).T).sum()) if len(p) > 1 else 0.0


def describe(way_ids, ways, rel_modes, parking_xy):
    """(highlights, trailhead, owner way id) for one trail: a route's ways or a connected set of named-path ways."""
    dense = np.vstack([hl.densify(ways.geoms[w]) for w in way_ids])
    feats = {k for k in hl.FEATURES if ways.features[k].near(dense)}
    lengths = [way_length(ways.geoms[w]) for w in way_ids]
    shares = hl.mode_share([ways.modes[w] for w in way_ids], lengths)
    for fam, v in (rel_modes or {}).items():
        if v in hl.MODE_YES[fam]:
            shares[fam] = (1.0, 0.0)
        elif v == 'no':
            shares[fam] = (0.0, 1.0)
    h = hl.combine_highlights(feats, hl.mode_highlights(shares))
    node_lists = [ways.nodes[w] for w in way_ids]
    ends = hl.chain_ends(node_lists)
    end_pts = [ways.geoms[way_ids[wi]][pos] for wi, pos in ends]
    th, ei = hl.pick_trailhead(end_pts, ways.parking, parking_xy)
    return h, th, way_ids[ends[ei][0]]


def build(pbf, out_dir, source, dem_dir=None):
    routes = RouteHandler()
    routes.apply_file(pbf)
    ways = WayHandler(routes.member_ways, routes.water_outer)
    ways.apply_file(pbf, locations=True, idx='flex_mem')

    lats = [c[1] for g in ways.geoms.values() for c in g]
    if lats:
        hl.set_ref_lat(float(np.median(lats)))
    parking_xy = hl.xy(ways.parking) if ways.parking else np.zeros((0, 2))
    route_ways = {rid: [w for w in dict.fromkeys(r['ways']) if w in ways.geoms] for rid, r in routes.routes.items()}
    keys = {}
    for rid, wids in route_ways.items():
        for w in wids:
            keys.setdefault(w, set()).add(('r', rid))
    for w in ways.geoms:
        keys.setdefault(w, set())
        if ways.names[w]:
            keys[w].add(('n', ways.names[w]))
    jh = JunctionHandler(ways.nodes, keys)
    jh.apply_file(pbf, locations=True, idx='flex_mem')

    route_info, path_info = {}, {}
    for rid, wids in route_ways.items():
        if wids:
            h, th, _ = describe(wids, ways, routes.routes[rid]['modes'], parking_xy)
            route_info[rid] = {'h': h, 'th': th}
    for wids in path_groups(ways):
        h, th, owner = describe(wids, ways, None, parking_xy)
        for w in wids:
            path_info[w] = {'h': h, 'th': th if w == owner else None}

    tiles = elevation.DemTiles(dem_dir or os.environ.get('DEM_CACHE_DIR') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '.dem-cache'))
    zs = sample_elevations(ways.geoms, tiles)

    cells = {}  # (x, y) -> {'r': {rel id: entry}, 'w': [entries]}

    def cell(key):
        return cells.setdefault(key, {'r': {}, 'w': []})

    for rid, route in routes.routes.items():
        total = len(route['ways'])
        for wid in route['ways']:
            g = ways.geoms.get(wid)
            if not g:
                continue
            member = [wid, flat(g), zs[wid]]
            if wid in jh.result:
                member.append(junction_list(jh.result[wid]))
            for key in cells_for(g):
                entry = cell(key)['r'].setdefault(rid, {'id': rid, 't': route['tags'], 'n': total, 'm': []})
                if rid in route_info:
                    entry['h'] = route_info[rid]['h']
                    entry['th'] = route_info[rid]['th']
                entry['m'].append(member)

    for wid, tags in ways.paths.items():
        g = ways.geoms[wid]
        entry = {'id': wid, 't': tags, 'g': flat(g), 'z': zs[wid]}
        if path_info[wid]['h']:
            entry['h'] = path_info[wid]['h']
        if path_info[wid]['th']:
            entry['th'] = path_info[wid]['th']
        if wid in jh.result:
            entry['j'] = junction_list(jh.result[wid])
        for key in cells_for(g):
            cell(key)['w'].append(entry)

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
        'elevation': 'Copernicus DEM GLO-90',
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
