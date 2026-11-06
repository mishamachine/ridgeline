"""
Compact trail-name index for the app's search: <out>/names.json

Every route relation and every group of same-named paths (per grid cell) becomes one entry
  [id, name, lon, lat, length_m]
where id matches the app's trail ids (osm-r<relation>, osm-w<lowest way id>), lon/lat is where the
trail starts, and length is metres rounded to 10. Junk names and anything shorter than the minimum
length are left out. If the file would be bigger than MAX_BYTES the minimum length is raised.
"""
import json
import math
import re

CELL = 0.25
MIN_LENGTHS = [800, 1500, 3000, 6000]  # metres
MAX_BYTES = 700_000

JUNK_WORDS = re.compile(
    r'\b(private|abandoned|closed|impassable|disused|decommissioned|proposed|under construction|no name|noname|'
    r'unnamed|unknown|temporary|driveway|sporting clays|shooting range|razed|test|tbd|todo)\b', re.I)
NUMBER_ONLY = re.compile(r'^[\d\s./#-]+[A-Za-z]?$')
ROAD_CODE = re.compile(r'^(nf|fs|fr|sr|us|i)[- ]?\d+', re.I)
SHORT_JUNK = re.compile(r'^(path|trail|track|footway|connector|unnamed trail|service road)$', re.I)


def is_junk_name(name):
    n = name.strip()
    return len(n) < 3 or bool(JUNK_WORDS.search(n) or NUMBER_ONLY.match(n) or ROAD_CODE.match(n) or SHORT_JUNK.match(n))


def haversine(a, b):
    r = 6371008.8
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp, dl = p2 - p1, math.radians(b[0] - a[0])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1, math.sqrt(h)))


def length(coords):
    return sum(haversine(coords[i - 1], coords[i]) for i in range(1, len(coords)))


def cell_of(p):
    return math.floor((p[0] + 180) / CELL), math.floor((p[1] + 90) / CELL)


def entries(routes, geoms, paths):
    """routes: rel id -> {'tags', 'ways'}; geoms: way id -> [(lon, lat)]; paths: way id -> tags (named paths outside routes)."""
    out = []
    for rid, r in routes.items():
        name = r['tags'].get('name') or r['tags'].get('ref')
        gs = [geoms[w] for w in r['ways'] if w in geoms]
        if not name or not gs or is_junk_name(name):
            continue
        longest = max(gs, key=length)
        out.append([f'osm-r{rid}', name, longest[0], sum(length(g) for g in gs)])
    groups = {}
    for wid, tags in paths.items():
        g = geoms.get(wid)
        name = tags.get('name')
        if not g or not name or is_junk_name(name):
            continue
        groups.setdefault((name, cell_of(g[0])), []).append((wid, g))
    for (name, _), ways in groups.items():
        best = max(ways, key=lambda w: length(w[1]))
        out.append([f'osm-w{min(w[0] for w in ways)}', name, best[1][0], sum(length(w[1]) for w in ways)])
    return out


def build_name_index(routes, geoms, paths):
    """The index as a dict, with the smallest minimum length that keeps it under MAX_BYTES."""
    raw = entries(routes, geoms, paths)
    for floor in MIN_LENGTHS:
        rows = [
            [e[0], e[1], round(e[2][0], 4), round(e[2][1], 4), int(round(e[3], -1))]
            for e in raw if e[3] >= floor
        ]
        rows.sort(key=lambda r: (r[1].lower(), r[0]))
        body = {'v': 1, 'min_m': floor, 'e': rows}
        if len(json.dumps(body, separators=(',', ':'), ensure_ascii=False).encode()) <= MAX_BYTES:
            break
    return body


def write_name_index(out_path, routes, geoms, paths):
    body = build_name_index(routes, geoms, paths)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(body, f, separators=(',', ':'), ensure_ascii=False)
    return len(body['e'])
