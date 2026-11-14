import json
import os
import tempfile
import unittest

import cell_format as cf
import regions

# Same shapes the build writes: names.json rows are [id, name, lon, lat, metres].
NAMES = [['osm-r1', 'Multnomah Falls Trail', -122.11, 45.57, 2400], ['osm-w9', 'Misery Ridge Trail', -121.14, 44.37, 1510],
         ['osm-r3', 'Tom McCall Point Trail', -121.4, 45.69, 2860]]


def cell(rels=(), ways=()):
    return {'r': {r['id']: r for r in rels}, 'w': list(ways)}   # the build's in-memory shape, absolute coordinates


class RegionConfig(unittest.TestCase):
    def test_every_region_is_complete(self):
        ids = set()
        for r in regions.load_regions():
            self.assertNotIn(r['id'], ids)
            ids.add(r['id'])
            self.assertRegex(r['geofabrik'], r'^[a-z-]+/[a-z0-9-]+$')
            self.assertEqual(len(r['classics']), 3, r['id'])
            for c in r['classics']:
                self.assertLess(c['len_m'][0], c['len_m'][1])
            self.assertTrue(r['name'] and r['cc'])

    def test_matrix_lists_every_region_and_flags_the_v1_copy(self):
        import io
        import contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            regions.cmd_matrix()
        m = json.loads(buf.getvalue())['include']
        self.assertEqual([x['id'] for x in m], [r['id'] for r in regions.load_regions()])
        self.assertEqual([x['id'] for x in m if x['v1']], ['washington'])

    def test_url_comes_from_the_geofabrik_index_by_its_real_ids(self):
        # Geofabrik's index lists ids like "us/georgia" (parent "north-america") next to "georgia" (parent "europe").
        idx = {'features': [{'properties': {'id': 'georgia', 'parent': 'europe', 'urls': {'pbf': 'EU'}}},
                            {'properties': {'id': 'us/georgia', 'parent': 'north-america', 'urls': {'pbf': 'US'}}}]}
        self.assertEqual(regions.pbf_url('us/georgia', idx), 'US')
        self.assertEqual(regions.pbf_url('georgia', idx), 'EU')
        with self.assertRaises(KeyError):
            regions.pbf_url('us/atlantis', idx)


class Checks(unittest.TestCase):
    R = {'name': 'Oregon', 'expected_trails': 1000, 'classics': [
        {'name': 'Multnomah Falls', 'len_m': [1000, 4000]}, {'name': 'Misery Ridge', 'len_m': [1000, 2000]}, {'name': 'Tom McCall', 'len_m': [2000, 3500]}]}

    def test_classics_are_found_by_name_with_a_plausible_length(self):
        bad, lines = regions.check_region(self.R, {'trails': 600, 'cells': 5}, NAMES)
        self.assertEqual(bad, [])
        self.assertIn('Misery Ridge Trail', lines[1])
        self.assertIn('1510 m', lines[1])

    def test_missing_or_implausible_classic_fails(self):
        bad, _ = regions.check_region(self.R, {'trails': 600, 'cells': 5}, NAMES[:1])
        self.assertEqual(len(bad), 2)
        long = [NAMES[0], ['osm-w9', 'Misery Ridge Trail', 0, 0, 90000], NAMES[2]]
        bad, _ = regions.check_region(self.R, {'trails': 600, 'cells': 5}, long)
        self.assertTrue(any('not within' in b for b in bad))

    def test_collapse_tripwire_under_half_of_the_baseline(self):
        self.assertEqual(regions.check_region(self.R, {'trails': 500, 'cells': 5}, NAMES)[0], [])
        bad, _ = regions.check_region(self.R, {'trails': 499, 'cells': 5}, NAMES)
        self.assertTrue(any('collapse tripwire' in b for b in bad))
        self.assertTrue(regions.check_region(self.R, {'trails': 600, 'cells': 0}, NAMES)[0])


