#!/usr/bin/env python3
"""Regenerate src/lib/fixtures/wa-cells-v2.json from the real v1 cells in src/lib/fixtures/wa-cells.json (same simplify + encode as the build)."""
import json
import os
import sys

import numpy as np

import cell_format as cf
import highlights as hl

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, '..', 'src', 'lib', 'fixtures')


def simplify_member(m):
    g = m[1]
    pts = [(g[i], g[i + 1]) for i in range(0, len(g), 2)]
    j = m[3] if len(m) > 3 else []
    kept = cf.simplify(hl.xy(pts), [vi for vi, _ in j])
    zabs = np.cumsum(m[2])
    pos = {v: i for i, v in enumerate(kept)}
    out = [m[0], [c for i in kept for c in pts[i]], [int(v) for v in np.diff(np.concatenate([[0], zabs[kept]]))]]
    if j:
        out.append([[pos[vi], bs] for vi, bs in j])
    return out


def main():
    src = json.load(open(os.path.join(FIX, 'wa-cells.json')))
    out = {}
    for name, cells in src.items():
        out[name] = []
        for c in cells:
            rels = {}
            for r in c['r']:
                rels[r['id']] = {**r, 'm': [simplify_member(m) for m in r['m']]}
            ways = [{**w, 'g': w['g'], 'z': w['z']} for w in c['w']]
            out[name].append(cf.encode_cell({'r': rels, 'w': ways}))
    with open(os.path.join(FIX, 'wa-cells-v2.json'), 'w') as f:
        json.dump(out, f, separators=(',', ':'))


if __name__ == '__main__':
    sys.exit(main())
