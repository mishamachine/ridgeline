#!/usr/bin/env python3
"""
Region tooling for the multi-region trail build (scripts/regions.json).

  regions.py matrix                       JSON for the GitHub Actions matrix
  regions.py fetch <id> <dest.pbf>        download the region's Geofabrik extract (URL from Geofabrik's JSON index)
  regions.py fallback <id>                after a failed download: use the cached extract only if under 28 days old
  regions.py note <id> <state> [key]      job-summary line: cache hit or miss, the PBF date
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
USER_AGENT = 'ridgeline-trail-build (machinemisha@gmail.com; github.com/mishamachine/ridgeline)'
MIN_SHARE = 0.5
MAX_GAIN_ERR_PCT = 15       # a classic's stored gain must be within this share of its published figure
MAX_GAIN_LOSS_SHARE = 0.02   # share of trails (with 100 ft or more of gain) that may lose over 25% of it on the simplified drawn line


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
                return res.headers.get('Last-Modified')
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
    print(json.dumps({'include': [{'id': r['id'], 'name': r['name'], 'v1': bool(r.get('v1'))} for r in load_regions()]}))


def verify_md5(dest, url):
    """Geofabrik publishes <extract>.md5 next to each extract: the download must match it, or it is deleted and the step fails."""
    import hashlib
    want = http_get(url + '.md5').decode().split()[0].lower()
    h = hashlib.md5()
    with open(dest, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    if h.hexdigest() != want:
        os.remove(dest)
        sys.exit(f'md5 mismatch for {url}: got {h.hexdigest()}, Geofabrik says {want}')
    print(f'md5 ok ({want})')


def cmd_fallback(rid, max_days=28):
    """After a failed download: the cached extract may be used only if it is not too old."""
    from email.utils import parsedate_to_datetime
    side = os.path.join('extract', rid + '.osm.pbf.json')
    if not (os.path.exists(side) and os.path.exists(os.path.join('extract', rid + '.osm.pbf'))):
        sys.exit(f'::error::Geofabrik download failed for {rid} and there is no cached extract')
    lm = json.load(open(side)).get('last_modified')
    age = (datetime.now(timezone.utc) - parsedate_to_datetime(lm)).days if lm else None
    if age is None or age > max_days:
        sys.exit(f'::error::Geofabrik download failed for {rid} and the cached extract is {age if age is not None else "of unknown"} days old (limit {max_days})')
    print(f'::warning::Geofabrik download failed for {rid}; building from the cached extract, {age} days old')


def cmd_fetch(rid, dest):
    url = pbf_url(region(rid)['geofabrik'], json.loads(http_get(INDEX_URL)))
    print(f'downloading {url}')
    modified = http_get(url, dest)
    verify_md5(dest, url)
    with open(dest + '.json', 'w') as f:   # kept with the cached extract: where and which version it is
        json.dump({'url': url, 'last_modified': modified, 'downloaded': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%MZ')}, f)
    print(f'{dest}: {os.path.getsize(dest) / 1e6:.0f} MB, last modified {modified}')


def cmd_note(rid, state, matched=''):
    """Job summary line for the extract: cache hit, miss (downloaded) or the download failed and an older cached extract was used."""
    side = os.path.join('extract', rid + '.osm.pbf.json')
    meta = json.load(open(side)) if os.path.exists(side) else {}
    line = (f"| {region(rid)['name']} extract | {state} | PBF last modified {meta.get('last_modified', 'unknown')} | "
            f"downloaded {meta.get('downloaded', 'unknown')} | cache key {matched or 'none'} |")
    print(line)
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a') as f:
            f.write('| Region | Geofabrik extract | PBF date | When downloaded | Cache |\n|---|---|---|---|---|\n' + line + '\n\n')


def norm(s):
    import re
    import unicodedata
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def prefer_exact(items, name_of, classic_name, key):
    """Of the items in range, those named exactly like the classic (optionally plus ' Trail') win; else the longest."""
    n = norm(classic_name)
    exact = [i for i in items if norm(name_of(i)) in (n, n + ' trail')]
    return max(exact or items, key=key) if items else None


def find_classic(entries, classic):
    """(matched entry or None, candidates). A name in names.json containing the classic's words, with a length inside len_m."""
    lo, hi = classic.get('len_m', [0, float('inf')])
    cands = [e for e in entries if norm(classic['name']) in norm(e[1])]
    ok = [e for e in cands if lo <= e[4] <= hi]
    return prefer_exact(ok, lambda e: e[1], classic['name'], lambda e: e[4]), cands


