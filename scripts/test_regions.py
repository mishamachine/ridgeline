import json
import os
import tempfile
import unittest

import cell_format as cf
import name_index
import regions

# Same shapes the build writes: names.json rows are [id, name, lon, lat, metres].
NAMES = [['osm-r1', 'Multnomah Falls Trail', -122.11, 45.57, 2400], ['osm-w9', 'Misery Ridge Trail', -121.14, 44.37, 1510],
         ['osm-r3', 'Tom McCall Point Trail', -121.4, 45.69, 2860]]


def cell(rels=(), ways=(), s=None):
    c = {'r': {r['id']: r for r in rels}, 'w': list(ways)}   # the build's in-memory shape, absolute coordinates
    if s:
        c['s'] = s   # stored trail stats as trail-stats.mjs writes them into the finished cell: key -> [length m, ascent m, descent m]
    return c


def enc(body):
    """The finished v2 cell file: the encoded body plus its stored stats (trail-stats.mjs adds them after the encoding)."""
    out = cf.encode_cell(body)
    if body.get('s'):
        out['s'] = body['s']
    return out


class RegionConfig(unittest.TestCase):
    def test_every_region_is_complete(self):
        ids = set()
        for r in regions.load_regions():
            self.assertNotIn(r['id'], ids)
            ids.add(r['id'])
            self.assertRegex(r['geofabrik'], r'^([a-z-]+/)?[a-z0-9-]+$')   # Geofabrik ids: "us/oregon", but Canadian provinces are just "british-columbia"
            self.assertGreaterEqual(len(r['classics']), 3, r['id'])
            for c in r['classics']:
                self.assertLess(c['len_m'][0], c['len_m'][1])
                self.assertTrue(c['published_ft'] > 0 and c['source'].startswith('https://'), c['name'])   # every classic carries a published gain and where it came from
                self.assertTrue(c['published_len_mi'] > 0 and c['len_source'].startswith('https://'), c['name'])   # and a published length (one way, or the loop) with its page
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

    def test_covered_regions_are_wa_or_ca_bc_and_california_uses_the_geofabrik_state_extract(self):
        by = {r['id']: r for r in regions.load_regions()}
        self.assertLessEqual({'WA', 'OR', 'CA', 'BC'}, {r['code'] for r in regions.load_regions()})   # the app's coverage line reads these from the built index
        self.assertEqual(by['california']['geofabrik'], 'us/california')
        self.assertFalse(by['california'].get('v1'))

    def test_url_comes_from_the_geofabrik_index_by_its_real_ids(self):
        # Geofabrik's index lists ids like "us/georgia" (parent "north-america") next to "georgia" (parent "europe").
        idx = {'features': [{'properties': {'id': 'georgia', 'parent': 'europe', 'urls': {'pbf': 'EU'}}},
                            {'properties': {'id': 'us/georgia', 'parent': 'north-america', 'urls': {'pbf': 'US'}}}]}
        self.assertEqual(regions.pbf_url('us/georgia', idx), 'US')
        self.assertEqual(regions.pbf_url('georgia', idx), 'EU')
        with self.assertRaises(KeyError):
            regions.pbf_url('us/atlantis', idx)


class Report(unittest.TestCase):
    R = {'name': 'Somewhere'}
    REP = {'trails': 900, 'cells': 4, 'mb': 12.5, 'build_minutes': 7}
    ST = {'lowpoint': {'total': 200, 'below_both_ends': 3}, 'shown': {'total': 400, 'off': 8, 'flagged': 5}}

    def test_row_carries_every_per_region_figure(self):
        row = regions.report_row(self.R, self.REP, self.ST, 'PASS (900 vs 50% of 800)')
        self.assertEqual(row, '| Somewhere | 900 | 4 | 12.5 | 7 | PASS (900 vs 50% of 800) | 1.50% | 2.00% | 5 |')
        self.assertEqual(row.count('|'), regions.REPORT_HEAD.splitlines()[0].count('|'))

    def test_row_without_stats_says_n_a(self):
        self.assertIn('| n/a | n/a | n/a |', regions.report_row(self.R, self.REP, None, 'n/a'))

    def test_published_size_must_leave_room_under_1_gb(self):
        with tempfile.TemporaryDirectory() as t:
            open(os.path.join(t, 'a.json'), 'wb').write(b'x' * 1000)
            regions.cmd_size(t)   # small: passes
            old = regions.MAX_HOST_MB
            regions.MAX_HOST_MB = 0.0005
            try:
                with self.assertRaises(SystemExit):
                    regions.cmd_size(t)
            finally:
                regions.MAX_HOST_MB = old
        self.assertLess(regions.MAX_HOST_MB, 1000)

    def test_british_columbia_is_in_the_geofabrik_index_by_its_bare_id(self):
        idx = {'features': [{'properties': {'id': 'british-columbia', 'parent': 'canada', 'urls': {'pbf': 'BC'}}}]}
        self.assertEqual(regions.pbf_url(regions.region('british-columbia')['geofabrik'], idx), 'BC')


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


