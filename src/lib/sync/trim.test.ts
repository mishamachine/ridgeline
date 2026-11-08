import { describe, it, expect } from 'vitest';
import { trimTrack, TRIM_M } from './trim';
import { haversine } from '../geo';
import type { TrackPoint } from '../store';

// A hike due north from the trailhead, one point every 50 m (0.00045 degrees of latitude is about 50 m).
const line = (n: number, stepDeg = 0.00045): TrackPoint[] => Array.from({ length: n }, (_, i) => ({ lon: -121.8, lat: 47.4 + i * stepDeg, alt: 300 + i, acc: 5, t: 1000 * i }));
const d = (a: TrackPoint, b: TrackPoint) => haversine([a.lon, a.lat], [b.lon, b.lat]);

describe('trimTrack', () => {
  it('removes the first and last 200 m', () => {
    const pts = line(41); // about 2 km
    const out = trimTrack(pts)!;
    expect(out.length).toBeLessThan(pts.length);
    expect(d(pts[0], out[0])).toBeGreaterThanOrEqual(TRIM_M);
    expect(d(out[out.length - 1], pts[pts.length - 1])).toBeGreaterThanOrEqual(TRIM_M);
    expect(d(pts[0], out[0])).toBeLessThan(TRIM_M + 60); // and not much more than that
  });
  it('keeps the middle points untouched and in order', () => {
    const pts = line(41);
    const out = trimTrack(pts)!;
    expect(out).toEqual(pts.slice(pts.indexOf(out[0]), pts.indexOf(out[out.length - 1]) + 1));
  });
  it('uploads nothing for a hike shorter than 400 m, or with too few points', () => {
    expect(trimTrack(line(8))).toBeNull(); // about 350 m
    expect(trimTrack(line(1))).toBeNull();
    expect(trimTrack([])).toBeNull();
  });
  it('never leaks a point within 200 m of either end, even with a dense track', () => {
    const pts = line(2000, 0.00001); // a point every 1 m
    const out = trimTrack(pts)!;
    for (const p of out) { expect(d(pts[0], p)).toBeGreaterThanOrEqual(TRIM_M - 1); expect(d(p, pts[pts.length - 1])).toBeGreaterThanOrEqual(TRIM_M - 1); }
  });
});