def stats_for(classic, stats):
    """(trail dict or None): the longest stored trail whose name has the classic's words and whose length is inside len_m."""
    lo, hi = classic.get('stored_len_m', classic.get('len_m', [0, float('inf')]))
    ok = [t for t in (stats or {}).get('trails', []) if norm(classic['name']) in norm(t['name']) and lo <= t['L'] <= hi]
    return prefer_exact(ok, lambda t: t['name'], classic['name'], lambda t: t['L'])


def gain_ft(t):
    """Headline gain as the app shows it: the whole ascent for a loop, else the bigger of the two ways."""
    return round((t['up'] if t['loop'] else max(t['up'], t['down'])) * 3.28084)


def check_region(r, report, entries, stats=None):
    """(problems, lines describing each classic). No problems = pass. stats: trail-stats.mjs output, when available."""
    bad, lines = [], []
    exp = r.get('expected_trails') or 0
    if exp and report['trails'] < MIN_SHARE * exp:
        bad.append(f"{r['name']}: collapse tripwire: {report['trails']} trails is under {int(MIN_SHARE * 100)}% of the self-baselined {exp}")
    if not report['cells']:
        bad.append(f"{r['name']}: no cells built")
    loss = (stats or {}).get('loss')
    if loss and loss['share'] > MAX_GAIN_LOSS_SHARE:
        bad.append(f"{r['name']}: {loss['over25']} of {loss['judged']} trails ({loss['share'] * 100:.1f}%) lose over 25% of their gain on the drawn line; limit {MAX_GAIN_LOSS_SHARE * 100:.0f}%")
    top = {c['name']: c['top'] for c in (stats or {}).get('classics', [])}
    for c in r.get('classics', []):
        hit, cands = find_classic(entries, c)
        if not hit:
            bad.append(f"{r['name']}: classic {c['name']!r} " + (f"found as {[(e[1], e[4]) for e in cands][:3]} but not within {c['len_m']} m" if cands else 'not found by name'))
            continue
        line = f"{c['name']}: {hit[1]} ({hit[0]}), {hit[4]} m ({hit[4] / 1609.344:.1f} mi)"
        if stats is not None:
            t = stats_for(c, stats)
            if not t:
                bad.append(f"{r['name']}: classic {c['name']!r}: no stored trail inside {c['len_m']} m")
            else:
                g = gain_ft(t)
                line += f"; stored {t['L']} m, gain {g} ft"
                pub = c.get('published_ft')
                if pub:
                    err = (g / pub - 1) * 100
                    line += f" (published {pub} ft, {err:+.1f}%)"
                    if c.get('known_bug'):
                        line += f"; temporary {c.get('max_err_pct', MAX_GAIN_ERR_PCT)}% limit, {c['known_bug']}"
                    if abs(err) > c.get('max_err_pct', MAX_GAIN_ERR_PCT):
                        bad.append(f"{r['name']}: classic {c['name']!r}: gain {g} ft is {err:+.1f}% from the published {pub} ft (limit {c.get('max_err_pct', MAX_GAIN_ERR_PCT)}%)")
            tp = top.get(c['name'])
            if tp is None or norm(c['name']) not in norm(tp[1]) or not c['len_m'][0] <= tp[4] <= c['len_m'][1]:
                bad.append(f"{r['name']}: name search for {c['name']!r} ranks {tp and (tp[1], tp[4])} first, not the main trail")
            else:
                line += f"; search ranks it first ({tp[1]})"
        lines.append(line)
    return bad, lines