class Center(unittest.TestCase):
    def test_nearest_covered_cell_to_the_mean(self):
        # an L-shaped coverage: the bbox midpoint is in the empty corner, the centre must be on a covered cell
        keys = ['0_0', '1_0', '2_0', '3_0', '0_1', '0_2', '0_3']
        c = regions.cell_center(keys)
        pts = [((int(k.split('_')[0]) + 0.5) * 0.25 - 180, (int(k.split('_')[1]) + 0.5) * 0.25 - 90) for k in keys]
        self.assertIn(tuple(c), [(round(x, 4), round(y, 4)) for x, y in pts])
        self.assertIsNone(regions.cell_center([]))

    def test_centre_is_the_cell_with_the_most_trails(self):
        keys = ['0_0', '1_1', '2_2']   # the mean falls on 1_1 (the California / British Columbia bug: a covered cell with next to nothing)
        self.assertEqual(regions.cell_center(keys), [-179.625, -89.625])                                         # no counts: nearest the mean
        self.assertEqual(regions.cell_center(keys, trails={'0_0': 3, '1_1': 0, '2_2': 1}), [-179.875, -89.875])
        self.assertEqual(regions.cell_center(keys, trails={'0_0': 1, '1_1': 4, '2_2': 5}), [-179.375, -89.375])
        self.assertEqual(regions.cell_center(keys, trails={'0_0': 7, '1_1': 2, '2_2': 7}), [-179.875, -89.875])   # tie on trails: nearest the mean (equidistant, first wins)
        keys = ['0_0', '3_3', '4_4', '5_5']                                                                       # three-way tie: 3_3 is nearest the mean (index 3)
        self.assertEqual(regions.cell_center(keys, trails={'0_0': 1, '3_3': 9, '4_4': 9, '5_5': 9}), [-179.125, -89.125])

    @staticmethod
    def line(i, name, lat0, deg, tags=None):
        n = 4
        g = []
        for k in range(n):
            g += [-122.0, lat0 + deg * k / (n - 1)]
        return {'id': i, 't': {'name': name, **(tags or {})}, 'g': g, 'z': [10] * n}

    @staticmethod
    def write(t, body):
        p = os.path.join(t, '1_1.json')
        json.dump(enc(body), open(p, 'w'))
        return p

    def test_cell_trails_counts_what_home_lists(self):
        # one named route plus two long named paths = 3 trails (Home needs 3 for a row); a short path, a junk name, a route member and a repeat of a name do not add
        with tempfile.TemporaryDirectory() as t:
            line = self.line
            member = line(1, 'Alpha Ridge Trail', 47.0, 0.02)
            body = cell(rels=[rel(777, 1, [[1, member['g'], member['z']]])],
                        ways=[member, line(2, 'Beta Loop', 47.1, 0.01), line(3, 'Gamma Path', 47.2, 0.01), line(4, 'Delta Spur', 47.3, 0.005),
                              line(5, 'Trail', 47.4, 0.02), line(6, 'Beta Loop', 47.5, 0.001)])
            # Alpha (route), Beta Loop (1.1 km + a 100 m piece, stitched by name), Gamma Path (1.1 km): three trails; none has stored stats, so none qualifies
            self.assertEqual(regions.cell_trails(self.write(t, body)), (0, 3))

    def test_only_trails_with_500_ft_of_gain_count_for_the_centre(self):
        with tempfile.TemporaryDirectory() as t:
            line = self.line
            ft = lambda f: round(f / 3.28084)   # metres for a gain in feet, so the edge cases read as feet
            stats = {
                'r777': [3000, ft(800), 40],                                    # route, 800 ft: counts
                'r778': [3000, ft(499) - 1, 10],                                # route, 498 ft: one foot short... a foot and a bit
                'wBeta Loop|-122.00000,47.10000|-122.00000,47.11000': [1100, 20, ft(700)],   # named path, 700 ft down (the bigger way): counts
                'wGamma Path|-122.00000,47.20000|-122.00000,47.21000': [1100, ft(120), ft(90)],   # a fitness loop: does not count
                'wEpsilon Way|-122.00000,47.30000|-122.00000,47.31000': [600, ft(900), 0],     # steep but under 805 m stored: does not count
            }
            body = cell(rels=[rel(777, 1, [[1, line(1, 'x', 47.0, 0.02)['g'], [10] * 4]]), rel(778, 1, [[2, line(2, 'x', 47.0, 0.02)['g'], [10] * 4]])],
                        ways=[line(3, 'Beta Loop', 47.1, 0.01), line(4, 'Gamma Path', 47.2, 0.01), line(5, 'Epsilon Way', 47.3, 0.01)], s=stats)
            body['r'][777]['t']['name'] = 'Alpha Ridge Trail'
            body['r'][778]['t']['name'] = 'Bravo Hill Trail'
            self.assertEqual(regions.cell_trails(self.write(t, body)), (2, 5))
            self.assertEqual(regions.stored_gain_ft([1, 152, 0]), 499)
            self.assertEqual(regions.stored_gain_ft([1, 153, 0]), 502)

    def test_mountain_bike_trails_are_left_out(self):
        with tempfile.TemporaryDirectory() as t:
            line = self.line
            # real cell shape: the build keeps only mtb=1 on a mountain-bike trail (raw tags like mtb:scale are judged at build time, see test_mtb_build.py)
            names = {'Hiker Loop': {}, 'Flow Trail': {'mtb': '1'}, 'Shared Use': {}, 'Also Marked': {'mtb': '1'}}
            ways = [line(i + 1, n, 47.0 + i * 0.1, 0.01, tags) for i, (n, tags) in enumerate(names.items())]
            # the same name split in two ways, one of them a mountain-bike way: the app merges tags across a name, so the whole name goes
            ways += [line(20, 'Split Trail', 48.0, 0.01), line(21, 'Split Trail', 48.2, 0.01, {'mtb': '1'})]
            stats = {f"w{n}|-122.00000,{47.0 + i * 0.1:.5f}|-122.00000,{47.0 + i * 0.1 + 0.01:.5f}": [1100, 200, 10] for i, n in enumerate(names)}
            rels = [{**rel(900, 1, [[31, line(31, 'x', 49.0, 0.02)['g'], [10] * 4]]), 't': {'name': 'Bike Route', 'mtb': '1'}},
                    {**rel(901, 1, [[32, line(32, 'x', 49.1, 0.02)['g'], [10] * 4]]), 't': {'name': 'Hiking Route'}}]
            stats.update({'r900': [3000, 300, 10], 'r901': [3000, 300, 10]})
            body = cell(rels=rels, ways=ways, s=stats)
            qual, total = regions.cell_trails(self.write(t, body))
            self.assertEqual((qual, total), (3, 3))   # Hiker Loop, Shared Use and the Hiking Route; the marked ones and Split Trail are out

    def test_is_mtb_tag_fixtures(self):
        for tags, want in [({'mtb:scale': '0'}, True), ({'mtb:scale': '3', 'foot': 'yes'}, True), ({'bicycle': 'designated'}, True), ({'bicycle': 'designated', 'foot': 'no'}, True),
                           ({'bicycle': 'designated', 'foot': 'yes'}, False), ({'bicycle': 'designated', 'foot': 'designated'}, False), ({'route': 'mtb'}, True),
                           ({'route': 'hiking', 'bicycle': 'yes'}, False), ({'bicycle': 'no', 'sac_scale': 'mountain_hiking'}, False), ({'mtb': '1'}, True), ({}, False)]:
            self.assertEqual(name_index.is_mtb(tags), want, tags)

    def test_a_valid_centre_hint_is_used(self):
        keys = ['1_1', '2_2']
        c, how = regions.pick_center(keys, {'1_1': 30, '2_2': 12}, '2_2', rid='x')
        self.assertEqual((c, how), ([-179.375, -89.375], 'hint'))   # not the busiest cell: the hint wins while it holds 10 or more
        self.assertEqual(regions.pick_center(keys, {'1_1': 30, '2_2': 12}, None)[1], 'auto')

    def test_a_hint_under_the_floor_or_not_built_falls_back_with_a_warning(self):
        import io
        import contextlib
        keys = ['1_1', '2_2']
        for hint, counts in (('2_2', {'1_1': 30, '2_2': 9}), ('9_9', {'1_1': 30, '2_2': 12})):
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                c, how = regions.pick_center(keys, counts, hint, rid='x')
            self.assertEqual((c, how), ([-179.625, -89.625], 'auto'))   # the busiest cell, 1_1
            self.assertIn('::warning::x: centre hint ' + hint, buf.getvalue())

    def test_combine_uses_a_hint_and_survives_a_stale_one(self):
        with tempfile.TemporaryDirectory() as t:
            idx, v2 = CentersInBuiltIndex().build(t, {'0_0': routed(6, 10), '8_8': routed(7, 12)}, hint='0_0')
            self.assertEqual(idx['regions'][1]['center'], [-179.875, -89.875])   # hint 0_0 (10 trails) beats 8_8 (12)
        with tempfile.TemporaryDirectory() as t:
            idx, v2 = CentersInBuiltIndex().build(t, {'0_0': routed(6, 10), '8_8': routed(7, 12)}, hint='5_5')
            self.assertEqual(idx['regions'][1]['center'], [-177.875, -87.875])   # stale hint: falls back to 8_8, build still passes

    def test_a_flat_busy_cell_loses_to_a_steeper_one(self):
        # the old metric picked the cell with the most trails: 14 flat fitness loops beat 11 real hikes. Now the hikes win.
        with tempfile.TemporaryDirectory() as t:
            flat, hilly = routed(1, 14, gain_m=30), routed(2, 11, gain_m=200)
            for k, b in (('1_1', flat), ('2_2', hilly)):
                json.dump(enc(b), open(os.path.join(t, k + '.json'), 'w'))
            counts = regions.count_cells(t, ['1_1', '2_2'])
            self.assertEqual(counts, {'1_1': 0, '2_2': 11})
            self.assertEqual(regions.cell_center(['1_1', '2_2'], trails=counts), [-179.375, -89.375])

    def test_combine_needs_exactly_one_v1_region(self):
        with tempfile.TemporaryDirectory() as t:
            d = os.path.join(t, 'trails-a')
            os.makedirs(d)
            json.dump({'bbox': [0, 0, 1, 1], 'cells': []}, open(os.path.join(d, 'index.json'), 'w'))
            json.dump({'v': 1, 'e': []}, open(os.path.join(d, 'names.json'), 'w'))
            json.dump({'v': 1, 'e': []}, open(os.path.join(d, 'places.json'), 'w'))
            with self.assertRaises(SystemExit):
                regions.combine(os.path.join(t, 'out'), [d], [{'id': 'a', 'code': 'AA', 'name': 'A', 'cc': 'us'}])


