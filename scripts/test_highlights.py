"""
Tests for scripts/highlights.py and the highlights, trailhead and junction fields of build_trails.py.
Run:  python -m unittest discover -s scripts -p "test_*.py"
"""
import os
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_trails  # noqa: E402
import cell_format  # noqa: E402
import elevation  # noqa: E402
import highlights as hl  # noqa: E402
from test_elevation import SAMPLE, read_json, write_tile  # noqa: E402


class Modes(unittest.TestCase):
    def test_mode_labels(self):
        self.assertEqual(hl.mode_highlights({'bicycle': (1.0, 0.0)}), ['bikes'])
        self.assertEqual(hl.mode_highlights({'bicycle': (0.4, 0.0)}), ['bikes?'])
        self.assertEqual(hl.mode_highlights({'horse': (0.95, 0.05)}), ['horses?'])

    def test_dogs_only_from_a_dog_tag(self):
        self.assertEqual(hl.mode_highlights({}), [])
        self.assertEqual(hl.mode_highlights({'dog': (0.0, 0.0)}), [])
        self.assertEqual(hl.mode_highlights({'dog': (1.0, 0.0)}), ['dogs'])
        self.assertEqual(hl.mode_highlights({'dog': (0.0, 1.0)}), ['nodogs'])
        self.assertEqual(hl.mode_highlights({'dog': (0.0, 0.3)}), ['nodogs?'])

    def test_share_by_length_and_accepted_values(self):
        tags = [{'bicycle': 'permissive', 'dog': 'leashed'}, {'bicycle': 'no'}, {}]
        s = hl.mode_share(tags, [100, 100, 200])
        self.assertEqual(s['bicycle'], (0.25, 0.25))
        self.assertEqual(s['dog'], (0.25, 0.0))
        self.assertEqual(hl.mode_share([{'bicycle': 'dismount'}], [10])['bicycle'], (0.0, 0.0))

    def test_order_is_stable(self):
        self.assertEqual(hl.combine_highlights({'lake', 'view'}, ['dogs', 'bikes?']), ['view', 'lake', 'bikes?', 'dogs'])


