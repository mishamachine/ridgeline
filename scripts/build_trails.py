#!/usr/bin/env python3
"""
Build hosted trail data from an OpenStreetMap extract.

Reads an .osm.pbf (e.g. Geofabrik's washington-latest.osm.pbf) and writes:
  <out>/index.json        coverage, cell size, list of cells, build date
  <out>/names.json        compact trail-name index for search (scripts/name_index.py)
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
  th  trailhead [lon, lat, 1|0]: nearest usable amenity=parking (node or area outline, not private) within 300 m of a trail end (1), else a trail end (0)
  j   junctions on a way: [[vertex index, [[lon, lat, name?], ...]], ...], one point ~20 m along each
      other path that meets the trail at that vertex (routes: inside the member as a 4th item)
The app stitches ways into trails at run time and builds each trail's profile from these.
The build fails if a needed DEM tile cannot be fetched. Tiles are cached in $DEM_CACHE_DIR
(default scripts/.dem-cache, git-ignored).

Usage: build_trails.py <input.osm.pbf> <output dir> [source label] [--v1]
  --v1 also writes the old-format cells, index.json and names.json to <output dir>/v1 (Washington only).
"""
import json
import math
import os
import re
import shutil
import sys
import time
from datetime import datetime, timezone

import numpy as np
import osmium

import elevation
import cell_format as cf
import highlights as hl
import name_index
import place_index

