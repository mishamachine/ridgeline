import unittest

import numpy as np

import cell_format as cf


class Simplify(unittest.TestCase):
    def test_keeps_ends_and_protected_and_drops_straight_points(self):
        p = np.array([[0, 0], [10, 0.5], [20, 0], [30, 0], [40, 20], [50, 0]], dtype=float)
        kept = cf.simplify(p, [3])
        self.assertEqual(kept[0], 0)
        self.assertEqual(kept[-1], 5)
        self.assertIn(3, kept)          # protected junction vertex
        self.assertIn(4, kept)          # a real corner
        self.assertNotIn(1, kept)       # 0.5 m wiggle is dropped

    def test_deviation_is_within_tolerance(self):
        t = np.linspace(0, 6, 200)
        p = np.column_stack([t * 30, np.sin(t) * 40])
        kept = cf.simplify(p, [])
        k = p[kept]
        for q in p:
            d = min(_dist(q, k[i], k[i + 1]) for i in range(len(k) - 1))
            self.assertLessEqual(d, cf.DP_TOLERANCE_M + 1e-6)


def _dist(q, a, b):
    ab = b - a
    t = max(0, min(1, float((q - a) @ ab) / float(ab @ ab)))
    return float(np.hypot(*(q - (a + t * ab))))


class ZTurns(unittest.TestCase):
    def hump(self):
        # a dead-straight line over a 30 m hump: a flat simplification would drop every vertex between the ends
        n = 21
        p = np.column_stack([np.arange(n) * 10.0, np.zeros(n)])
        z = [30 - abs(i - 10) * 3 for i in range(n)]
        return p, z

    def test_a_straight_line_over_a_hump_keeps_the_peak(self):
        p, z = self.hump()
        self.assertEqual(cf.simplify(p, []), [0, 20])                 # the old behaviour: the hump is gone
        kept = cf.simplify(p, cf.z_turns(z))
        self.assertIn(10, kept)
        self.assertEqual(max(z[i] for i in kept), 30)

    def test_turns_ignore_small_wiggles(self):
        self.assertEqual(cf.z_turns([0, 1, 0, 1, 0, 1, 0]), [])        # 1 m wiggles are noise
        self.assertEqual(cf.z_turns([0, 5, 10, 6, 0, 8]), [2, 4])
        self.assertEqual(cf.z_turns([0, 5, 10]), [])                   # no turn in a plain climb


class RoundTrip(unittest.TestCase):
    def test_encode_decode(self):
        g = [-121.78123, 47.49001, -121.78, 47.4905, -121.7791, 47.4903]
        cell = {'r': {7: {'id': 7, 't': {'name': 'R', 'route': 'hiking', 'ref': 'X', 'surface': 'dirt'}, 'n': 1,
                          'm': [[11, g, [300, 2, -1], [[1, [[-121.7801, 47.4906], [-121.7799, 47.4900, 'Side', [9]]]]]]],
                          'h': ['view'], 'th': [-121.7813, 47.4899, 1]}},
                'w': [{'id': 5, 't': {'name': 'W', 'ref': 'Y', 'highway': 'path'}, 'g': g, 'z': [10, 1, 1], 'th': [-121.78, 47.49, 0]}]}
        body = cf.encode_cell(cell)
        self.assertEqual(body['v'], 2)
        self.assertEqual(body['r'][0]['t'], {'name': 'R', 'ref': 'X', 'surface': 'dirt'})  # route dropped, relation ref kept
        self.assertEqual(body['w'][0]['t'], {'name': 'W'})                                  # way ref dropped
        self.assertEqual(body['w'][0]['g'][:2], [-12178123, 4749001])                      # first point absolute
        back = cf.decode_cell(body)
        for a, b in zip(back['r'][0]['m'][0][1], g):
            self.assertAlmostEqual(a, b, places=5)
        self.assertEqual(back['r'][0]['th'], [-121.7813, 47.4899, 1])
        self.assertEqual(back['r'][0]['m'][0][3][0][1][1], [-121.7799, 47.49, 'Side', [9]])
        self.assertEqual(back['w'][0]['th'], [-121.78, 47.49, 0])


if __name__ == '__main__':
    unittest.main()
