import json
import os
import tempfile
import unittest

import regions

# Same shapes the build writes: names.json rows are [id, name, lon, lat, metres]; cells are {'v', 'r', 'w'}.
NAMES = [['osm-r1', 'Multnomah Falls Trail', -122.11, 45.57, 2400], ['osm-w9', 'Misery Ridge Trail', -121.14, 44.37, 3700],
         ['osm-r3', 'Tom McCall Point Trail', -121.4, 45.69, 5200]]


def cell(rels=(), ways=()):
    return {'v': 2, 'r': list(rels), 'w': list(ways)}


class RegionConfig(unittest.TestCase):
    def test_every_region_is_complete(self):
        ids = set()
        for r in regions.load_regions():
            self.assertNotIn(r['id'], ids)
            ids.add(r['id'])
            self.assertRegex(r['geofabrik'], r'^[a-z-]+/[a-z0-9-]+$')
            self.assertEqual(len(r['classics']), 3, r['id'])
            self.assertTrue(r['name'] and r['cc'])

    def test_matrix_lists_every_region(self):
        self.assertEqual([r['id'] for r in regions.load_regions()], [r['id'] for r in json.loads(json.dumps({'x': regions.load_regions()}))['x']])

    def test_url_comes_from_the_geofabrik_index(self):
        idx = {'features': [{'properties': {'id': 'georgia', 'parent': 'europe', 'urls': {'pbf': 'EU'}}},
                            {'properties': {'id': 'georgia', 'parent': 'us', 'urls': {'pbf': 'US'}}}]}
        self.assertEqual(regions.pbf_url('us/georgia', idx), 'US')
        with self.assertRaises(KeyError):
            regions.pbf_url('us/atlantis', idx)


class Checks(unittest.TestCase):
    R = {'name': 'Oregon', 'expected_trails': 1000, 'classics': ['Multnomah Falls', 'Misery Ridge', 'Tom McCall']}

    def test_classics_are_found_by_name(self):
        self.assertEqual(regions.classics_missing(NAMES, self.R['classics']), [])
        self.assertEqual(regions.classics_missing(NAMES[:1], self.R['classics']), ['Misery Ridge', 'Tom McCall'])

    def test_under_half_of_expected_fails(self):
        ok = {'trails': 600, 'cells': 5}
        self.assertEqual(regions.check_region(self.R, ok, NAMES), [])
        self.assertTrue(regions.check_region(self.R, {'trails': 499, 'cells': 5}, NAMES))
        self.assertTrue(regions.check_region(self.R, {'trails': 600, 'cells': 0}, NAMES))


class Combine(unittest.TestCase):
    def test_merges_regions_and_border_cells(self):
        regs = [{'id': 'a', 'name': 'A', 'cc': 'us'}, {'id': 'b', 'name': 'B', 'cc': 'us'}]
        with tempfile.TemporaryDirectory() as t:
            def make(rid, cells, bbox, names):
                d = os.path.join(t, rid)
                os.makedirs(d)
                for k, body in cells.items():
                    json.dump(body, open(os.path.join(d, k + '.json'), 'w'))
                json.dump({'bbox': bbox, 'cells': list(cells)}, open(os.path.join(d, 'index.json'), 'w'))
                json.dump({'v': 1, 'e': names}, open(os.path.join(d, 'names.json'), 'w'))
                json.dump({'v': 1, 'region': '', 'e': [['Park', 'a', 4700000, -12200000]]}, open(os.path.join(d, 'places.json'), 'w'))
                return d
            da = make('a', {'1_1': cell(rels=[{'id': 7, 'n': 2, 'm': [[1, [0, 0], [0]]]}], ways=[{'id': 5, 'g': [0, 0, 1, 1]}]), '1_2': cell()},
                      [0, 0, 1, 1], [NAMES[0]])
            db = make('b', {'1_1': cell(rels=[{'id': 7, 'n': 3, 'm': [[1, [0, 0], [0]], [2, [1, 1], [0]]]}], ways=[{'id': 6, 'g': [1, 1, 2, 2]}, {'id': 5, 'g': [9, 9]}]), '3_3': cell()},
                      [1, 1, 2, 2], [NAMES[0], NAMES[1]])
            out = os.path.join(t, 'out')
            idx = regions.combine(out, [da, db], regs)
            self.assertEqual(idx['cells'], ['1_1', '1_2', '3_3'])
            self.assertEqual(idx['bbox'], [0, 0, 2, 2])
            self.assertEqual([r['id'] for r in idx['regions']], ['a', 'b'])
            self.assertEqual(idx['regions'][1]['names'], 'names/b.json')
            m = json.load(open(os.path.join(out, '1_1.json')))
            self.assertEqual(m['v'], 2)  # a merged border cell keeps the format version (it was written as 1 once, which broke decoding)
            self.assertEqual(len(m['r']), 1)
            self.assertEqual([x[0] for x in m['r'][0]['m']], [1, 2])
            self.assertEqual(m['r'][0]['n'], 3)
            self.assertEqual(sorted(w['id'] for w in m['w']), [5, 6])
            self.assertEqual(len(json.load(open(os.path.join(out, 'names.json')))['e']), 2)  # legacy combined, deduped by id
            self.assertTrue(os.path.exists(os.path.join(out, 'names', 'a.json')))
            self.assertEqual(json.load(open(os.path.join(out, 'places', 'b.json')))['region'], 'b')
            self.assertEqual(idx['regions'][0]['places'], 'places/a.json')
            self.assertEqual(json.load(open(os.path.join(out, 'places', 'manifest.json')))['shards'][1]['file'], 'places/b.json')


if __name__ == '__main__':
    unittest.main()
