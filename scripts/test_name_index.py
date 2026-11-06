import unittest

import name_index as ni

# Shapes copied from build_trails.py: routes = {rel id: {'tags', 'ways'}}, geoms = {way id: [(lon, lat)]}, paths = {way id: tags}.
LEDGE = [(-121.7681, 47.4343), (-121.7700, 47.4380), (-121.7720, 47.4420)]  # ~1.1 km
SHORT = [(-121.80, 47.50), (-121.8001, 47.5001)]


class NameIndex(unittest.TestCase):
    def setUp(self):
        self.routes = {5588030: {'tags': {'name': 'Rattlesnake Ledge Trail', 'route': 'hiking'}, 'ways': [1, 2]}}
        self.geoms = {1: LEDGE, 2: LEDGE[::-1], 10: LEDGE, 11: LEDGE, 12: SHORT, 13: LEDGE}
        self.paths = {10: {'name': 'Little Si Trail'}, 11: {'name': 'Little Si Trail'},
                      12: {'name': 'Tiny Path'}, 13: {'name': 'Abandoned connector (Impassable)'}}

    def test_junk_names(self):
        for n in ['Private', 'NF-65 (abandoned)', '1263', 'Trail', 'Sporting Clays Course']:
            self.assertTrue(ni.is_junk_name(n), n)
        for n in ['Rattlesnake Ledge Trail', 'Poo Poo Point']:
            self.assertFalse(ni.is_junk_name(n), n)

    def test_entries_have_app_ids_and_start_points(self):
        rows = {r[0]: r for r in ni.build_name_index(self.routes, self.geoms, self.paths)['e']}
        self.assertIn('osm-r5588030', rows)
        self.assertEqual(rows['osm-r5588030'][1], 'Rattlesnake Ledge Trail')
        self.assertEqual(rows['osm-r5588030'][2:4], [-121.7681, 47.4343])
        self.assertIn('osm-w10', rows)               # same-name ways in one cell: one entry, lowest way id
        self.assertGreater(rows['osm-w10'][4], 1500)  # both ways counted

    def test_drops_junk_and_stubs(self):
        names = [r[1] for r in ni.build_name_index(self.routes, self.geoms, self.paths)['e']]
        self.assertNotIn('Tiny Path', names)
        self.assertNotIn('Abandoned connector (Impassable)', names)

    def test_stays_small(self):
        paths = {i: {'name': f'Long Trail Name Number {i}'} for i in range(100, 14000)}
        geoms = {i: [(-121.0 + (i % 50) * 0.01, 47.0 + (i % 40) * 0.01), (-121.0 + (i % 50) * 0.01 + 0.02, 47.0 + (i % 40) * 0.01 + 0.02)] for i in paths}
        import json
        body = ni.build_name_index({}, geoms, paths)
        self.assertLessEqual(len(json.dumps(body, separators=(',', ':'))), ni.MAX_BYTES)

    def test_fails_loudly_when_still_too_big(self):
        old = ni.MAX_BYTES
        ni.MAX_BYTES = 10
        try:
            with self.assertRaises(SystemExit):
                ni.write_name_index('/dev/null', self.routes, self.geoms, self.paths)
        finally:
            ni.MAX_BYTES = old


if __name__ == '__main__':
    unittest.main()