def cmd_check(rid, d):
    r = region(rid)
    with open(os.path.join(d, 'report.json')) as f:
        rep = json.load(f)
    with open(os.path.join(d, 'names.json')) as f:
        entries = json.load(f)['e']
    stats = None
    if os.path.exists(os.path.join(d, 'stats.json')):
        with open(os.path.join(d, 'stats.json')) as f:
            stats = json.load(f)
    bad, lines = check_region(r, rep, entries, stats)
    exp = r.get('expected_trails') or 0
    tripwire = 'n/a' if not exp else ('PASS' if rep['trails'] >= MIN_SHARE * exp else 'FAIL') + f" ({rep['trails']} vs 50% of {exp})"
    row = (f"| {r['name']} | {rep['trails']} | {rep['cells']} | {rep['mb']} | {rep.get('mb_full', 'n/a')} | {rep['build_minutes']} | "
           f"{rep['elevation_pct']}% | {tripwire} | {rep.get('places', 'n/a')} |")
    print(row)
    for ln in lines:
        print('classic', ln)
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a') as f:
            f.write('| Region | Trails | Cells | MB (v2) | MB (full resolution) | Build minutes | With elevation | Collapse tripwire (self-baselined) | Places |\n|---|---|---|---|---|---|---|---|---|\n' + row + '\n\n')
            if stats and stats.get('drift') is not None:
                dr = stats['drift']
                f.write(f"Complete trails whose drawn length differs from the full length by more than 8%: {len(dr)} (routes show their stored numbers regardless). " + ('Largest: ' + '; '.join(f"{d['name']} ({d['L']} m full, {d['drawnL']} m drawn)" for d in sorted(dr, key=lambda d: -abs(d['drawnL'] - d['L']))[:8]) if dr else '') + '\n\n')
            if stats and stats.get('lowpoint') and stats['lowpoint']['total']:
                lp = stats['lowpoint']
                f.write(f"Mid-chain low points (a leg that dips more than 100 m below an end, the Dog Mountain signature): {lp['below_both_ends']} of {lp['total']} stitched trails ({lp['below_both_ends'] / lp['total'] * 100:.2f}%) below both ends; {lp['below_start_end']} ({lp['below_start_end'] / lp['total'] * 100:.2f}%) below the start end and climbing again.\n\n")
            if stats:
                lo = stats['loss']
                f.write(f"Stored length and gain: {stats['stored']} trails ({stats['skipped']} partial or without elevation skipped). Drawn-line gain check: {lo['over25']} of {lo['judged']} trails ({lo['share'] * 100:.2f}%) lose over 25% of their gain (limit {MAX_GAIN_LOSS_SHARE * 100:.0f}%).\n\n")
            f.write('Classic trails (matched name, length from names.json, stored length and gain from the full line):\n\n' + ''.join(f'- {ln}\n' for ln in lines) + ('\n**FAILED:** ' + '; '.join(bad) + '\n' if bad else ''))
    for b in bad:
        print(f'::error::{b}')
    sys.exit(1 if bad else 0)


def cell_center(keys, size=0.25):
    """[lon, lat] of the covered cell whose centre is nearest the mean of all the cells' centres: a point that has trails, unlike a bbox midpoint
    (which can fall in the sea or another state). None when there are no cells."""
    pts = [((int(k.split('_')[0]) + 0.5) * size - 180, (int(k.split('_')[1]) + 0.5) * size - 90) for k in keys]
    if not pts:
        return None
    mx, my = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
    best = min(pts, key=lambda p: (p[0] - mx) ** 2 + (p[1] - my) ** 2)
    return [round(best[0], 4), round(best[1], 4)]


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
    out = {'v': a['v'], 'r': list(rels.values()), 'w': list(ways.values())}
    if a.get('s') or b.get('s'):
        out['s'] = {**b.get('s', {}), **a.get('s', {})}   # stored trail stats, see trail-stats.mjs
    return out  # both sides are in the same cell format; keep its version


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
        listing.append({'id': rid, 'code': r['code'], 'name': r['name'], 'cc': r['cc'], 'center': cell_center(idx['cells']), 'bbox': idx['bbox'], 'cells': len(idx['cells']), 'names': f'names/{rid}.json', 'places': f'places/{rid}.json'})
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
    v1 = [d for d in dirs if by_id[os.path.basename(os.path.normpath(d)).removeprefix('trails-')].get('v1')]
    if len(v1) != 1:
        sys.exit('exactly one region must keep the frozen v1 copy ("v1": true in regions.json); found %d' % len(v1))
    for d in v1:  # the old path: this region's full-resolution old-format cells, index.json and names.json, as the old reader expects
        for f in os.listdir(os.path.join(d, 'full')):
            shutil.copyfile(os.path.join(d, 'full', f), os.path.join(root, f))
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
    elif a[:1] == ['fallback'] and len(a) == 2:
        cmd_fallback(a[1])
    elif a[:1] == ['note'] and len(a) >= 3:
        cmd_note(a[1], a[2], a[3] if len(a) > 3 else '')
    elif a[:1] == ['check'] and len(a) == 3:
        cmd_check(a[1], a[2])
    elif a[:1] == ['combine'] and len(a) >= 3:
        cmd_combine(a[1], a[2:])
    else:
        sys.exit(__doc__)
