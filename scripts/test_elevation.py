"""
Tests for scripts/elevation.py and the elevation step of scripts/build_trails.py.
No network: tiles are tiny synthetic GeoTIFFs written into a temp folder.

Run:  python -m unittest discover -s scripts -p "test_*.py"
"""
import json
import os
import sys
import tempfile
import unittest

import numpy as np
import rasterio
from rasterio.transform import from_origin

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_trails  # noqa: E402
import elevation  # noqa: E402

SAMPLE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sample.osm')


def read_json(path):
    with open(path) as f:
        return json.load(f)


def write_tile(folder, lat0, lon0, fn, size=100, nodata=None):
    """A size x size tile covering [lat0, lat0+1] x [lon0, lon0+1]; fn(row, col) gives metres."""
    arr = np.fromfunction(lambda r, c: fn(r, c), (size, size)).astype('float32')
    step = 1.0 / size
    with rasterio.open(os.path.join(folder, elevation.tile_name(lat0, lon0) + '.tif'), 'w', driver='GTiff',
                       height=size, width=size, count=1, dtype='float32', crs='EPSG:4326',
                       transform=from_origin(lon0, lat0 + 1, step, step), nodata=nodata) as ds:
        ds.write(arr, 1)


class Names(unittest.TestCase):
    def test_tile_names_match_the_bucket_layout(self):
        self.assertEqual(elevation.tile_name(47, -122), 'Copernicus_DSM_COG_30_N47_00_W122_00_DEM')
        self.assertEqual(elevation.tile_name(-5, 8), 'Copernicus_DSM_COG_30_S05_00_E008_00_DEM')

    def test_delta_roundtrip(self):
        z = [150, 169, 981, 1348, 1340]
        self.assertEqual(elevation.encode_deltas(z), [150, 19, 812, 367, -8])
        self.assertEqual(elevation.decode_deltas(elevation.encode_deltas(z)), z)


class Sampling(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)

    def tiles(self, listed):
        return elevation.DemTiles(self.dir.name, listed={elevation.tile_name(*k) for k in listed})

    def test_nearest_pixel_values_on_a_ramp(self):
        # 100 m at the west edge column, +1 m per column eastwards.
        write_tile(self.dir.name, 47, -122, lambda r, c: 100 + c)
        t = self.tiles([(47, -122)])
        # pixel size 0.01 deg; lon -121.705 is the centre of column 29 -> 129 m
        # lon -121.6975 is nearer the centre of column 30 -> 130 m
        z = elevation.sample(np.array([-121.705, -121.6975, -121.995]), np.array([47.5, 47.5, 47.5]), t)
        self.assertEqual(z.tolist(), [129, 130, 100])

    def test_northing_follows_rows(self):
        write_tile(self.dir.name, 47, -122, lambda r, c: 1000 - 10 * r)  # falls going south
        t = self.tiles([(47, -122)])
        north, south = elevation.sample(np.array([-121.5, -121.5]), np.array([47.99, 47.01]), t)
        self.assertGreater(north, south)

    def test_nodata_pixel_uses_valid_neighbours(self):
        write_tile(self.dir.name, 47, -122, lambda r, c: np.where(c < 50, -32767, 500), nodata=-32767)
        t = self.tiles([(47, -122)])
        z = elevation.sample(np.array([-121.505]), np.array([47.5]), t)  # no-data pixel: takes its valid neighbours
        self.assertEqual(z.tolist(), [500])

    def test_points_on_two_tiles(self):
        write_tile(self.dir.name, 47, -122, lambda r, c: 100 + 0 * c)
        write_tile(self.dir.name, 47, -121, lambda r, c: 900 + 0 * c)
        t = self.tiles([(47, -122), (47, -121)])
        z = elevation.sample(np.array([-121.5, -120.5]), np.array([47.5, 47.5]), t)
        self.assertEqual(z.tolist(), [100, 900])

    def test_ocean_tile_is_zero_and_counted(self):
        t = self.tiles([])
        z = elevation.sample(np.array([-130.5]), np.array([47.5]), t)
        self.assertEqual(z.tolist(), [0])
        self.assertEqual(t.sea_points, 1)

    def test_too_many_points_on_missing_tiles_fails_the_build(self):
        write_tile(self.dir.name, 47, -122, lambda r, c: 100 + 0 * c)
        t = self.tiles([(47, -122)])
        elevation.sample(np.array([-121.5] * 9 + [-130.5]), np.array([47.5] * 10), t)  # 10% on ocean
        with self.assertRaises(elevation.DemError):
            elevation.check_sea_fraction(t)

    def test_a_listed_tile_that_cannot_be_fetched_fails_loudly(self):
        t = self.tiles([(47, -122)])  # listed, but not in the cache and the network is off
        original = elevation._get
        elevation._get = lambda url, dest: (_ for _ in ()).throw(elevation.DemError('offline'))
        self.addCleanup(setattr, elevation, '_get', original)
        with self.assertRaises(elevation.DemError):
            elevation.sample(np.array([-121.5]), np.array([47.5]), t)

    def test_a_corrupt_cached_tile_fails_loudly(self):
        with open(os.path.join(self.dir.name, elevation.tile_name(47, -122) + '.tif'), 'wb') as f:
            f.write(b'not a tiff')
        t = self.tiles([(47, -122)])
        with self.assertRaises(elevation.DemError):
            elevation.sample(np.array([-121.5]), np.array([47.5]), t)


class BuildOnSample(unittest.TestCase):
    """scripts/sample.osm through build_trails.py with a synthetic tile in place of the download."""

    def test_every_way_gets_elevation(self):
        with tempfile.TemporaryDirectory() as dem, tempfile.TemporaryDirectory() as out:
            write_tile(dem, 47, -122, lambda r, c: 200 + 3 * (99 - r))  # rises to the north, 3 m per row
            with open(os.path.join(dem, 'tileList.txt'), 'w') as f:
                name = elevation.tile_name(47, -122)
                f.write(f'{name}/{name}.tif\n')
            build_trails.build(SAMPLE, out, 'sample', dem_dir=dem)
            index = read_json(os.path.join(out, 'index.json'))
            self.assertEqual(index['elevation'], 'Copernicus DEM GLO-90')
            seen = 0
            for cell in index['cells']:
                body = read_json(os.path.join(out, cell + '.json'))
                for _, g, z in (m for r in body['r'] for m in r['m']):
                    self.assertEqual(len(z), len(g) // 2)
                    self.assertTrue(all(v > 0 for v in elevation.decode_deltas(z)))
                    seen += 1
                for w in body['w']:
                    self.assertEqual(len(w['z']), len(w['g']) // 2)
                    seen += 1
            self.assertGreaterEqual(seen, 2)

    def test_build_fails_when_a_needed_tile_cannot_be_fetched(self):
        with tempfile.TemporaryDirectory() as dem, tempfile.TemporaryDirectory() as out:
            with open(os.path.join(dem, 'tileList.txt'), 'w') as f:
                name = elevation.tile_name(47, -122)
                f.write(f'{name}/{name}.tif\n')
            original = elevation._get
            elevation._get = lambda url, dest: (_ for _ in ()).throw(elevation.DemError('offline'))
            self.addCleanup(setattr, elevation, '_get', original)
            with self.assertRaises(elevation.DemError):
                build_trails.build(SAMPLE, out, 'sample', dem_dir=dem)


if __name__ == '__main__':
    unittest.main()