class Safety(unittest.TestCase):
    def test_md5_must_match_and_a_bad_file_is_deleted(self):
        import hashlib
        with tempfile.TemporaryDirectory() as t:
            f = os.path.join(t, 'x.pbf')
            open(f, 'wb').write(b'abc')
            real = regions.http_get
            try:
                regions.http_get = lambda url, dest=None: (hashlib.md5(b'abc').hexdigest() + '  x.pbf\n').encode()
                regions.verify_md5(f, 'u')
                self.assertTrue(os.path.exists(f))
                regions.http_get = lambda url, dest=None: b'0' * 32 + b'  x.pbf\n'
                with self.assertRaises(SystemExit):
                    regions.verify_md5(f, 'u')
                self.assertFalse(os.path.exists(f))
            finally:
                regions.http_get = real

    def test_fallback_extract_must_be_under_28_days_old(self):
        from datetime import datetime, timedelta, timezone
        from email.utils import format_datetime
        cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as t:
            os.chdir(t)
            try:
                os.makedirs('extract')
                open('extract/oregon.osm.pbf', 'wb').write(b'x')
                def meta(days):
                    json.dump({'last_modified': format_datetime(datetime.now(timezone.utc) - timedelta(days=days), usegmt=True)}, open('extract/oregon.osm.pbf.json', 'w'))
                meta(10)
                regions.cmd_fallback('oregon')            # fine, with a warning
                meta(40)
                with self.assertRaises(SystemExit):
                    regions.cmd_fallback('oregon')
                os.remove('extract/oregon.osm.pbf')
                with self.assertRaises(SystemExit):
                    regions.cmd_fallback('oregon')
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
    R = {'name': 'Oregon', 'expected_trails': 1000, 'classics': [{'name': 'Eagle Creek Trail', 'len_m': [8000, 25000], 'published_ft': 3750, 'published_len_mi': 13.0}]}
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