CELL = 0.25  # degrees, ~28 km north-south, ~19 km east-west at 47°N
ROUTE_RE = re.compile(r'^(hiking|foot)$')
PATH_RE = re.compile(r'^(path|footway|track|bridleway)$')
KEEP = ['name', 'ref', 'route', 'sac_scale', 'surface', 'dog', 'operator', 'description', 'trail_visibility', 'website']
MAX_DESC = 300
JUNCTION_RE = re.compile(r'^(path|footway|track|bridleway|steps)$')
MODE_KEYS = ('bicycle', 'horse', 'dog')
WATER_KINDS = {'lake', 'pond', 'reservoir'}   # explicit water=*; river, stream, canal etc. are not lakes
COMPACT_MAX = 40   # untagged natural=water counts only if closed and not long and thin (perimeter^2 / area; square 16)
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
        self.water_outer = set()     # outer ways of natural=water multipolygons tagged lake/pond/reservoir
        self.water_untagged = set()  # same, with no water=* tag: only the compact closed ones count
        self.areas = {}              # relation id -> (name, outer way ids): named parks and protected areas, for the place index

    def relation(self, r):
        if r.tags.get('type') == 'multipolygon' and r.tags.get('natural') == 'water':
            kind = r.tags.get('water', '')
            outers = (m.ref for m in r.members if m.type == 'w' and m.role == 'outer')
            if kind in WATER_KINDS:
                self.water_outer.update(outers)
            elif not kind:
                self.water_untagged.update(outers)
            return
        if place_index.is_area(r.tags) and r.tags.get('name') and r.tags.get('type') in ('multipolygon', 'boundary'):
            self.areas[r.id] = (r.tags['name'], [m.ref for m in r.members if m.type == 'w' and m.role in ('outer', '')])
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

    def __init__(self, member_ways, water_outer=(), water_untagged=(), area_ways=()):
        super().__init__()
        self.area_ways = area_ways
        self.area_bbox = {}    # way id -> (min lon, min lat, max lon, max lat) for ways of park relations
        self.places = []       # (name, kind, lat, lon) for the place index
        self.member_ways = member_ways
        self.water_outer = water_outer
        self.water_untagged = water_untagged
        self.geoms = {}        # way id -> [(lon, lat)]
        self.nodes = {}        # way id -> node ids, one per vertex in geoms
        self.names = {}        # way id -> name
        self.modes = {}        # way id -> bicycle/horse/dog tags
        self.paths = {}        # way id -> tags, for named paths not in a route
        self.features = {k: hl.PointIndex() for k in hl.FEATURES}
        self.parking = []      # one outline per usable lot: [(lon, lat)] (a single point for a node)

    def _feature(self, tags, is_water_outer=False, compact=False):
        if tags.get('tourism') == 'viewpoint' or tags.get('natural') == 'peak':
            return 'view'
        if tags.get('waterway') == 'waterfall' or tags.get('natural') == 'waterfall':
            return 'falls'
        if tags.get('natural') == 'beach':
            return 'beach'
        if (tags.get('natural') == 'water' and tags.get('water', '') in WATER_KINDS) or is_water_outer:
            return 'lake'
        if compact and (tags.get('natural') == 'water' and not tags.get('water')):
            return 'lake'
        return None

    def node(self, n):
        if not n.tags or not n.location.valid():
            return
        pk = place_index.kind_of(n.tags)
        if pk and n.tags.get('name'):
            self.places.append((n.tags['name'], pk, n.location.lat, n.location.lon))
        elif place_index.is_area(n.tags) and n.tags.get('name'):
            self.places.append((n.tags['name'], 'a', n.location.lat, n.location.lon))
        kind = self._feature(n.tags)
        if kind in ('view', 'falls', 'beach'):
            self.features[kind].add(hl.xy([(n.location.lon, n.location.lat)]))
        if n.tags.get('amenity') == 'parking' and hl.usable_parking(n.tags):
            self.parking.append([(round(n.location.lon, 5), round(n.location.lat, 5))])

    def way(self, w):
        if (w.id in self.area_ways or (w.tags.get('name') and place_index.is_area(w.tags))) and len(w.nodes) > 1:
            pts = [(n.location.lon, n.location.lat) for n in w.nodes if n.location.valid()]
            if pts:
                bb = (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))
                if w.id in self.area_ways:
                    self.area_bbox[w.id] = bb
                if w.tags.get('name') and place_index.is_area(w.tags):
                    self.places.append((w.tags['name'], 'a', (bb[1] + bb[3]) / 2, (bb[0] + bb[2]) / 2))
        is_member = w.id in self.member_ways
        hw = w.tags.get('highway', '')
        name = w.tags.get('name', '')
        is_path = bool(PATH_RE.match(hw)) and bool(name) and is_trail_name(hw, name)
        untagged = (w.tags.get('natural') == 'water' and not w.tags.get('water')) or w.id in self.water_untagged
        compact = False
        if untagged and not (w.id in self.water_outer):
            pts = [(n.location.lon, n.location.lat) for n in w.nodes if n.location.valid()]
            compact = len(pts) > 3 and pts[0] == pts[-1] and hl.compactness(pts) <= COMPACT_MAX
        kind = self._feature(w.tags, w.id in self.water_outer or (w.id in self.water_untagged and compact), compact)
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
        if is_parking and hl.usable_parking(w.tags):
            self.parking.append(coords)
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
        rids = sorted(k[1] for k in mine if k[0] == 'r')
        for i, ref in enumerate(refs):
            for wid, vi in self.at.get(ref, ()):
                # Skip only a pure continuation of every trail this way is on. A way on another route too
                # is kept, tagged with its routes, so the app can drop it for the trails it belongs to.
                if wid == w.id or (self.keys[wid] and self.keys[wid] <= mine):
                    continue
                for step, rng in ((-1, range(i - 1, -1, -1)), (1, range(i + 1, len(refs)))):
                    nxt = i + step
                    if not 0 <= nxt < len(refs) or refs[nxt] in self.nodeset[wid]:
                        continue  # no branch this way, or it runs along the trail
                    p = hl.branch_point(pts[i], [pts[k] for k in rng])
                    if not p:
                        continue
                    branch = p + [name, rids] if rids else (p + [name] if name else p)
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


def describe(way_ids, ways, rel_modes, parking):
    """(highlights, trailhead, owner way id) for one trail: a route's ways or a connected set of named-path ways."""
    dense = np.vstack([hl.densify(ways.geoms[w]) for w in way_ids])
    feats = {k for k in hl.FEATURES if ways.features[k].near(dense)}
    lengths = [way_length(ways.geoms[w]) for w in way_ids]
    shares = hl.mode_share([ways.modes[w] for w in way_ids], lengths)
    for fam, v in (rel_modes or {}).items():
        yes, no = shares[fam]   # the relation wins, but ways that say the opposite make it uncertain
        if v in hl.MODE_YES[fam]:
            shares[fam] = (1.0, no)
        elif v == 'no':
            shares[fam] = (yes, 1.0)
    h = hl.combine_highlights(feats, hl.mode_highlights(shares))
    node_lists = [ways.nodes[w] for w in way_ids]
    ends = hl.chain_ends(node_lists)
    end_pts = [ways.geoms[way_ids[wi]][pos] for wi, pos in ends]
    th, ei = hl.pick_trailhead(end_pts, parking)
    return h, th, way_ids[ends[ei][0]]


