import { describe, it, expect } from 'vitest';
import { trimTrack, TRIM_M } from './trim';
import { haversine } from '../geo';
import type { TrackPoint } from '../store';

// A hike due north from the trailhead, one point every 50 m (0.00045 degrees of latitude is about 50 m).
const line = (n: number, stepDeg = 0.00045): TrackPoint[] => Array.from({ length: n }, (_, i) => ({ lon: -121.8, lat: 47.4 + i * stepDeg, alt: 300 + i, acc: 5, t: 1000 * i }));
const d = (a: TrackPoint, b: TrackPoint) => haversine([a.lon, a.lat], [b.lon, b.lat]);

describe('trimTrack', () => {
  it('removes everything within 200 m (straight line) of the start and of the end', () => {
    const pts = line(41); // about 2 km, due north
    const out = trimTrack(pts)!;
    expect(out.length).toBeLessThan(pts.length);
    for (const p of out) { expect(d(pts[0], p)).toBeGreaterThanOrEqual(TRIM_M); expect(d(p, pts[pts.length - 1])).toBeGreaterThanOrEqual(TRIM_M); }
    expect(d(pts[0], out[0])).toBeLessThan(TRIM_M + 60); // and not much more than that
  });
  it('keeps the other points untouched and in order', () => {
    const pts = line(41);
    const out = trimTrack(pts)!;
    expect(out).toEqual(pts.slice(pts.indexOf(out[0]), pts.indexOf(out[out.length - 1]) + 1));
  });
  it('a loop that passes back near the start mid-hike loses those points too (straight line, not along the track)', () => {
    // Out 1 km north, 1 km east, then back to a point 100 m east of the start, then away again, finishing 1 km east of the start.
    const home = { lon: -121.8, lat: 47.4 };
    const at = (northM: number, eastM: number, t: number): TrackPoint => ({ lon: home.lon + eastM / 75_000, lat: home.lat + northM / 111_000, alt: 300, acc: 5, t });
    const pts = [at(0, 0, 0), at(500, 0, 1), at(1000, 0, 2), at(1000, 500, 3), at(1000, 1000, 4), at(500, 1000, 5), at(100, 100, 6), at(500, 500, 7), at(700, 900, 8), at(0, 1000, 9)];
    const out = trimTrack(pts)!;
    expect(out).not.toContain(pts[6]);              // the pass by the start is hidden
    expect(out).not.toContain(pts[0]);
    expect(out).not.toContain(pts[9]);
    for (const p of out) { expect(d(pts[0], p)).toBeGreaterThanOrEqual(TRIM_M); expect(d(p, pts[9])).toBeGreaterThanOrEqual(TRIM_M); }
  });
  it('uploads nothing when fewer than 2 points are left (a short hike), or with too few points', () => {
    expect(trimTrack(line(8))).toBeNull(); // about 350 m
    expect(trimTrack(line(1))).toBeNull();
    expect(trimTrack([])).toBeNull();
  });
  it('never leaks a point within 200 m of either end, even with a dense track', () => {
    const pts = line(2000, 0.00001); // a point every 1 m
    const out = trimTrack(pts)!;
    for (const p of out) { expect(d(pts[0], p)).toBeGreaterThanOrEqual(TRIM_M); expect(d(p, pts[pts.length - 1])).toBeGreaterThanOrEqual(TRIM_M); }
  });
});

describe('the privacy copy depends on the trim distance', () => {
  it('TRIM_M is at least 200 m (the copy says "minus the first and last 200 m")', () => { expect(TRIM_M).toBeGreaterThanOrEqual(200); });
});
