"""Mountain-bike trails are marked mtb=1 in the v2 cells by build_trails.py, and nowhere in the frozen v1 copy (<out>/full)."""
import os
import tempfile
import unittest

import build_trails
import elevation
from test_elevation import read_json, write_tile

# Real tag shapes: the way ids and names are invented, the tag keys and values are the ones OpenStreetMap uses.
OSM = '''<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="test">
%s
</osm>
'''
WAYS = [('Hiker Path', {'highway': 'path', 'sac_scale': 'hiking'}), ('Flow Trail', {'highway': 'path', 'mtb:scale': '2'}),
        ('Bike Only Path', {'highway': 'path', 'bicycle': 'designated'}), ('Shared Path', {'highway': 'path', 'bicycle': 'designated', 'foot': 'yes'}),
        ('Hikers Only Path', {'highway': 'path', 'bicycle': 'no', 'sac_scale': 'mountain_hiking'})]


class MtbMarking(unittest.TestCase):
    def test_marked_in_v2_and_not_in_the_frozen_copy(self):
        nodes, ways = [], []
        for i, (name, tags) in enumerate(WAYS):
            lat = 47.40 + i * 0.02
            nodes += [f'<node id="{100 + 2 * i}" lat="{lat}" lon="-121.90" version="1"/>', f'<node id="{101 + 2 * i}" lat="{lat + 0.01}" lon="-121.90" version="1"/>']
            kv = ''.join(f'<tag k="{k}" v="{v}"/>' for k, v in {**tags, 'name': name}.items())
            ways.append(f'<way id="{500 + i}" version="1"><nd ref="{100 + 2 * i}"/><nd ref="{101 + 2 * i}"/>{kv}</way>')
        with tempfile.TemporaryDirectory() as dem, tempfile.TemporaryDirectory() as out, tempfile.TemporaryDirectory() as src:
            write_tile(dem, 47, -122, lambda r, c: 200 + 3 * (99 - r))
            with open(os.path.join(dem, 'tileList.txt'), 'w') as f:
                name = elevation.tile_name(47, -122)
                f.write(f'{name}/{name}.tif\n')
            pbf = os.path.join(src, 'mtb.osm')
            with open(pbf, 'w') as f:
                f.write(OSM % '\n'.join(nodes + ways))
            build_trails.build(pbf, out, 'mtb', dem_dir=dem)
            marked = {}
            for cell in read_json(os.path.join(out, 'index.json'))['cells']:
                for w in read_json(os.path.join(out, cell + '.json'))['w']:
                    marked[w['t']['name']] = w['t'].get('mtb')
            self.assertEqual(marked, {'Hiker Path': None, 'Flow Trail': '1', 'Bike Only Path': '1', 'Shared Path': None, 'Hikers Only Path': None})
            for cell in read_json(os.path.join(out, 'full', 'index.json'))['cells']:
                for w in read_json(os.path.join(out, 'full', cell + '.json'))['w']:
                    self.assertNotIn('mtb', w['t'], w['t']['name'])   # the frozen v1 copy is built exactly as before


if __name__ == '__main__':
    unittest.main()