def junction_list(by_vertex):
    """{vertex index: branches} -> [[index, [[lon, lat, name?], ...]], ...] in vertex order."""
    return [[i, by_vertex[i]] for i in sorted(by_vertex)]


def write_cells(cells, out_dir, fmt=2):
    """The one place cell files are serialised: {(x, y): {'r': {rel id: entry}, 'w': [entries]}} -> <x>_<y>.json.
    fmt 2 is the compact format (cell_format.py); fmt 1 is the old absolute-coordinate format, kept for Washington's frozen v1 copy. Returns bytes written."""
    os.makedirs(out_dir, exist_ok=True)
    total = 0
    for (x, y), c in cells.items():
        body = json.dumps(cf.encode_cell(c) if fmt == 2 else {'v': 1, 'r': list(c['r'].values()), 'w': c['w']}, separators=(',', ':'))
        with open(os.path.join(out_dir, f'{x}_{y}.json'), 'w') as f:
            f.write(body)
        total += len(body)
    return total


def build(pbf, out_dir, source, dem_dir=None, v1=False):
    t0 = time.time()
    routes = RouteHandler()
    routes.apply_file(pbf)
    area_ways = {w for _, ws in routes.areas.values() for w in ws}
    ways = WayHandler(routes.member_ways, routes.water_outer, routes.water_untagged, area_ways)
    ways.apply_file(pbf, locations=True, idx='flex_mem')

    lats = [c[1] for g in ways.geoms.values() for c in g]
    if lats:
        hl.set_ref_lat(float(np.median(lats)))
    parking = hl.ParkingIndex(ways.parking)
    route_ways = {rid: [w for w in dict.fromkeys(r['ways']) if w in ways.geoms] for rid, r in routes.routes.items()}
    keys = {}
    for rid, wids in route_ways.items():
        for w in wids:
            keys.setdefault(w, set()).add(('r', rid))
    for w in ways.geoms:
        keys.setdefault(w, set())
        if ways.names[w] and not keys[w]:   # a way's identity is its routes, or its name if it is on none
            keys[w].add(('n', ways.names[w]))
    jh = JunctionHandler(ways.nodes, keys)
    jh.apply_file(pbf, locations=True, idx='flex_mem')

    route_info, path_info = {}, {}
    for rid, wids in route_ways.items():
        if wids:
            h, th, _ = describe(wids, ways, routes.routes[rid]['modes'], parking)
            route_info[rid] = {'h': h, 'th': th}
    path_groups_list = path_groups(ways)
    for wids in path_groups_list:
        h, th, owner = describe(wids, ways, None, parking)
        for w in wids:
            path_info[w] = {'h': h, 'th': th if w == owner else None}

    tiles = elevation.DemTiles(dem_dir or os.environ.get('DEM_CACHE_DIR') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '.dem-cache'))
    zs = sample_elevations(ways.geoms, tiles)

    # Simplify each way once (5 m, ends and junction vertices kept); z and junction indices follow the kept vertices.
    simple = {}
    for wid, g in ways.geoms.items():
        prot = jh.result.get(wid, {})
        kept = cf.simplify(hl.xy(g), prot)
        zabs = np.cumsum(zs[wid])
        pos = {v: i for i, v in enumerate(kept)}
        j = [[pos[vi], bs] for vi, bs in sorted(jh.result[wid].items())] if wid in jh.result else None
        simple[wid] = (flat([g[i] for i in kept]), elevation.encode_deltas(zabs[kept].tolist()), j)

    def make_cells(geom):
        """(x, y) -> {'r': {rel id: entry}, 'w': [entries]}, with each way's (coords, z, junctions) taken from geom."""
        cells = {}

        def cell(key):
            return cells.setdefault(key, {'r': {}, 'w': []})

        for rid, route in routes.routes.items():
            total = len(route['ways'])
            for wid in route['ways']:
                g = ways.geoms.get(wid)
                if not g:
                    continue
                member = [wid, geom[wid][0], geom[wid][1]]
                if geom[wid][2]:
                    member.append(geom[wid][2])
                for key in cells_for(g):
                    entry = cell(key)['r'].setdefault(rid, {'id': rid, 't': route['tags'], 'n': total, 'm': []})
                    if rid in route_info:
                        entry['h'] = route_info[rid]['h']
                        entry['th'] = route_info[rid]['th']
                    entry['m'].append(member)

        for wid, tags in ways.paths.items():
            g = ways.geoms[wid]
            entry = {'id': wid, 't': tags, 'g': geom[wid][0], 'z': geom[wid][1]}
            if path_info[wid]['h']:
                entry['h'] = path_info[wid]['h']
            if path_info[wid]['th']:
                entry['th'] = path_info[wid]['th']
            if geom[wid][2]:
                entry['j'] = geom[wid][2]
            for key in cells_for(g):
                cell(key)['w'].append(entry)

        return cells

    cells = make_cells(simple)
    v1_dir = os.path.join(out_dir, 'v1') if v1 else None
    if v1:  # Washington stays on the old format at the old path until the app versions that need it have aged out
        raw = {wid: (flat(g), zs[wid], junction_list(jh.result[wid]) if wid in jh.result else None) for wid, g in ways.geoms.items()}
        v1_cells = make_cells(raw)
        v1_bytes = write_cells(v1_cells, v1_dir, fmt=1)
    total_bytes = write_cells(cells, out_dir)

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
    if v1:
        with open(os.path.join(v1_dir, 'index.json'), 'w') as f:
            json.dump(index, f, separators=(',', ':'))

    n_names = name_index.write_name_index(os.path.join(out_dir, 'names.json'), routes.routes, ways.geoms, ways.paths)

    raw_places = list(ways.places)
    for name, wids in routes.areas.values():
        bbs = [ways.area_bbox[w] for w in wids if w in ways.area_bbox]
        if bbs:
            raw_places.append((name, 'a', (min(b[1] for b in bbs) + max(b[3] for b in bbs)) / 2, (min(b[0] for b in bbs) + max(b[2] for b in bbs)) / 2))
    if v1:
        shutil.copyfile(os.path.join(out_dir, 'names.json'), os.path.join(v1_dir, 'names.json'))
    n_places = place_index.write_places(os.path.join(out_dir, 'places.json'), raw_places)
    n_trails = sum(1 for wids in route_ways.values() if wids) + len(path_groups_list)
    has_elev = sum(1 for wids in route_ways.values() if wids and any(any(zs[w]) for w in wids))
    has_elev += sum(1 for g in path_groups_list if any(any(zs[w]) for w in g))
    report = {
        'trails': n_trails, 'routes': len(routes.routes), 'named_paths': len(ways.paths), 'cells': len(cells),
        'mb': round(total_bytes / 1e6, 2), 'build_minutes': round((time.time() - t0) / 60, 2),
        'elevation_pct': round(100 * has_elev / n_trails, 1) if n_trails else 0.0, 'names': n_names, 'places': n_places,
    }
    if v1:
        report['mb_v1'] = round(v1_bytes / 1e6, 2)
    with open(os.path.join(out_dir, 'report.json'), 'w') as f:
        json.dump(report, f, separators=(',', ':'))
    print('report:', json.dumps(report))
    print(f'name index: {n_names} entries, {os.path.getsize(os.path.join(out_dir, "names.json")) / 1e3:.0f} KB')
    print(f'routes: {len(routes.routes)}, named paths: {len(ways.paths)}, cells: {len(cells)}, '
          f'size: {total_bytes / 1e6:.1f} MB (before gzip), largest cell: '
          f'{max((os.path.getsize(os.path.join(out_dir, k + ".json")) for k in index["cells"]), default=0) / 1e3:.0f} KB')


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a != '--v1']
    if len(args) < 2:
        sys.exit(__doc__)
    build(args[0], args[1], args[2] if len(args) > 2 else 'OpenStreetMap', v1='--v1' in sys.argv)
