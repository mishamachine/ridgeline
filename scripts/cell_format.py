"""
Cell file format v2 (smaller files; the app still reads v1). One cell file is {"v": 2, "r": [...], "w": [...]}.

  Coordinates are integers at 1e-5 degrees (about 1.1 m), delta-encoded: g = [x0, y0, dx1, dy1, ...], the first
  point absolute. Lines are simplified (Douglas-Peucker, 5 m) keeping both ends, every junction vertex and every
  vertex where the height turns (peaks and dips of 2 m or more), so the drawn elevation profile keeps its humps.
  The numbers the app shows (length, ascent, descent) are measured on the full line at build time and stored in `s`.
  z is whole-metre deltas, one per KEPT vertex (same length as the points in g).
  th = [dx, dy, 1|0]: the trailhead as an offset from the entry's first point (a route's first member, a way's g).
  j  = [[vertex index (into the kept points), [[dx, dy, name?, routes?], ...]], ...]: each branch point as an
       offset from its own vertex.
  t  keeps only the tags the app reads (name, ref on relations, sac_scale, surface, dog, operator, description,
       trail_visibility, website): way ref and route are dropped.
  Other keys are as in v1: r entries {id, t, n, m: [[way id, g, z, j?], ...], h?, th?}; w entries {id, t, g, z, h?, th?, j?}.

decode() is the exact inverse apart from the simplification (used by the tests; the app has its own decoder in
src/lib/cells.ts).
"""
import numpy as np

SCALE = 100000          # 1e-5 degrees
DP_TOLERANCE_M = 5.0
Z_TURN_M = 2.0           # height turns smaller than this are ignored when protecting peaks and dips
KEEP_WAY_TAGS = ('name', 'sac_scale', 'surface', 'dog', 'operator', 'description', 'trail_visibility', 'website')
KEEP_REL_TAGS = ('name', 'ref') + KEEP_WAY_TAGS[1:]


def z_turns(z, tol=Z_TURN_M):
    """Indices where the height turns (a peak or a dip), ignoring wiggles smaller than tol metres.
    A flat 2D simplification drops the vertices between two kept points, and with them a hump or a dip the line walks over:
    keeping these keeps the climb honest."""
    z = [float(v) for v in z]
    if len(z) < 3:
        return []
    out, ext, ext_i, up = [], z[0], 0, None
    for i in range(1, len(z)):
        v = z[i]
        if up is None:
            if abs(v - ext) >= tol:
                up = v > ext
                ext, ext_i = v, i
            continue
        if up:
            if v > ext:
                ext, ext_i = v, i
            elif ext - v >= tol:
                out.append(ext_i)
                up, ext, ext_i = False, v, i
        else:
            if v < ext:
                ext, ext_i = v, i
            elif v - ext >= tol:
                out.append(ext_i)
                up, ext, ext_i = True, v, i
    return out


def simplify(p, protected, tol=DP_TOLERANCE_M):
    """Indices kept by Douglas-Peucker on metre points p (n, 2). Both ends and every protected index are always kept."""
    n = len(p)
    if n <= 2:
        return list(range(n))
    keep = np.zeros(n, dtype=bool)
    keep[0] = keep[-1] = True
    for i in protected:
        if 0 <= i < n:
            keep[i] = True
    anchors = np.flatnonzero(keep)
    stack = [(int(a), int(b)) for a, b in zip(anchors[:-1], anchors[1:]) if b - a > 1]
    while stack:
        a, b = stack.pop()
        seg = p[b] - p[a]
        rel = p[a + 1:b] - p[a]
        L2 = float(seg @ seg)
        if L2 == 0:
            d = np.hypot(rel[:, 0], rel[:, 1])
        else:
            t = np.clip((rel @ seg) / L2, 0, 1)
            proj = t[:, None] * seg
            d = np.hypot(rel[:, 0] - proj[:, 0], rel[:, 1] - proj[:, 1])
        k = int(np.argmax(d))
        if d[k] > tol:
            m = a + 1 + k
            keep[m] = True
            if m - a > 1:
                stack.append((a, m))
            if b - m > 1:
                stack.append((m, b))
    return np.flatnonzero(keep).tolist()


