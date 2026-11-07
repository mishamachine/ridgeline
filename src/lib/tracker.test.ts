import { describe, it, expect, vi } from 'vitest';
vi.mock('./store', () => ({ putActivity: async () => {} }));
import { cumulative, type LngLat } from './geo';
import { progressFromTrack } from './tracker';

const route: LngLat[] = [[-121.77, 47.43], [-121.77, 47.435], [-121.77, 47.44]]; // about 1.1 km north
const cum = cumulative(route);
const pt = (lat: number, lon = -121.77) => ({ lon, lat, alt: null, acc: 5, t: 0 });

describe('progressFromTrack (resumed hike)', () => {
  it('finds where the earlier track joined and the furthest it got', () => {
    const p = progressFromTrack([pt(47.431), pt(47.435), pt(47.4375), pt(47.436)], route, cum)!;
    expect(p.start).toBeCloseTo(111, -1);
    expect(p.max).toBeCloseTo(833, -1);
  });
  it('ignores points far from the trail, and says null when it never was on it', () => {
    expect(progressFromTrack([pt(47.438, -121.7)], route, cum)).toBeNull();
    expect(progressFromTrack([pt(47.431), pt(47.439, -121.7)], route, cum)!.max).toBeCloseTo(111, -1);
  });
});
