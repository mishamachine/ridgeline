"""
Place index for search, from OpenStreetMap only (the same Geofabrik extract as the trails). No other data source.

Per region: places/<region>.json = {"v": 1, "region": "<id>", "e": [[name, kind, lat, lon], ...]}
  lat and lon are integers at 1e-5 degrees (absolute). kind is one letter:
    c city, t town, v village, h hamlet   place=city|town|village|hamlet
    p peak                                 natural=peak
    a protected area or park               boundary=protected_area, leisure=nature_reserve|park (nodes, ways, relations)
    r trailhead                            highway=trailhead
  Only named objects. Areas are placed at the centre of their bounding box. Same-name, same-kind duplicates
  within DUP_M of each other (a park mapped as both a way and a relation) are merged.
"""
import json
import math

SCALE = 100000
DUP_M = 3000
PLACE_KINDS = {'city': 'c', 'town': 't', 'village': 'v', 'hamlet': 'h'}
AREA_LEISURE = {'nature_reserve', 'park'}


def kind_of(tags):
    """One-letter kind for a tagged object, or None."""
    p = PLACE_KINDS.get(tags.get('place', ''))
    if p:
        return p
    if tags.get('natural') == 'peak':
        return 'p'
    if tags.get('highway') == 'trailhead':
        return 'r'
    return None


def is_area(tags):
    return tags.get('boundary') == 'protected_area' or tags.get('leisure', '') in AREA_LEISURE


def _near(a, b):
    dlat = (a[0] - b[0]) / SCALE * 111000
    dlon = (a[1] - b[1]) / SCALE * 111000 * math.cos(math.radians(a[0] / SCALE))
    return math.hypot(dlat, dlon) <= DUP_M


def build_records(raw):
    """raw: [(name, kind, lat, lon)] with float degrees -> sorted, merged [[name, kind, lat, lon]] with integer coordinates."""
    seen, out = {}, []
    for name, kind, lat, lon in raw:
        name = name.strip()
        if len(name) < 2:
            continue
        pos = (int(round(lat * SCALE)), int(round(lon * SCALE)))
        key = (name.lower(), kind)
        if any(_near(pos, p) for p in seen.get(key, ())):
            continue
        seen.setdefault(key, []).append(pos)
        out.append([name, kind, pos[0], pos[1]])
    out.sort(key=lambda r: (r[0].lower(), r[1], r[2], r[3]))
    return out


def write_places(path, raw, region=''):
    rows = build_records(raw)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump({'v': 1, 'region': region, 'e': rows}, f, separators=(',', ':'), ensure_ascii=False)
    return len(rows)