class Geometry(unittest.TestCase):
    def test_near_uses_150_m(self):
        idx = hl.PointIndex()
        idx.add(hl.xy([(-121.8, 47.4)]))
        line = hl.densify([(-121.8, 47.4009), (-121.7, 47.4009)])      # ~100 m north of the point
        far = hl.densify([(-121.8, 47.4020), (-121.7, 47.4020)])       # ~220 m
        self.assertTrue(idx.near(line))
        self.assertFalse(idx.near(far))

    def test_line_feature_is_found_between_its_vertices(self):
        idx = hl.PointIndex()
        idx.add(hl.densify([(-121.80, 47.4), (-121.70, 47.4)]))        # ~7.5 km shore with no middle vertex
        self.assertTrue(idx.near(hl.xy([(-121.75, 47.4008)])))

    def test_chain_ends(self):
        self.assertEqual(hl.chain_ends([[1, 2], [2, 3, 4]]), [(0, 0), (1, -1)])
        self.assertEqual(hl.chain_ends([[1, 2, 3], [3, 4, 1]]), [(0, 0)])  # loop: falls back to the start

    def test_trailhead_prefers_parking_within_300_m_of_an_end(self):
        ends = [(-121.8, 47.49), (-121.7, 47.51)]
        pk = hl.ParkingIndex([[(-121.8005, 47.4905)], [(-121.7, 47.5200)]])
        th, ei = hl.pick_trailhead(ends, pk)
        self.assertEqual((th[2], ei), (1, 0))
        self.assertEqual(th[:2], [-121.8005, 47.4905])
        self.assertEqual(hl.pick_trailhead(ends, hl.ParkingIndex([[(-121.5, 47.0)]])), ([-121.8, 47.49, 0], 0))
        self.assertEqual(hl.pick_trailhead(ends, hl.ParkingIndex())[0][2], 0)

    def test_parking_area_is_measured_to_its_outline_not_its_centre(self):
        # Rattlesnake Lake lot (way 53622139): centre ~350 m from the trail start, nearest edge ~270 m.
        lot = [(-121.76828, 47.43305), (-121.76740, 47.43305), (-121.76740, 47.43461), (-121.76828, 47.43461), (-121.76828, 47.43305)]
        start, ledge = (-121.77165, 47.43564), (-121.7785, 47.43604)
        centre = (-121.76784, 47.43383)
        self.assertIsNone(hl.ParkingIndex([[centre]]).nearest(start))
        th, ei = hl.pick_trailhead([start, ledge], hl.ParkingIndex([lot]))
        self.assertEqual((th[2], ei), (1, 0))
        self.assertLessEqual(hl.ParkingIndex([lot]).nearest(start)[0], hl.PARKING_M)
        self.assertTrue(-121.76828 <= th[0] <= -121.7674 and 47.43305 <= th[1] <= 47.43461)  # on the lot, not the trail

    def test_grid_lookup_matches_a_brute_force_scan(self):
        rng = np.random.default_rng(7)
        lots = [[(-121.8 + float(a), 47.4 + float(b)), (-121.8 + float(a) + 0.001, 47.4 + float(b) + 0.0005)]
                for a, b in rng.uniform(0, 0.05, (300, 2))]
        idx = hl.ParkingIndex(lots)
        for q in [(-121.8 + float(a), 47.4 + float(b)) for a, b in rng.uniform(-0.01, 0.06, (60, 2))]:
            d = np.hypot(*(idx.xy - hl.xy([q])[0]).T).min()
            got = idx.nearest(q)
            if d <= hl.PARKING_M:
                self.assertAlmostEqual(got[0], d, places=6)
            else:
                self.assertIsNone(got)

    def test_parking_at_the_far_end_counts(self):
        ends = [(-121.8, 47.49), (-121.7, 47.51)]
        th, ei = hl.pick_trailhead(ends, hl.ParkingIndex([[(-121.7003, 47.5101)]]))
        self.assertEqual((th[2], ei), (1, 1))

    def test_private_and_customer_parking_is_not_a_trailhead(self):
        for access in ('private', 'no', 'customers', 'delivery'):
            self.assertFalse(hl.usable_parking({'amenity': 'parking', 'access': access}))
        for access in ('private;customers', 'yes;private', 'Customers', ' no '):
            self.assertFalse(hl.usable_parking({'amenity': 'parking', 'access': access}), access)
        for tags in ({'amenity': 'parking'}, {'amenity': 'parking', 'access': 'yes'}, {'amenity': 'parking', 'access': 'permissive'}):
            self.assertTrue(hl.usable_parking(tags))

    def test_branch_point_follows_the_branch_and_stops_at_its_end(self):
        p = hl.branch_point((-121.8, 47.4), [(-121.8, 47.4009), (-121.8, 47.4100)])
        self.assertAlmostEqual(p[1], 47.4 + 20 / 110574, places=4)
        self.assertGreater(hl.compactness([(0, 47), (0, 47.001), (0.001, 47.001), (0.001, 47), (0, 47)]), 15)
        self.assertGreater(hl.compactness([(0, 47), (0, 47.0002), (0.1, 47.0002), (0.1, 47), (0, 47)]), 200)
        self.assertIsNone(hl.branch_point((-121.8, 47.4), [(-121.8, 47.40001)]))                # ~1 m: not a branch
        short = hl.branch_point((-121.8, 47.4), [(-121.8, 47.4001)])                    # ~11 m: kept, at its end
        self.assertEqual(short, [-121.8, 47.4001])