def routed(i=1, n=10, gain_m=200):
    """A cell with n routes (relations) and one lone way; relation ids i*100 and up, way id i. 10 is the build floor for a region's centre.
    Every route has a stored gain of gain_m metres (200 m is 656 ft; the centre counts 500 ft or more)."""
    g = [-122.0, 47.0, -121.9999, 47.0001]
    return cell(rels=[rel(i * 100 + j, 1, [[i * 100 + j, g, [10, 1]]]) for j in range(n)], ways=[way(i, g)],
                s={f'r{i * 100 + j}': [1500, gain_m, 20] for j in range(n)})


class CentersInBuiltIndex(unittest.TestCase):
    """Runs on a real combine() output: every region's centre cell must hold at least 10 trails, so CI fails if a centre lands on a thin or empty cell."""

    def build(self, t, cells_b, hint=None):
        regs = [{'id': 'a', 'code': 'AA', 'name': 'A', 'cc': 'us', 'v1': True}, {'id': 'b', 'code': 'BB', 'name': 'B', 'cc': 'us', **({'center_hint': hint} if hint else {})}]
        g = [-122.0, 47.0, -121.9999, 47.0001]
        dirs = []
        for rid, cells in (('a', {'1_1': routed(5)}), ('b', cells_b)):
            d = os.path.join(t, 'trails-' + rid)
            os.makedirs(os.path.join(d, 'full'))
            for k, body in cells.items():
                json.dump(enc(body), open(os.path.join(d, k + '.json'), 'w'))
            json.dump({'bbox': [0, 0, 1, 1], 'cells': list(cells)}, open(os.path.join(d, 'index.json'), 'w'))
            json.dump({'v': 1, 'e': []}, open(os.path.join(d, 'names.json'), 'w'))
            json.dump({'v': 1, 'region': '', 'e': []}, open(os.path.join(d, 'places.json'), 'w'))
            for f in ('1_1.json', 'index.json', 'names.json'):
                json.dump({'v': 1, 'r': [], 'w': [], 'cells': []}, open(os.path.join(d, 'full', f), 'w'))
            dirs.append(d)
        out = os.path.join(t, 'out')
        return regions.combine(out, dirs, regs), os.path.join(out, 'v2')

    def test_every_centre_has_a_route(self):
        with tempfile.TemporaryDirectory() as t:
            # b: the mean (cell 4_4) is nearly empty, like California's old 240_509; the centre is the cell with the most trails, 8_8
            idx, v2 = self.build(t, {'0_0': routed(6, 10), '4_4': cell(ways=[way(9, [-122.0, 47.0, -121.9999, 47.0001])]), '8_8': routed(7, 12)})
            for r in idx['regions']:
                key = '%d_%d' % (int((r['center'][0] + 180) // 0.25), int((r['center'][1] + 90) // 0.25))
                self.assertTrue(regions.cell_trails(os.path.join(v2, key + '.json'))[0] >= regions.MIN_CENTER_TRAILS, r['id'])
            self.assertEqual(idx['regions'][1]['center'], [-177.875, -87.875])   # 8_8, 12 trails
            self.assertEqual(regions.verify_centers(v2), [])

    def test_combine_fails_when_a_centre_has_fewer_than_10_trails(self):
        with tempfile.TemporaryDirectory() as t:
            with self.assertRaises(SystemExit) as e:
                self.build(t, {'4_4': routed(9, 9)})
            self.assertIn('b: centre cell 4_4 has 9 trails with 500 ft of gain or more (minimum 10)', str(e.exception))


class Combine(unittest.TestCase):
    def test_v2_tree_and_frozen_v1_copy(self):
        regs = [{'id': 'a', 'code': 'AA', 'name': 'A', 'cc': 'us', 'v1': True}, {'id': 'b', 'code': 'BB', 'name': 'B', 'cc': 'us'}]
        g = [-122.0, 47.0, -121.9999, 47.0001]
        with tempfile.TemporaryDirectory() as t:
            def make(rid, cells, bbox, names, v1=False):
                d = os.path.join(t, 'trails-' + rid)   # CI artifact directory names
                os.makedirs(d)
                for k, body in cells.items():
                    json.dump(enc(body), open(os.path.join(d, k + '.json'), 'w'))
                json.dump({'bbox': bbox, 'cells': list(cells)}, open(os.path.join(d, 'index.json'), 'w'))
                json.dump({'v': 1, 'e': names}, open(os.path.join(d, 'names.json'), 'w'))
                json.dump({'v': 1, 'region': '', 'e': [['Park', 'a', 4700000, -12200000]]}, open(os.path.join(d, 'places.json'), 'w'))
                os.makedirs(os.path.join(d, 'full'))   # every region builds full-resolution cells; only a region marked v1 publishes them
                for f, body in (('1_1.json', {'v': 1, 'r': [], 'w': []}), ('index.json', {'v': 1, 'cells': ['1_1']}), ('names.json', {'v': 1, 'e': names})):
                    json.dump(body, open(os.path.join(d, 'full', f), 'w'))
                return d
            da = make('a', {'1_1': routed(5), '1_2': cell()}, [0, 0, 1, 1], [NAMES[0]])
            db = make('b', {'1_1': routed(6), '3_3': cell()}, [1, 1, 2, 2], [NAMES[0], NAMES[1]])
            out = os.path.join(t, 'out')
            idx = regions.combine(out, [da, db], regs)
            v2 = os.path.join(out, 'v2')
            self.assertEqual(idx['v'], 2)
            self.assertEqual(idx['cells'], ['1_1', '1_2', '3_3'])
            self.assertEqual(idx['bbox'], [0, 0, 2, 2])
            self.assertEqual([r['id'] for r in idx['regions']], ['a', 'b'])
            self.assertEqual(idx['regions'][0]['code'], 'AA')
            self.assertEqual(idx['regions'][1]['center'], [-179.625, -89.625])   # a covered cell near the middle, not a bbox midpoint
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


class LengthBar(unittest.TestCase):
    R = Stats.R
    ST = {'trails': [Stats.TRAIL], 'classics': [{'name': 'Eagle Creek Trail', 'top': Stats.ENT[1]}]}

    def test_length_within_15_percent_passes_and_is_reported(self):
        bad, lines = regions.check_region(self.R, {'trails': 900, 'cells': 4}, Stats.ENT, self.ST)   # 20,800 m = 12.92 mi against 13.0
        self.assertEqual(bad, [])
        self.assertIn('length 12.92 mi against published 13.0 mi (-0.6%)', lines[0])

    def test_length_more_than_15_percent_off_fails_unless_an_exception_is_recorded(self):
        short = {**self.R, 'classics': [{**self.R['classics'][0], 'published_len_mi': 18.0}]}   # 12.92 mi is -28% from 18
        bad, _ = regions.check_region(short, {'trails': 900, 'cells': 4}, Stats.ENT, self.ST)
        self.assertTrue(any('published 18.0 mi' in b for b in bad))
        ok = {**short, 'classics': [{**short['classics'][0], 'len_exception': 'guide includes the road approach'}]}
        bad, lines = regions.check_region(ok, {'trails': 900, 'cells': 4}, Stats.ENT, self.ST)
        self.assertEqual(bad, [])
        self.assertIn('EXCEPTION: guide includes the road approach', lines[0])

    def test_a_classic_without_a_published_length_fails(self):
        none = {**self.R, 'classics': [{k: v for k, v in self.R['classics'][0].items() if k != 'published_len_mi'}]}
        self.assertTrue(any('no published_len_mi' in b for b in regions.check_region(none, {'trails': 900, 'cells': 4}, Stats.ENT, self.ST)[0]))
