#!/usr/bin/env python3
"""
Region tooling for the multi-region trail build (scripts/regions.json).

  regions.py matrix                       JSON for the GitHub Actions matrix
  regions.py fetch <id> <dest.pbf>        download the region's Geofabrik extract (URL from Geofabrik's JSON index)
  regions.py check <id> <dir>             report + fail if under 50% of the expected trail count or a classic is missing
  regions.py combine <out> <dir>...       merge per-region build dirs (each named by region id) into <out>/v2, plus the frozen v1 copy in <out>

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


def pbf_url(gid, index):
    """Geofabrik index id (e.g. 'us/washington', as listed in the index) -> the .osm.pbf URL."""
    for f in index['features']:
        p = f['properties']
        if p['id'] == gid:
            return p['urls']['pbf']
    raise KeyError(f'{gid} not in the Geofabrik index')


def cmd_matrix():
    print(json.dumps({'include': [{'id': r['id'], 'name': r['name'], 'v1': '--v1' if r.get('v1') else ''} for r in load_regions()]}))


def cmd_fetch(rid, dest):
    url = pbf_url(region(rid)['geofabrik'], json.loads(http_get(INDEX_URL)))
    print(f'downloading {url}')
    http_get(url, dest)
    print(f'{dest}: {os.path.getsize(dest) / 1e6:.0f} MB')


def norm(s):
    import re
    import unicodedata
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def find_classic(entries, classic):
    """(matched entry or None, candidates). A name in names.json containing the classic's words, with a length inside len_m."""
    lo, hi = classic.get('len_m', [0, float('inf')])
    cands = [e for e in entries if norm(classic['name']) in norm(e[1])]
    ok = [e for e in cands if lo <= e[4] <= hi]
    return (max(ok, key=lambda e: e[4]) if ok else None), cands


def check_region(r, report, entries):
    """(problems, lines describing each classic). No problems = pass."""
    bad, lines = [], []
    exp = r.get('expected_trails') or 0
    if exp and report['trails'] < MIN_SHARE * exp:
        bad.append(f"{r['name']}: collapse tripwire: {report['trails']} trails is under {int(MIN_SHARE * 100)}% of the self-baselined {exp}")
    if not report['cells']:
        bad.append(f"{r['name']}: no cells built")
    for c in r.get('classics', []):
        hit, cands = find_classic(entries, c)
        if hit:
            lines.append(f"{c['name']}: {hit[1]} ({hit[0]}), {hit[4]} m ({hit[4] / 1609.344:.1f} mi)")
        elif cands:
            bad.append(f"{r['name']}: classic {c['name']!r} found as {[(e[1], e[4]) for e in cands][:3]} but not within {c['len_m']} m")
        else:
            bad.append(f"{r['name']}: classic {c['name']!r} not found by name")
    return bad, lines


def cmd_check(rid, d):
    r = region(rid)
    with open(os.path.join(d, 'report.json')) as f:
        rep = json.load(f)
    with open(os.path.join(d, 'names.json')) as f:
        entries = json.load(f)['e']
    bad, lines = check_region(r, rep, entries)
    row = (f"| {r['name']} | {rep['trails']} | {rep['cells']} | {rep['mb']} | {rep.get('mb_v1', 'n/a')} | {rep['build_minutes']} | "
           f"{rep['elevation_pct']}% | {r.get('expected_trails') or 'n/a'} | {rep.get('places', 'n/a')} |")
    print(row)
    for ln in lines:
        print('classic', ln)
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a') as f:
            f.write('| Region | Trails | Cells | MB (v2) | MB (v1 copy) | Build min | With elevation | Collapse tripwire (self-baselined) | Places |\n|---|---|---|---|---|---|---|---|---|\n' + row + '\n\n')
            f.write('Classic trails (matched name, length from names.json):\n\n' + ''.join(f'- {ln}\n' for ln in lines) + ('\n**FAILED:** ' + '; '.join(bad) + '\n' if bad else ''))
    for b in bad:
        print(f'::error::{b}')
    sys.exit(1 if bad else 0)


def merge_cell(a, b):
    """Two cell bodies (same format version) for the same grid cell (a region border): union by relation id and way id."""
    assert a['v'] == b['v'], f"cell versions differ: {a['v']} vs {b['v']}"
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
    return {'v': a['v'], 'r': list(rels.values()), 'w': list(ways.values())}  # both sides are in the same cell format; keep its version


def combine(root, dirs, regs=None):
    """Writes <root>/v2/ (every region: cells, index.json with the regions list, names/, places/) and, for the
    regions marked v1 in regions.json (Washington), the frozen old-format copy at <root>/ itself, where app builds
    that predate v2 still read it."""
    regs = regs or load_regions()
    out = os.path.join(root, 'v2')
    os.makedirs(out, exist_ok=True)
    by_id = {r['id']: r for r in regs}
    os.makedirs(os.path.join(out, 'names'), exist_ok=True)
    os.makedirs(os.path.join(out, 'places'), exist_ok=True)
    cells, listing, boxes, sources = {}, [], [], []
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
        shutil.copyfile(os.path.join(d, 'names.json'), os.path.join(out, 'names', rid + '.json'))
        with open(os.path.join(d, 'places.json'), encoding='utf-8') as f:
            places = json.load(f)
        places['region'] = rid
        with open(os.path.join(out, 'places', rid + '.json'), 'w', encoding='utf-8') as f:
            json.dump(places, f, separators=(',', ':'), ensure_ascii=False)
        listing.append({'id': rid, 'name': r['name'], 'cc': r['cc'], 'bbox': idx['bbox'], 'cells': len(idx['cells']), 'names': f'names/{rid}.json', 'places': f'places/{rid}.json'})
        if idx['bbox']:
            boxes.append(idx['bbox'])
        sources.append(r['name'])
    keys = sorted(cells, key=lambda c: tuple(int(v) for v in c.split('_')))
    cell = 0.25
    index = {
        'v': 2, 'built': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'source': f"OpenStreetMap via Geofabrik ({', '.join(sources)})", 'cell': cell, 'elevation': 'Copernicus DEM GLO-90',
        'bbox': [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)] if boxes else None,
        'cells': keys, 'regions': listing,
    }
    with open(os.path.join(out, 'index.json'), 'w') as f:
        json.dump(index, f, separators=(',', ':'))
    for kind in ('names', 'places'):  # which shard covers where (the app reads the same list from index.json)
        with open(os.path.join(out, kind, 'manifest.json'), 'w') as f:
            json.dump({'v': 1, 'shards': [{'id': r['id'], 'file': r[kind], 'bbox': r['bbox']} for r in listing]}, f, separators=(',', ':'))
    v1 = [d for d in dirs if os.path.isdir(os.path.join(d, 'v1'))]
    if len(v1) > 1:
        sys.exit('only one region may keep the frozen v1 copy')
    for d in v1:  # the old path: this region's old-format cells, index.json and names.json, byte for byte as the old reader expects
        for f in os.listdir(os.path.join(d, 'v1')):
            shutil.copyfile(os.path.join(d, 'v1', f), os.path.join(root, f))
    return index


def cmd_combine(out, dirs):
    idx = combine(out, dirs)
    print(f"combined {len(idx['regions'])} regions, {len(idx['cells'])} cells -> {out}/v2")


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