def way(i, g):
    return {'id': i, 't': {'name': 'W%d' % i}, 'g': g, 'z': [10] + [1] * (len(g) // 2 - 1)}


def rel(i, n, members):
    return {'id': i, 't': {'name': 'R%d' % i}, 'n': n, 'm': members}


class Merge(unittest.TestCase):
    def test_merge_of_two_encoded_cells_decodes_back(self):
        g1, g2 = [-122.0, 47.0, -121.9999, 47.0001], [-121.9999, 47.0001, -121.9998, 47.0002]
        a = cf.encode_cell(cell([rel(7, 2, [[1, g1, [10, 1]]])], [way(5, g1)]))
        b = cf.encode_cell(cell([rel(7, 3, [[1, g1, [10, 1]], [2, g2, [11, 1]]])], [way(6, g2), way(5, [9.0, 9.0, 9.1, 9.1])]))
        m = regions.merge_cell(a, b)
        self.assertEqual(m['v'], 2)
        d = cf.decode_cell(m)
        self.assertEqual([x[0] for x in d['r'][0]['m']], [1, 2])
        self.assertEqual(d['r'][0]['n'], 3)
        self.assertEqual(d['r'][0]['m'][1][1], g2)          # decodes to the right coordinates, not raw deltas
        self.assertEqual(sorted(w['id'] for w in d['w']), [5, 6])

    def test_versions_must_match(self):
        with self.assertRaises(AssertionError):
            regions.merge_cell({'v': 2, 'r': [], 'w': []}, {'v': 1, 'r': [], 'w': []})


class Combine(unittest.TestCase):
    def test_v2_tree_and_frozen_v1_copy(self):
        regs = [{'id': 'a', 'name': 'A', 'cc': 'us'}, {'id': 'b', 'name': 'B', 'cc': 'us'}]
        g = [-122.0, 47.0, -121.9999, 47.0001]
        with tempfile.TemporaryDirectory() as t:
            def make(rid, cells, bbox, names, v1=False):
                d = os.path.join(t, 'trails-' + rid)   # CI artifact directory names
                os.makedirs(d)
                for k, body in cells.items():
                    json.dump(cf.encode_cell(body), open(os.path.join(d, k + '.json'), 'w'))
                json.dump({'bbox': bbox, 'cells': list(cells)}, open(os.path.join(d, 'index.json'), 'w'))
                json.dump({'v': 1, 'e': names}, open(os.path.join(d, 'names.json'), 'w'))
                json.dump({'v': 1, 'region': '', 'e': [['Park', 'a', 4700000, -12200000]]}, open(os.path.join(d, 'places.json'), 'w'))
                if v1:
                    os.makedirs(os.path.join(d, 'v1'))
                    for f, body in (('1_1.json', {'v': 1, 'r': [], 'w': []}), ('index.json', {'v': 1, 'cells': ['1_1']}), ('names.json', {'v': 1, 'e': names})):
                        json.dump(body, open(os.path.join(d, 'v1', f), 'w'))
                return d
            da = make('a', {'1_1': cell(ways=[way(5, g)]), '1_2': cell()}, [0, 0, 1, 1], [NAMES[0]], v1=True)
            db = make('b', {'1_1': cell(ways=[way(6, g)]), '3_3': cell()}, [1, 1, 2, 2], [NAMES[0], NAMES[1]])
            out = os.path.join(t, 'out')
            idx = regions.combine(out, [da, db], regs)
            v2 = os.path.join(out, 'v2')
            self.assertEqual(idx['v'], 2)
            self.assertEqual(idx['cells'], ['1_1', '1_2', '3_3'])
            self.assertEqual(idx['bbox'], [0, 0, 2, 2])
            self.assertEqual([r['id'] for r in idx['regions']], ['a', 'b'])
            self.assertEqual(idx['regions'][1]['names'], 'names/b.json')
            self.assertEqual(idx['regions'][0]['places'], 'places/a.json')
            m = json.load(open(os.path.join(v2, '1_1.json')))
            self.assertEqual(m['v'], 2)
            self.assertEqual(sorted(w['id'] for w in cf.decode_cell(m)['w']), [5, 6])
            self.assertEqual(json.load(open(os.path.join(v2, 'places', 'b.json')))['region'], 'b')
            self.assertEqual(json.load(open(os.path.join(v2, 'places', 'manifest.json')))['shards'][1]['file'], 'places/b.json')
            self.assertEqual(json.load(open(os.path.join(v2, 'names', 'manifest.json')))['shards'][0]['file'], 'names/a.json')
            self.assertFalse(os.path.exists(os.path.join(v2, 'names.json')))   # no combined names in v2
            # the frozen old copy sits at the root: only region a's v1 files, no v2 content mixed in
            self.assertEqual(sorted(f for f in os.listdir(out) if f.endswith('.json')), ['1_1.json', 'index.json', 'names.json'])
            self.assertEqual(json.load(open(os.path.join(out, '1_1.json')))['v'], 1)


if __name__ == '__main__':
    unittest.main()
