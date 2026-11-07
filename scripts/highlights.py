"""
Trail highlights, trailhead parking and junction branches, for scripts/build_trails.py.
Pure functions over plain coordinates; no OSM reading here.

Distances use an equirectangular projection and lines densified to DENSIFY_M, so a "within 150 m"
test is accurate to roughly +-20 m (a feature 150-170 m away can be missed). Good enough for icons.
"""
import math
from collections import defaultdict

import numpy as np

NEAR_M = 150          # view / lake / falls / beach distance to the line
PARKING_M = 300       # parking distance to either end of the trail
DENSIFY_M = 25
BRANCH_M = 20         # branch point distance from the junction
MODE_YES = {'bicycle': {'yes', 'designated', 'permissive'},
            'horse': {'yes', 'designated', 'permissive'},
            'dog': {'yes', 'leashed'}}
FEATURES = ('view', 'lake', 'falls', 'beach')
ORDER = ['view', 'lake', 'falls', 'beach', 'bikes', 'horses', 'dogs', 'nodogs']
M_LAT = 110574.0
M_LON = 111320.0
REF_LAT = 47.5        # projection latitude; build_trails sets it to the data's own


def set_ref_lat(lat):
    global REF_LAT
    REF_LAT = lat


def xy(coords):
    """[(lon, lat)] -> (n, 2) metres."""
    a = np.asarray(coords, dtype='float64').reshape(-1, 2)
    return np.column_stack([a[:, 0] * M_LON * math.cos(math.radians(REF_LAT)), a[:, 1] * M_LAT])


def compactness(ring):
    """Perimeter^2 / area of a closed ring [(lon, lat)]: about 12.6 for a circle, 16 for a square, large for a river."""
    p = xy(ring)
    x, y = p[:, 0], p[:, 1]
    area = abs(float(np.dot(x[:-1], y[1:]) - np.dot(x[1:], y[:-1]))) / 2
    perim = float(np.hypot(np.diff(x), np.diff(y)).sum())
    return perim * perim / area if area > 0 else float('inf')


def densify(coords, step=DENSIFY_M):
    """Points along a line at most `step` metres apart (vertices kept), as (n, 2) metres."""
    p = xy(coords)
    if len(p) < 2:
        return p
    out = [p[:1]]
    for a, b in zip(p[:-1], p[1:]):
        n = max(1, int(math.ceil(np.hypot(*(b - a)) / step)))
        t = (np.arange(1, n + 1) / n)[:, None]
        out.append(a + (b - a) * t)
    return np.vstack(out)


class PointIndex:
    """Grid of points; `near(points)` says which of them have an indexed point within NEAR_M."""

    def __init__(self, size=NEAR_M):
        self.size = size
        self.parts = []
        self.grid = None

    def add(self, pts):
        if len(pts):
            self.parts.append(pts)
            self.grid = None

    def _build(self):
        g = defaultdict(list)
        if self.parts:
            allp = np.vstack(self.parts)
            keys = np.floor(allp / self.size).astype(int)
            for k, p in zip(map(tuple, keys), allp):
                g[k].append(p)
        self.grid = {k: np.array(v) for k, v in g.items()}

    def near(self, pts, radius=NEAR_M):
        if self.grid is None:
            self._build()
        if not self.grid or not len(pts):
            return False
        keys = np.floor(pts / self.size).astype(int)
        buckets = defaultdict(list)
        for i, k in enumerate(map(tuple, keys)):
            buckets[k].append(i)
        for (kx, ky), idx in buckets.items():
            cand = [self.grid[(kx + dx, ky + dy)] for dx in (-1, 0, 1) for dy in (-1, 0, 1) if (kx + dx, ky + dy) in self.grid]
            if not cand:
                continue
            c = np.vstack(cand)
            q = pts[idx]
            d2 = ((q[:, None, :] - c[None, :, :]) ** 2).sum(axis=2)
            if d2.min() <= radius * radius:
                return True
        return False


def mode_label(kind, frac_yes, frac_no=0.0):
    """Tag evidence by share of length -> 'bikes', 'bikes?' (partial or mixed) or None."""
    if frac_yes <= 0:
        return None
    return kind if frac_yes >= 0.9 and frac_no == 0 else kind + '?'


