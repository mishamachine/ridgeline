#!/usr/bin/env python3
"""
Region tooling for the multi-region trail build (scripts/regions.json).

  regions.py matrix                       JSON for the GitHub Actions matrix
  regions.py fetch <id> <dest.pbf>        download the region's Geofabrik extract (URL from Geofabrik's JSON index)
  regions.py check <id> <dir>             report + fail if under 50% of the expected trail count or a classic is missing
  regions.py combine <out> <dir>...       merge per-region build dirs (each named by region id) into one trails/ tree

Geofabrik etiquette: one download per region per week (the workflow caches on the ISO week), an identifying
User-Agent with a contact address, and the machine-readable index (no scraping).
"""
import json
import os
import shutil
import sys
import time
import urllib.request
from datetime import datetime, timezone

import name_index

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX_URL = 'https://download.geofabrik.de/index-v1-nogeom.json'
USER_AGENT = 'ridgeline-trail-build (github.com/mishamachine/ridgeline; machinemisha@gmail.com)'
MIN_SHARE = 0.5


def load_regions():
    with open(os.path.join(HERE, 'regions.json')) as f:
        return json.load(f)['regions']


def region(rid):
    for r in load_regions():
        if r['id'] == rid:
            return r
    sys.exit(f'unknown region {rid!r}')


def http_get(url, dest=None):
    req = urllib.request.Request(url, headers={'User-Agent': os.environ.get('GEOFABRIK_UA', USER_AGENT)})
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                if dest is None:
                    return res.read()
                with open(dest + '.part', 'wb') as f:
                    shutil.copyfileobj(res, f)
                os.replace(dest + '.part', dest)
                return None
        except Exception as e:  # noqa: BLE001 - retry any network failure
            last = e
            time.sleep(5 * (attempt + 1))
    sys.exit(f'download failed: {url}: {last}')


def pbf_url(spec, index):
    """spec 'parent/id' (e.g. 'us/washington') -> the .osm.pbf URL listed in Geofabrik's index."""
    parent, gid = spec.split('/')
    for f in index['features']:
        p = f['properties']
        if p['id'] == gid and p.get('parent') == parent:
            return p['urls']['pbf']
    raise KeyError(f'{spec} not in the Geofabrik index')


def cmd_matrix():
    print(json.dumps({'include': [{'id': r['id'], 'name': r['name']} for r in load_regions()]}))


def cmd_fetch(rid, dest):
    url = pbf_url(region(rid)['geofabrik'], json.loads(http_get(INDEX_URL)))
    print(f'downloading {url}')
    http_get(url, dest)
    print(f'{dest}: {os.path.getsize(dest) / 1e6:.0f} MB')


def classics_missing(entries, classics):
    """Classics with no name in the index containing them (case/accent-insensitive, words in order)."""
    names = [name_index_norm(e[1]) for e in entries]
    return [c for c in classics if not any(name_index_norm(c) in n for n in names)]


def name_index_norm(s):
    import re
    import unicodedata
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def check_region(r, report, entries):
    """List of problems (empty = pass)."""
    bad = []
    exp = r.get('expected_trails') or 0
    if exp and report['trails'] < MIN_SHARE * exp:
        bad.append(f"{r['name']}: {report['trails']} trails is under {int(MIN_SHARE * 100)}% of the expected {exp}")
    if not report['cells']:
        bad.append(f"{r['name']}: no cells built")
    miss = classics_missing(entries, r.get('classics', []))
    if miss:
        bad.append(f"{r['name']}: classics not found by name: {', '.join(miss)}")
    return bad


def cmd_check(rid, d):
    r = region(rid)
    with open(os.path.join(d, 'report.json')) as f:
        rep = json.load(f)
    with open(os.path.join(d, 'names.json')) as f:
        entries = json.load(f)['e']
    line = (f"| {r['name']} | {rep['trails']} | {rep['cells']} | {rep['mb']} | {rep['build_minutes']} | "
            f"{rep['elevation_pct']}% | {r.get('expected_trails') or 'n/a'} |")
    print(line)
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a') as f:
            f.write('| Region | Trails | Cells | MB (raw) | Build min | With elevation | Expected trails |\n|---|---|---|---|---|---|---|\n' + line + '\n')
    bad = check_region(r, rep, entries)
    for b in bad:
        print(f'::error::{b}')
    sys.exit(1 if bad else 0)


