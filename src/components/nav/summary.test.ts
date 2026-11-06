import { describe, it, expect } from 'vitest';
import { buildSummary } from './summary';
import type { Trail } from '../../lib/trails';

const trail = { id: 't', name: 'Test Trail', coords: [], lengthM: 1000, loop: false, partial: false, osmUrl: '', tags: {}, highlights: ['lake', 'summit'] } as Trail;
const act = (n = 20) => ({ id: 'a', name: 'Test Trail', startedAt: 1_000_000, points: Array.from({ length: n }, (_, i) => ({ lon: -121.7 + i * 0.001, lat: 47.5, alt: null, acc: 5, t: 1_000_000 + i * 1000 })) });
const base = { trail, activity: act(), endedAt: 1_000_000 + 3_600_000, pausedMs: 600_000, total: 1000, elevation: [0, 100, 100, 50, 200], startAlong: 0 };

describe('hike summary', () => {
  it('reports the numbers the celebration screen needs', () => {
    const s = buildSummary({ ...base, maxAlong: 1000 });
    expect(s.completedFraction).toBe(1);
    expect(s.movingMs).toBe(3_000_000);
    expect(s.climbFt).toBe(Math.round(250 * 3.28084));
    expect(s.distanceM).toBeGreaterThan(100);
    expect(s.highlightsHit).toEqual(['lake', 'summit']);
    expect(s.startedAt).toBe(1_000_000);
  });
  it('does not credit a mis-snapped jump along the route', () => {
    const s = buildSummary({ ...base, activity: act(3), maxAlong: 1000 }); // walked about 150 m but "reached" 1,000 m
    expect(s.completedFraction).toBeLessThan(0.2);
    expect(s.highlightsHit).toEqual([]);
  });
  it('gives no highlights when you turned back early', () => {
    const s = buildSummary({ ...base, maxAlong: 400 });
    expect(s.completedFraction).toBeCloseTo(0.4);
    expect(s.highlightsHit).toEqual([]);
  });
  it('copes with a hike that never joined the trail', () => {
    const s = buildSummary({ ...base, startAlong: null, maxAlong: 0 });
    expect(s).toMatchObject({ completedFraction: 0, climbFt: 0, highlightsHit: [] });
  });
});
