import unittest

import place_index as pi


class Kinds(unittest.TestCase):
    def test_kinds(self):
        self.assertEqual(pi.kind_of({'place': 'town'}), 't')
        self.assertEqual(pi.kind_of({'place': 'hamlet'}), 'h')
        self.assertEqual(pi.kind_of({'natural': 'peak'}), 'p')
        self.assertEqual(pi.kind_of({'highway': 'trailhead'}), 'r')
        self.assertIsNone(pi.kind_of({'place': 'suburb'}))
        self.assertIsNone(pi.kind_of({'highway': 'path'}))

    def test_areas(self):
        self.assertTrue(pi.is_area({'boundary': 'protected_area'}))
        self.assertTrue(pi.is_area({'leisure': 'nature_reserve'}))
        self.assertTrue(pi.is_area({'leisure': 'park'}))
        self.assertFalse(pi.is_area({'leisure': 'pitch'}))


class Records(unittest.TestCase):
    def test_integers_sorted_and_deduped(self):
        raw = [('Mount Hood', 'p', 45.37352, -121.69586), ('Silver Falls State Park', 'a', 44.85, -122.65),
               ('Silver Falls State Park', 'a', 44.8503, -122.6502),   # same park mapped twice, 30 m apart
               ('Silver Falls State Park', 'a', 45.5, -122.65),        # a different park of that name
               ('x', 't', 45, -122), ('Bend', 'c', 44.0582, -121.3153)]
        rows = pi.build_records(raw)
        self.assertEqual([r[0] for r in rows], ['Bend', 'Mount Hood', 'Silver Falls State Park', 'Silver Falls State Park'])
        self.assertEqual(rows[0], ['Bend', 'c', 4405820, -12131530])
        self.assertTrue(all(isinstance(v, int) for r in rows for v in r[2:]))


if __name__ == '__main__':
    unittest.main()