def merge_cell(a, b):
    """Two cell bodies for the same grid cell (a region border): union by relation id and way id."""
    rels = {x['id']: x for x in a['r']}
    for x in b['r']:
        if x['id'] in rels:
            mine = rels[x['id']]
            have = {m[0] for m in mine['m']}
            mine['m'].extend(m for m in x['m'] if m[0] not in have)
            mine['n'] = max(mine['n'], x['n'])
        else:
            rels[x['id']] = x
    ways = {x['id']: x for x in a['w']}
    for x in b['w']:
        ways.setdefault(x['id'], x)
    return {'v': 1, 'r': list(rels.values()), 'w': list(ways.values())}


def combine(out, dirs, regs=None):
    regs = regs or load_regions()
    by_id = {r['id']: r for r in regs}
    os.makedirs(os.path.join(out, 'names'), exist_ok=True)
    os.makedirs(os.path.join(out, 'places'), exist_ok=True)
    cells, all_names, listing, boxes, sources = {}, {}, [], [], []
    for d in dirs:
        rid = os.path.basename(os.path.normpath(d)).removeprefix('trails-')  # CI artifacts are named trails-<id>
        r = by_id[rid]
        with open(os.path.join(d, 'index.json')) as f:
            idx = json.load(f)
        for c in idx['cells']:
            src = os.path.join(d, c + '.json')
            if c not in cells:
                cells[c] = src
                shutil.copyfile(src, os.path.join(out, c + '.json'))
            else:  # border cell built by two regions
                with open(os.path.join(out, c + '.json')) as f:
                    a = json.load(f)
                with open(src) as f:
                    b = json.load(f)
                with open(os.path.join(out, c + '.json'), 'w') as f:
                    json.dump(merge_cell(a, b), f, separators=(',', ':'))
        with open(os.path.join(d, 'names.json'), encoding='utf-8') as f:
            names = json.load(f)
        shutil.copyfile(os.path.join(d, 'names.json'), os.path.join(out, 'names', rid + '.json'))
        with open(os.path.join(d, 'places.json'), encoding='utf-8') as f:
            places = json.load(f)
        places['region'] = rid
        with open(os.path.join(out, 'places', rid + '.json'), 'w', encoding='utf-8') as f:
            json.dump(places, f, separators=(',', ':'), ensure_ascii=False)
        for e in names['e']:
            all_names.setdefault(e[0], e)
        listing.append({'id': rid, 'name': r['name'], 'cc': r['cc'], 'bbox': idx['bbox'], 'cells': len(idx['cells']), 'names': f'names/{rid}.json', 'places': f'places/{rid}.json'})
        if idx['bbox']:
            boxes.append(idx['bbox'])
        sources.append(r['name'])
    keys = sorted(cells, key=lambda c: tuple(int(v) for v in c.split('_')))
    cell = 0.25
    index = {
        'v': 1, 'built': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'source': f"OpenStreetMap via Geofabrik ({', '.join(sources)})", 'cell': cell, 'elevation': 'Copernicus DEM GLO-90',
        'bbox': [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)] if boxes else None,
        'cells': keys, 'regions': listing,
    }
    with open(os.path.join(out, 'index.json'), 'w') as f:
        json.dump(index, f, separators=(',', ':'))
    for kind in ('names', 'places'):  # which shard covers where (the app reads the same list from index.json)
        with open(os.path.join(out, kind, 'manifest.json'), 'w') as f:
            json.dump({'v': 1, 'shards': [{'id': r['id'], 'file': r[kind], 'bbox': r['bbox']} for r in listing]}, f, separators=(',', ':'))
    # Legacy combined name index for app builds that predate the per-region shards. Drop once they age out.
    rows = sorted(all_names.values(), key=lambda r: (r[1].lower(), r[0]))
    with open(os.path.join(out, 'names.json'), 'w', encoding='utf-8') as f:
        json.dump({'v': 1, 'e': rows}, f, separators=(',', ':'), ensure_ascii=False)
    return index


def cmd_combine(out, dirs):
    idx = combine(out, dirs)
    print(f"combined {len(idx['regions'])} regions, {len(idx['cells'])} cells -> {out}")


if __name__ == '__main__':
    a = sys.argv[1:]
    if a[:1] == ['matrix']:
        cmd_matrix()
    elif a[:1] == ['fetch'] and len(a) == 3:
        cmd_fetch(a[1], a[2])
    elif a[:1] == ['check'] and len(a) == 3:
        cmd_check(a[1], a[2])
    elif a[:1] == ['combine'] and len(a) >= 3:
        cmd_combine(a[1], a[2:])
    else:
        sys.exit(__doc__)
