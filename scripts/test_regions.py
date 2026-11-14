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
            self.assertGreaterEqual(len(r['classics']), 3, r['id'])
            for c in r['classics']:
                self.assertLess(c['len_m'][0], c['len_m'][1])
                self.assertTrue(c['published_ft'] > 0 and c['source'].startswith('https://'), c['name'])   # every classic carries a published gain and where it came from
            self.assertTrue(r['name'] and r['cc'] and len(r['code']) == 2)

    def test_matrix_lists_every_region_and_flags_the_v1_copy(self):
        import io
        import contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            regions.cmd_matrix()
        m = json.loads(buf.getvalue())['include']
        self.assertEqual([x['id'] for x in m], [r['id'] for r in regions.load_regions()])
        self.assertEqual([x['id'] for x in m if x['v1']], ['washington'])
        self.assertIs(m[0]['v1'], True)

    def test_url_comes_from_the_geofabrik_index_by_its_real_ids(self):
        # Geofabrik's index lists ids like "us/georgia" (parent "north-america") next to "georgia" (parent "europe").
        idx = {'features': [{'properties': {'id': 'georgia', 'parent': 'europe', 'urls': {'pbf': 'EU'}}},
                            {'properties': {'id': 'us/georgia', 'parent': 'north-america', 'urls': {'pbf': 'US'}}}]}
        self.assertEqual(regions.pbf_url('us/georgia', idx), 'US')
        self.assertEqual(regions.pbf_url('georgia', idx), 'EU')
        with self.assertRaises(KeyError):
            regions.pbf_url('us/atlantis', idx)


class Download(unittest.TestCase):
    def test_user_agent_is_the_agreed_string(self):
        self.assertEqual(regions.USER_AGENT, 'ridgeline-trail-build (machinemisha@gmail.com; github.com/mishamachine/ridgeline)')

    def test_note_reports_state_and_pbf_date(self):
        import io
        import contextlib
        cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as t:
            os.chdir(t)
            try:
                os.makedirs('extract')
                json.dump({'url': 'u', 'last_modified': 'Thu, 13 Nov 2026 21:23:01 GMT', 'downloaded': '2026-11-14T05:00Z'}, open('extract/oregon.osm.pbf.json', 'w'))
                buf = io.StringIO()
                with contextlib.redirect_stdout(buf):
                    regions.cmd_note('oregon', 'cache hit', 'pbf-oregon-2026-W46')
                self.assertIn('cache hit', buf.getvalue())
                self.assertIn('Thu, 13 Nov 2026 21:23:01 GMT', buf.getvalue())
                self.assertIn('pbf-oregon-2026-W46', buf.getvalue())
            finally:
                os.chdir(cwd)


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


class Exact(unittest.TestCase):
    def test_an_exact_name_beats_a_longer_partial_match(self):
        ent = [['osm-r1', 'Dog Mountain Trails', 0, 0, 7000], ['osm-r2', 'Dog Mountain Trail', 0, 0, 6800], ['osm-r3', 'Dog Mountain Trail Loop', 0, 0, 7400]]
        hit, _ = regions.find_classic(ent, {'name': 'Dog Mountain', 'len_m': [6000, 7500]})
        self.assertEqual(hit[0], 'osm-r2')           # exact name plus ' Trail'; not the longer "Trails" or "Trail Loop"
        hit, _ = regions.find_classic(ent[:1] + ent[2:], {'name': 'Dog Mountain', 'len_m': [6000, 7500]})
        self.assertEqual(hit[0], 'osm-r3')           # no exact name: the longest in range


