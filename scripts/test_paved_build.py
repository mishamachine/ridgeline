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
    ('Rail Trail', {'highway': 'cycleway', 'bicycle': 'designated'}),            # no foot tag: still kept, and not a mountain-bike trail
    ('Bike Only Lane', {'highway': 'cycleway', 'foot': 'no', 'bicycle': 'designated'}),
    ('Dirt Path', {'highway': 'path', 'bicycle': 'designated'}),                  # a path, not a cycleway: still mountain-bike
    ('Walk Path', {'highway': 'footway', 'sac_scale': 'hiking'}),
    (None, {'highway': 'cycleway', 'foot': 'yes'}),                              # no name: dropped
]


class PavedShared(unittest.TestCase):
    def test_rule(self):
        self.assertTrue(build_trails.is_paved_shared({'highway': 'cycleway'}))
        self.assertTrue(build_trails.is_paved_shared({'highway': 'cycleway', 'foot': 'designated'}))
        self.assertFalse(build_trails.is_paved_shared({'highway': 'cycleway', 'foot': 'no'}))
        self.assertFalse(build_trails.is_paved_shared({'highway': 'path'}))
        self.assertFalse(name_index.is_mtb({'highway': 'cycleway', 'bicycle': 'designated'}))
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
            self.assertEqual(got, {'Cedar River Trail': ('paved_shared', None, 'asphalt'), 'Rail Trail': ('paved_shared', None, None),
                                   'Dirt Path': (None, '1', None), 'Walk Path': (None, None, None)})
            for cell in read_json(os.path.join(out, 'full', 'index.json'))['cells']:
                for w in read_json(os.path.join(out, 'full', cell + '.json'))['w']:
                    self.assertNotIn('kind', w['t'], w['t']['name'])
            self.assertIn('Cedar River Trail', {e[1] for e in read_json(os.path.join(out, 'names.json'))['e']})   # search finds it


if __name__ == '__main__':
    unittest.main()
