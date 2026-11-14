import { describe, expect, it } from 'vitest';
import { DRIVE_TIME_ENABLED } from './flags';
import { SKETCH_PAD_FRAC, SKETCH_SIZE, fitRoute } from './sketch';
import type { LngLat } from './geo';

const inside = (pts: [number, number][]) => {
  const lo = SKETCH_SIZE * SKETCH_PAD_FRAC - 1e-6, hi = SKETCH_SIZE * (1 - SKETCH_PAD_FRAC) + 1e-6;
  return pts.every(([x, y]) => x >= lo && x <= hi && y >= lo && y <= hi);
};
const line = (n: number, dx: number, dy: number): LngLat[] =>
  Array.from({ length: n }, (_, i) => [-121.7 + (dx * i) / (n - 1), 47.5 + (dy * i) / (n - 1)] as LngLat);

describe('fitRoute', () => {
  it('keeps a long thin east-west route inside the padded box', () => {
    const pts = fitRoute(line(200, 0.12, 0.004));
    expect(inside(pts)).toBe(true);
    const xs = pts.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(SKETCH_SIZE * SKETCH_PAD_FRAC, 3);
  });
  it('keeps a long thin north-south route inside the padded box', () => {
    expect(inside(fitRoute(line(200, 0.003, 0.1)))).toBe(true);
  });
  it('keeps the aspect ratio (longitude scaled by cos latitude)', () => {
    const pts = fitRoute(line(50, 0.1, 0.05));
    const w = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
    const h = Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]));
    expect(w / h).toBeCloseTo((0.1 * Math.cos(47.525 * Math.PI / 180)) / 0.05, 2);
  });
  it('centres the route and handles a single point and no points', () => {
    expect(fitRoute([[-121.7, 47.5]])).toEqual([[SKETCH_SIZE / 2, SKETCH_SIZE / 2]]);
    expect(fitRoute([])).toEqual([]);
  });
});

describe('drive-time flag', () => {
  it('is off until drive time is real', () => { expect(DRIVE_TIME_ENABLED).toBe(false); });
});
