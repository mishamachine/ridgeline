"""Named paved shared-use trails (highway=cycleway, foot not "no") are kept and marked kind=paved_shared in the v2 cells, and nowhere in the frozen v1 copy (<out>/full)."""
import os
import tempfile
import unittest

import build_trails
import elevation
import name_index
from test_elevation import read_json, write_tile

OSM = '''<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="test">
%s
</osm>
'''
# Real OpenStreetMap tag shapes seen on Cedar River Trail, Renton WA (checked on Overpass, 20 Nov 2026).
WAYS = [
    ('Cedar River Trail', {'highway': 'cycleway', 'foot': 'yes', 'bicycle': 'yes', 'surface': 'asphalt'}),
    ('Rail Trail', {'highway': 'cycleway', 'bicycle': 'designated'}),            # no foot, no surface: kept, and the normal mountain-bike rule applies (bicycle=designated without foot)
    ('Bike Only Lane', {'highway': 'cycleway', 'foot': 'no', 'bicycle': 'designated'}),
    ('Dirt Path', {'highway': 'path', 'bicycle': 'designated'}),                  # a path, not a cycleway: still mountain-bike
    ('Walk Path', {'highway': 'footway', 'sac_scale': 'hiking'}),
    (None, {'highway': 'cycleway', 'foot': 'yes'}),                              # no name: dropped
    ('Dirt Flow Cycleway', {'highway': 'cycleway', 'surface': 'dirt', 'bicycle': 'designated'}),                 # dirt, bikes only, no foot tag: a mountain-bike trail
    ('Dirt Walk Cycleway', {'highway': 'cycleway', 'surface': 'dirt', 'bicycle': 'designated', 'foot': 'yes'}),  # dirt but walkers allowed: shared
    ('Dirt Plain Cycleway', {'highway': 'cycleway', 'surface': 'ground'}),                                       # dirt, no foot, no bicycle tag: a bikes-only track
    ('Moto Trail', {'highway': 'cycleway', 'motor_vehicle': 'yes'}),                                              # bare cycleway (real Oregon shape): mountain-bike
    ('Gravel Rail Cycleway', {'highway': 'cycleway', 'surface': 'fine_gravel'}),                                  # hard surface: shared
    ('Private Foot Cycleway', {'highway': 'cycleway', 'foot': 'private'}),
    ('Sidepath Cycleway', {'highway': 'cycleway', 'foot': 'use_sidepath'}),
    ('Main Avenue', {'highway': 'cycleway', 'foot': 'yes'}),                       # street name: dropped
    ('Elm Street Bike Lane', {'highway': 'cycleway'}),
    ('Lakeside Avenue Trail', {'highway': 'cycleway', 'foot': 'yes'}),            # has a trail word: kept
]


class PavedShared(unittest.TestCase):
    def test_rule(self):
        self.assertTrue(build_trails.is_paved_shared({'highway': 'cycleway'}))
        self.assertTrue(build_trails.is_paved_shared({'highway': 'cycleway', 'foot': 'designated'}))
        self.assertFalse(build_trails.is_paved_shared({'highway': 'cycleway', 'foot': 'no'}))
        self.assertFalse(build_trails.is_paved_shared({'highway': 'path'}))
        self.assertFalse(name_index.is_mtb({'highway': 'cycleway', 'bicycle': 'designated', 'surface': 'asphalt'}))
        self.assertFalse(name_index.is_mtb({'highway': 'cycleway', 'bicycle': 'designated', 'foot': 'yes', 'surface': 'dirt'}))
        self.assertTrue(name_index.is_mtb({'highway': 'cycleway', 'bicycle': 'designated', 'surface': 'dirt'}))
        self.assertTrue(name_index.is_mtb({'highway': 'cycleway', 'bicycle': 'designated'}))   # no surface and no foot tag
        self.assertTrue(name_index.is_mtb({'highway': 'cycleway'}))                             # bare cycleway: a bikes-only track
        self.assertFalse(name_index.is_mtb({'highway': 'cycleway', 'surface': 'gravel'}))
        for n in ['Main Avenue', 'Elm Street Bike Lane', 'Cycletrack', 'Pine Boulevard', 'Burke Lane']:
            self.assertTrue(name_index.is_street_name(n), n)
        for n in ['Cedar River Trail', 'Lakeside Avenue Trail', 'Elliott Bay Greenway', 'Foothills Loop', 'Burke-Gilman Trail', 'St. Helens Trail']:
            self.assertFalse(name_index.is_street_name(n), n)
        self.assertFalse(build_trails.is_paved_shared({'highway': 'cycleway', 'foot': 'private', 'name': 'X Trail'}))
        self.assertFalse(build_trails.is_paved_shared({'highway': 'cycleway', 'foot': 'use_sidepath', 'name': 'X Trail'}))
        self.assertTrue(name_index.is_mtb({'highway': 'cycleway', 'mtb:scale': '1'}))

    def test_kept_marked_and_v1_unchanged(self):
        nodes, ways = [], []
        for i, (name, tags) in enumerate(WAYS):
            lat = 47.40 + i * 0.02
            nodes += [f'<node id="{100 + 2 * i}" lat="{lat}" lon="-121.90" version="1"/>', f'<node id="{101 + 2 * i}" lat="{lat + 0.01}" lon="-121.90" version="1"/>']
            kv = ''.join(f'<tag k="{k}" v="{v}"/>' for k, v in ({**tags, 'name': name} if name else tags).items())
            ways.append(f'<way id="{500 + i}" version="1"><nd ref="{100 + 2 * i}"/><nd ref="{101 + 2 * i}"/>{kv}</way>')
        with tempfile.TemporaryDirectory() as dem, tempfile.TemporaryDirectory() as out, tempfile.TemporaryDirectory() as src:
            write_tile(dem, 47, -122, lambda r, c: 200 + 3 * (99 - r))
            with open(os.path.join(dem, 'tileList.txt'), 'w') as f:
                name = elevation.tile_name(47, -122)
                f.write(f'{name}/{name}.tif\n')
            pbf = os.path.join(src, 'paved.osm')
            with open(pbf, 'w') as f:
                f.write(OSM % '\n'.join(nodes + ways))
            build_trails.build(pbf, out, 'paved', dem_dir=dem)
            got = {}
            for cell in read_json(os.path.join(out, 'index.json'))['cells']:
                for w in read_json(os.path.join(out, cell + '.json'))['w']:
                    got[w['t']['name']] = (w['t'].get('kind'), w['t'].get('mtb'), w['t'].get('surface'))
            self.assertEqual(got, {'Cedar River Trail': ('paved_shared', None, 'asphalt'), 'Rail Trail': (None, '1', None),
                                   'Dirt Path': (None, '1', None), 'Walk Path': (None, None, None),
                                   'Dirt Flow Cycleway': (None, '1', 'dirt'), 'Dirt Walk Cycleway': ('paved_shared', None, 'dirt'),
                                   'Dirt Plain Cycleway': (None, '1', 'ground'), 'Moto Trail': (None, '1', None), 'Gravel Rail Cycleway': ('paved_shared', None, 'fine_gravel'), 'Lakeside Avenue Trail': ('paved_shared', None, None)})
            for cell in read_json(os.path.join(out, 'full', 'index.json'))['cells']:
                for w in read_json(os.path.join(out, 'full', cell + '.json'))['w']:
                    self.assertNotIn('kind', w['t'], w['t']['name'])
            self.assertIn('Cedar River Trail', {e[1] for e in read_json(os.path.join(out, 'names.json'))['e']})   # search finds it


if __name__ == '__main__':
    unittest.main()