def q(v):
    return int(round(v * SCALE))


def enc_g(flat):
    out, px, py = [], 0, 0
    for i in range(0, len(flat), 2):
        x, y = q(flat[i]), q(flat[i + 1])
        out += [x - px, y - py]
        px, py = x, y
    return out


def enc_j(j, flat):
    out = []
    for vi, branches in j:
        vx, vy = q(flat[2 * vi]), q(flat[2 * vi + 1])
        out.append([vi, [[q(b[0]) - vx, q(b[1]) - vy] + list(b[2:]) for b in branches]])
    return out


def enc_th(th, ref):
    return [q(th[0]) - ref[0], q(th[1]) - ref[1], th[2]]


def _tags(t, keep):
    return {k: t[k] for k in keep if k in t}


def encode_cell(c):
    """{'r': {rel id: entry}, 'w': [entries]} with absolute float coordinates -> the v2 body."""
    rels = []
    for e in c['r'].values():
        first = e['m'][0][1]
        ref = (q(first[0]), q(first[1]))
        out = {'id': e['id'], 't': _tags(e['t'], KEEP_REL_TAGS), 'n': e['n'], 'm': []}
        for m in e['m']:
            item = [m[0], enc_g(m[1]), m[2]]
            if len(m) > 3:
                item.append(enc_j(m[3], m[1]))
            out['m'].append(item)
        if 'h' in e:
            out['h'] = e['h']
        if e.get('th'):
            out['th'] = enc_th(e['th'], ref)
        rels.append(out)
    ways = []
    for e in c['w']:
        out = {'id': e['id'], 't': _tags(e['t'], KEEP_WAY_TAGS), 'g': enc_g(e['g']), 'z': e['z']}
        if 'h' in e:
            out['h'] = e['h']
        if e.get('th'):
            out['th'] = enc_th(e['th'], (q(e['g'][0]), q(e['g'][1])))
        if 'j' in e:
            out['j'] = enc_j(e['j'], e['g'])
        ways.append(out)
    return {'v': 2, 'r': rels, 'w': ways}


def dec_g(g):
    out, x, y = [], 0, 0
    for i in range(0, len(g), 2):
        x += g[i]
        y += g[i + 1]
        out += [x / SCALE, y / SCALE]
    return out


def dec_j(j, flat):
    return [[vi, [[(round(flat[2 * vi] * SCALE) + b[0]) / SCALE, (round(flat[2 * vi + 1] * SCALE) + b[1]) / SCALE] + b[2:] for b in bs]] for vi, bs in j]


def decode_cell(body):
    """Inverse of encode_cell, back to the v1 shape (for tests)."""
    rels = []
    for e in body['r']:
        out = {**e, 'm': []}
        for m in e['m']:
            g = dec_g(m[1])
            item = [m[0], g, m[2]]
            if len(m) > 3:
                item.append(dec_j(m[3], g))
            out['m'].append(item)
        if 'th' in e:
            f = out['m'][0][1]
            out['th'] = [(round(f[0] * SCALE) + e['th'][0]) / SCALE, (round(f[1] * SCALE) + e['th'][1]) / SCALE, e['th'][2]]
        rels.append(out)
    ways = []
    for e in body['w']:
        g = dec_g(e['g'])
        out = {**e, 'g': g}
        if 'th' in e:
            out['th'] = [(round(g[0] * SCALE) + e['th'][0]) / SCALE, (round(g[1] * SCALE) + e['th'][1]) / SCALE, e['th'][2]]
        if 'j' in e:
            out['j'] = dec_j(e['j'], g)
        ways.append(out)
    return {'v': 1, 'r': rels, 'w': ways}