class Stats(unittest.TestCase):
    R = {'name': 'Oregon', 'expected_trails': 1000, 'classics': [{'name': 'Eagle Creek Trail', 'len_m': [8000, 25000], 'published_ft': 3750}]}
    ENT = [['osm-r2', 'Eagle Creek Trail #501', 0, 0, 10310], ['osm-r1', 'Eagle Creek Trail', 0, 0, 20900]]
    TRAIL = {'name': 'Eagle Creek Trail', 'key': 'r1', 'L': 20800, 'up': 25, 'down': 1095, 'loop': False}

    def test_gain_is_the_way_up_whichever_way_the_line_runs(self):
        self.assertEqual(regions.gain_ft(self.TRAIL), 3593)   # the mapped line runs downhill: 25 m up, 1,095 m down
        self.assertEqual(regions.gain_ft({**self.TRAIL, 'loop': True}), 82)

    def test_passes_with_main_trail_ranked_first_and_gain_in_range(self):
        st = {'trails': [self.TRAIL, {**self.TRAIL, 'key': 'w1', 'L': 600, 'up': 3, 'down': 3}], 'classics': [{'name': 'Eagle Creek Trail', 'top': self.ENT[1]}]}
        bad, lines = regions.check_region(self.R, {'trails': 900, 'cells': 4}, self.ENT, st)
        self.assertEqual(bad, [])
        self.assertIn('gain 3593 ft', lines[0])
        self.assertIn('ranks it first', lines[0])

    def test_fails_when_search_ranks_a_short_segment_first_or_gain_is_off(self):
        short = ['osm-w9', 'Eagle Creek Trail', 0, 0, 900]
        st = {'trails': [self.TRAIL], 'classics': [{'name': 'Eagle Creek Trail', 'top': short}]}
        self.assertTrue(any('ranks' in b for b in regions.check_region(self.R, {'trails': 900, 'cells': 4}, self.ENT, st)[0]))
        flat = {'trails': [{**self.TRAIL, 'up': 2, 'down': 3}], 'classics': [{'name': 'Eagle Creek Trail', 'top': self.ENT[1]}]}
        self.assertTrue(any('published' in b for b in regions.check_region(self.R, {'trails': 900, 'cells': 4}, self.ENT, flat)[0]))

    def test_gain_error_is_reported_and_a_wider_limit_can_be_set(self):
        st = {'trails': [{**self.TRAIL, 'up': 1124, 'down': 537}], 'classics': [{'name': 'Eagle Creek Trail', 'top': self.ENT[1]}]}   # 3,688 ft against 3,750
        bad, lines = regions.check_region(self.R, {'trails': 900, 'cells': 4}, self.ENT, st)
        self.assertEqual(bad, [])
        self.assertIn('published 3750 ft, -1.7%', lines[0])
        over = {**self.R, 'classics': [{**self.R['classics'][0], 'published_ft': 2800}]}   # +31.7%: over the default 15%
        self.assertTrue(regions.check_region(over, {'trails': 900, 'cells': 4}, self.ENT, st)[0])
        wide = {**self.R, 'classics': [{**self.R['classics'][0], 'published_ft': 2800, 'max_err_pct': 35}]}
        self.assertEqual(regions.check_region(wide, {'trails': 900, 'cells': 4}, self.ENT, st)[0], [])


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

    def test_stored_trail_stats_survive_a_border_merge(self):
        a = {**cf.encode_cell(cell()), 's': {'r7': [100, 1, 2]}}
        b = {**cf.encode_cell(cell()), 's': {'r8': [200, 3, 4]}}
        self.assertEqual(regions.merge_cell(a, b)['s'], {'r7': [100, 1, 2], 'r8': [200, 3, 4]})

    def test_versions_must_match(self):
        with self.assertRaises(AssertionError):
            regions.merge_cell({'v': 2, 'r': [], 'w': []}, {'v': 1, 'r': [], 'w': []})


class Combine(unittest.TestCase):
    def test_v2_tree_and_frozen_v1_copy(self):
        regs = [{'id': 'a', 'code': 'AA', 'name': 'A', 'cc': 'us', 'v1': True}, {'id': 'b', 'code': 'BB', 'name': 'B', 'cc': 'us'}]
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
                os.makedirs(os.path.join(d, 'full'))   # every region builds full-resolution cells; only a region marked v1 publishes them
                for f, body in (('1_1.json', {'v': 1, 'r': [], 'w': []}), ('index.json', {'v': 1, 'cells': ['1_1']}), ('names.json', {'v': 1, 'e': names})):
                    json.dump(body, open(os.path.join(d, 'full', f), 'w'))
                return d
            da = make('a', {'1_1': cell(ways=[way(5, g)]), '1_2': cell()}, [0, 0, 1, 1], [NAMES[0]])
            db = make('b', {'1_1': cell(ways=[way(6, g)]), '3_3': cell()}, [1, 1, 2, 2], [NAMES[0], NAMES[1]])
            out = os.path.join(t, 'out')
            idx = regions.combine(out, [da, db], regs)
            v2 = os.path.join(out, 'v2')
            self.assertEqual(idx['v'], 2)
            self.assertEqual(idx['cells'], ['1_1', '1_2', '3_3'])
            self.assertEqual(idx['bbox'], [0, 0, 2, 2])
            self.assertEqual([r['id'] for r in idx['regions']], ['a', 'b'])
            self.assertEqual(idx['regions'][0]['code'], 'AA')
            self.assertEqual(idx['regions'][1]['center'], [1.5, 1.5])   # the Home screen reads code, name and center from here
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