def mode_highlights(shares):
    """
    shares: {'bicycle': (yes, no), 'horse': (yes, no), 'dog': (yes, no)}, fractions 0..1 of the
    trail's length. Dogs are only ever claimed from a dog tag.
    """
    out = []
    for fam, kind in (('bicycle', 'bikes'), ('horse', 'horses'), ('dog', 'dogs')):
        yes, no = shares.get(fam, (0.0, 0.0))
        label = mode_label(kind, yes, no)
        if label:
            out.append(label)
        elif fam == 'dog' and no > 0:
            out.append('nodogs' if no >= 0.9 else 'nodogs?')
    return out


def mode_share(tags_by_part, lengths):
    """
    tags_by_part: one tags dict per way (or [rel_tags] for a relation-level tag), lengths in metres.
    -> {'bicycle': (yes, no), ...}. A tag on the relation itself counts for the whole route.
    """
    total = sum(lengths) or 1.0
    out = {}
    for fam, yes_set in MODE_YES.items():
        yes = sum(l for t, l in zip(tags_by_part, lengths) if t.get(fam) in yes_set) / total
        no = sum(l for t, l in zip(tags_by_part, lengths) if t.get(fam) == 'no') / total
        out[fam] = (yes, no)
    return out


def combine_highlights(features, modes):
    """Fixed order, features first. `features` is a set of FEATURES; `modes` a list from mode_highlights."""
    res = [k for k in FEATURES if k in features]
    return res + sorted(modes, key=lambda m: ORDER.index(m.rstrip('?')))


def chain_ends(node_lists):
    """
    Indices (way, 0 or -1) of end nodes used by only one way: the open ends of the trail.
    A loop has none; the caller falls back to the first way's start.
    """
    deg = defaultdict(int)
    for nodes in node_lists:
        for n in set(nodes):
            deg[n] += 1
    ends = []
    for wi, nodes in enumerate(node_lists):
        for pos in (0, -1):
            if deg[nodes[pos]] == 1:
                ends.append((wi, pos))
    return ends or [(0, 0)]


UNUSABLE_ACCESS = {'private', 'no', 'customers', 'delivery'}


def usable_parking(tags):
    """A lot hikers can use: not tagged private / no / customers-only / delivery."""
    return tags.get('access', '') not in UNUSABLE_ACCESS


class ParkingIndex:
    """Parking lots as areas: every lot is densified, so a point is the nearest spot on its outline, not its centre."""

    def __init__(self, lots=()):
        """lots: [[(lon, lat), ...]] one outline (or single point) per lot."""
        pts = [densify(lot) if len(lot) > 1 else xy(lot) for lot in lots if len(lot)]
        self.xy = np.vstack(pts) if pts else np.zeros((0, 2))

    def __len__(self):
        return len(self.xy)

    def nearest(self, lon_lat):
        """(distance in metres, [lon, lat] of the nearest lot point) or None when there are no lots."""
        if not len(self.xy):
            return None
        d = np.hypot(*(self.xy - xy([lon_lat])[0]).T)
        j = int(d.argmin())
        x, y = self.xy[j]
        return float(d[j]), [x / (M_LON * math.cos(math.radians(REF_LAT))), y / M_LAT]


def pick_trailhead(end_points, parking):
    """
    end_points: [(lon, lat)] trail ends (both ends of the stitched line); parking: ParkingIndex.
    -> ([lon, lat, 1], end_index) for the lot point nearest to any end within PARKING_M,
       else ([lon, lat, 0], 0) at the first end. The third value says whether it is a parking lot.
    The lot point is the nearest spot on the lot's outline to the end, so the app's own distance check agrees.
    """
    best = None
    for ei, e in enumerate(end_points):
        hit = parking.nearest(e)
        if hit and hit[0] <= PARKING_M and (best is None or hit[0] < best[0]):
            best = (hit[0], hit[1], ei)
    if best:
        return [round(best[1][0], 5), round(best[1][1], 5), 1], best[2]
    return [end_points[0][0], end_points[0][1], 0], 0


def branch_point(start, others, step=BRANCH_M):
    """
    Point about `step` metres from `start` along the polyline start -> others..., or the last point
    if the branch is shorter. Returns None when it is under 3 m long.
    """
    pts = [start] + list(others)
    p = xy(pts)
    left = step
    for i in range(1, len(p)):
        seg = float(np.hypot(*(p[i] - p[i - 1])))
        if seg >= left and seg > 0:
            f = left / seg
            return [round(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, 5),
                    round(pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f, 5)]
        left -= seg
    if step - left < 3:
        return None
    return [round(pts[-1][0], 5), round(pts[-1][1], 5)]
