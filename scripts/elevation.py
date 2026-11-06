"""
Elevation for trail geometry, sampled at build time from the Copernicus DEM GLO-90
(90 m, Cloud-Optimized GeoTIFF tiles, 1 x 1 degree, public AWS Open Data bucket
`copernicus-dem-90m`, anonymous access).

  https://registry.opendata.aws/copernicus-dem/

Licence: the Copernicus WorldDEM-90 general-public licence (free of charge, includes
distribution and adaptation; the attribution notice is in README.md and in the app).

Public API
  tile_name(lat0, lon0)           tile folder/file stem for the 1-degree tile at that corner
  DemTiles(cache_dir)             downloads (and caches) the tiles that are needed
  sample(lons, lats, tiles)       elevation (m) of the pixel under each point, as ints
  encode_deltas(values)           [z0, z1-z0, z2-z1, ...] to keep the cell JSON small
  decode_deltas(deltas)           inverse of encode_deltas

Failure policy (a flat or zero profile must never be published by accident):
  - A tile that is listed in the bucket but cannot be downloaded or read raises DemError.
  - A tile that is NOT listed is open ocean (the provider publishes no ocean tiles and says
    heights there are zero). It is sampled as 0 m and counted; the build prints the count and
    fails if more than MAX_SEA_FRACTION of all points fall there.
"""
import math
import os
import sys
import time
import urllib.error
import urllib.request

import numpy as np
import rasterio

BUCKET_URL = 'https://copernicus-dem-90m.s3.amazonaws.com'
TILE_LIST_URL = f'{BUCKET_URL}/tileList.txt'
MAX_SEA_FRACTION = 0.05
RETRIES = 4


class DemError(RuntimeError):
    pass


def tile_name(lat0, lon0):
    """Tile id for the tile whose south-west corner is (lat0, lon0), whole degrees."""
    ns = 'N' if lat0 >= 0 else 'S'
    ew = 'E' if lon0 >= 0 else 'W'
    return f'Copernicus_DSM_COG_30_{ns}{abs(lat0):02d}_00_{ew}{abs(lon0):03d}_00_DEM'


def encode_deltas(values):
    out, prev = [], 0
    for v in values:
        out.append(int(v) - prev)
        prev = int(v)
    return out


def decode_deltas(deltas):
    out, acc = [], 0
    for d in deltas:
        acc += d
        out.append(acc)
    return out


def _get(url, dest):
    """Download url to dest atomically, with retries. Raises DemError on failure."""
    last = None
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'ridgeline-trail-build'})
            with urllib.request.urlopen(req, timeout=120) as r, open(dest + '.part', 'wb') as f:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
            os.replace(dest + '.part', dest)
            return
        except (urllib.error.URLError, OSError, TimeoutError) as e:
            last = e
            time.sleep(2 ** attempt)
    raise DemError(f'could not download {url}: {last}')


class DemTiles:
    """Local cache of the DEM tiles. Only tiles that are asked for are downloaded."""

    def __init__(self, cache_dir, listed=None):
        self.cache_dir = cache_dir
        os.makedirs(cache_dir, exist_ok=True)
        self._listed = listed          # set of tile names; None = read tileList.txt from the bucket
        self._arrays = {}              # tile name -> (array, transform) or None for ocean
        self.downloaded = 0

    def listed(self):
        if self._listed is None:
            path = os.path.join(self.cache_dir, 'tileList.txt')
            if not os.path.exists(path):
                _get(TILE_LIST_URL, path)
            with open(path) as f:
                # lines look like "Copernicus_DSM_COG_30_N47_00_W122_00_DEM/Copernicus_DSM_COG_30_N47_00_W122_00_DEM.tif"
                self._listed = {ln.strip().split('/')[0] for ln in f if ln.strip()}
            if not self._listed:
                raise DemError('tileList.txt is empty')
        return self._listed

    def load(self, lat0, lon0):
        """(2D float array, affine transform) for the tile, or None when it is open ocean."""
        name = tile_name(lat0, lon0)
        if name in self._arrays:
            return self._arrays[name]
        if name not in self.listed():
            self._arrays[name] = None
            return None
        path = os.path.join(self.cache_dir, name + '.tif')
        if not os.path.exists(path):
            _get(f'{BUCKET_URL}/{name}/{name}.tif', path)
            self.downloaded += 1
        try:
            with rasterio.open(path) as ds:
                arr = ds.read(1).astype('float32')
                if ds.nodata is not None:
                    arr[arr == ds.nodata] = np.nan
                tr = ds.transform
        except Exception as e:  # corrupt cache file etc.
            os.remove(path)
            raise DemError(f'could not read {path}: {e}')
        self._arrays[name] = (arr, tr)
        return self._arrays[name]


def _nearest(arr, tr, lons, lats):
    """Value of the pixel containing each point (like the run-time API this replaced, so climb and
    difficulty stay comparable with before). A no-data pixel takes the mean of its valid 3 x 3 neighbours, else 0."""
    h, w = arr.shape
    col = np.clip(np.rint((lons - tr.c) / tr.a - 0.5).astype(int), 0, w - 1)
    row = np.clip(np.rint((lats - tr.f) / tr.e - 0.5).astype(int), 0, h - 1)
    out = arr[row, col].astype('float64')
    for i in np.flatnonzero(np.isnan(out)):
        win = arr[max(row[i] - 1, 0):row[i] + 2, max(col[i] - 1, 0):col[i] + 2]
        out[i] = np.nanmean(win) if not np.all(np.isnan(win)) else 0.0
    return out


def sample(lons, lats, tiles):
    """Elevation in whole metres (nearest 90 m pixel) at each (lon, lat). lons, lats: numpy float arrays."""
    lons = np.asarray(lons, dtype='float64')
    lats = np.asarray(lats, dtype='float64')
    out = np.zeros(len(lons))
    lat0 = np.floor(lats).astype(int)
    lon0 = np.floor(lons).astype(int)
    keys = lat0 * 1000 + (lon0 + 500)
    sea = 0
    for k in np.unique(keys):
        m = keys == k
        la, lo = int(lat0[m][0]), int(lon0[m][0])
        t = tiles.load(la, lo)
        if t is None:
            sea += int(m.sum())
            continue
        out[m] = _nearest(t[0], t[1], lons[m], lats[m])
    tiles.sea_points = getattr(tiles, 'sea_points', 0) + sea
    tiles.total_points = getattr(tiles, 'total_points', 0) + len(lons)
    return np.rint(out).astype(int)


def check_sea_fraction(tiles):
    total = getattr(tiles, 'total_points', 0)
    sea = getattr(tiles, 'sea_points', 0)
    if total and sea / total > MAX_SEA_FRACTION:
        raise DemError(f'{sea} of {total} points ({sea / total:.0%}) fall on tiles missing from the bucket; '
                       f'refusing to publish flat elevation (limit {MAX_SEA_FRACTION:.0%})')
    print(f'elevation: {total} points, {len(tiles._arrays)} tiles '
          f'({tiles.downloaded} downloaded), {sea} on ocean tiles (0 m)', file=sys.stderr)