class BuildOnSample(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dem = tempfile.TemporaryDirectory()
        cls.out = tempfile.TemporaryDirectory()
        write_tile(cls.dem.name, 47, -122, lambda r, c: 200 + 3 * (99 - r))
        name = elevation.tile_name(47, -122)
        with open(os.path.join(cls.dem.name, 'tileList.txt'), 'w') as f:
            f.write(f'{name}/{name}.tif\n')
        build_trails.build(SAMPLE, cls.out.name, 'sample', dem_dir=cls.dem.name)
        index = read_json(os.path.join(cls.out.name, 'index.json'))
        cls.raw = [read_json(os.path.join(cls.out.name, c + '.json')) for c in index['cells']]
        cls.files = [cell_format.decode_cell(f) for f in cls.raw]  # cells are format v2; the checks below read absolute coordinates

    @classmethod
    def tearDownClass(cls):
        cls.dem.cleanup()
        cls.out.cleanup()

    def route_entries(self):
        return [r for f in self.files for r in f['r'] if r['id'] == 900]

    def test_route_highlights_and_trailhead(self):
        entries = self.route_entries()
        self.assertTrue(entries)
        for r in entries:
            # viewpoint, waterfall and lake are near; the beach is not; bicycle is on one way only; horse is on the relation
            self.assertEqual(r['h'], ['view', 'lake', 'falls', 'bikes?', 'horses'])
            self.assertEqual(r['th'], [-121.8005, 47.4905, 1])

    def test_no_dogs_without_a_tag_and_dogs_with_one(self):
        for r in self.route_entries():
            self.assertNotIn('dogs', ' '.join(r['h']))
        creek = [w for f in self.files for w in f['w'] if w['id'] == 200]
        self.assertEqual(creek[0]['h'], ['dogs'])
        self.assertEqual(creek[0]['th'][2], 0)  # no car park near it: start of the path

    def test_junctions_on_route_members(self):
        by_way = {}
        for r in self.route_entries():
            for m in r['m']:
                by_way[m[0]] = {i: b for i, b in m[3]}
        # Way 100's last vertex is node 2, where footway 402 leaves. Way 101 (same route) is not a branch.
        self.assertEqual(sorted(by_way[100]), [1])
        self.assertEqual(len(by_way[100][1]), 1)
        # Way 101: vertex 0 is node 2 (footway 402); vertex 1 is node 3 (unnamed path 400 and "Side Spur").
        self.assertEqual(sorted(by_way[101]), [0, 1])
        self.assertEqual(len(by_way[101][0]), 1)
        self.assertEqual(sorted(b[2] if len(b) > 2 else '' for b in by_way[101][1]), ['', 'Side Spur'])

    def test_branch_points_are_about_20_m_out(self):
        for r in self.route_entries():
            for m in r['m']:
                if m[0] == 101:
                    unnamed = [b for i, bs in m[3] if i == 1 for b in bs if len(b) == 2][0]
                    self.assertAlmostEqual((unnamed[1] - 47.50) * 110574, 20, delta=2)  # path 400 runs due north from node 3
                    spur = [b for i, bs in m[3] if i == 1 for b in bs if len(b) == 3][0]
                    self.assertAlmostEqual((47.50 - spur[1]) * 110574, 20, delta=2)

    def fork(self, rid):
        return [r for f in self.files for r in f['r'] if r['id'] == rid]

    def test_split_keeps_each_route_branch_with_its_routes(self):
        # Fork A (600 + 601) and Fork B (600 + 602) split at node 81, the end of way 600.
        a = {m[0]: {i: b for i, b in m[3]} for r in self.fork(902) for m in r['m'] if len(m) > 3}
        branches = a[600][1]
        self.assertEqual(sorted(b[3] for b in branches), [[902], [903]])   # both ways out, each tagged with its route
        self.assertEqual([b[3] for b in a[601][0]], [[903]])   # at its own start, 601 sees only the other route's way (600 continues its route)

    def test_water_needs_a_lake_shape(self):
        self.assertIn('lake', self.fork(902)[0]['h'])        # compact untagged pond ~110 m from the end of 601
        self.assertNotIn('lake', self.fork(903)[0]['h'])     # a long thin untagged area 90 m away is a riverbank, not a lake

    def test_relation_dog_yes_is_uncertain_when_a_way_says_no(self):
        self.assertIn('dogs?', self.fork(902)[0]['h'])

    def test_cells_are_format_v2_with_one_height_per_kept_vertex(self):
        for f in self.raw:
            self.assertEqual(f['v'], 2)
            for r in f['r']:
                for m in r['m']:
                    self.assertEqual(len(m[1]) // 2, len(m[2]))


if __name__ == '__main__':
    unittest.main()
