import { describe, expect, it } from 'vitest';
import { HikeSummary, FINISHED_FRACTION, boboLine, highlightChips, hype } from './hype';

const base: HikeSummary = {
  trail: { id: 'osm-r1', name: 'Rattlesnake Ledge', highlights: ['Views', 'Lake'] },
  distanceM: 6115, climbFt: 1540, movingMs: 161 * 60000,
  startedAt: new Date(2026, 10, 7, 9, 0).getTime(), endedAt: new Date(2026, 10, 7, 12, 0).getTime(),
  highlightsHit: ['views'], completedFraction: 1, track: [],
};

describe('hype', () => {
  it('big climb leads with the climb', () => {
    const h = hype(base);
    expect(h.headline).toContain('1,540 ft');
    expect(h.headline).toContain('Rattlesnake Ledge');
    expect(h.finished).toBe(true);
  });
  it('long hike leads with the miles', () => {
    const h = hype({ ...base, climbFt: 300, distanceM: 14000 });
    expect(h.headline).toContain('8.7 miles');
  });
  it('early start gets its own line', () => {
    const h = hype({ ...base, climbFt: 300, startedAt: new Date(2026, 10, 7, 5, 30).getTime() });
    expect(h.headline).toContain('Up before the sun');
  });
  it('default is plain and uses real stats', () => {
    const h = hype({ ...base, climbFt: 300 });
    expect(h.sub).toContain('3.8 mi, 300 ft climbed, 2:41.');
  });
  it('never says summit or complete when less than 80% was walked', () => {
    for (const f of [0, 0.3, FINISHED_FRACTION - 0.01]) {
      const h = hype({ ...base, completedFraction: f });
      expect(h.finished).toBe(false);
      expect(`${h.eyebrow} ${h.headline} ${h.sub}`.toLowerCase()).not.toMatch(/summit|complete|crush|own|finish/);
      expect(h.headline).toContain('3.8 miles on Rattlesnake Ledge');
    }
  });
  it('treats exactly 80% as finished', () => {
    expect(hype({ ...base, completedFraction: FINISHED_FRACTION }).finished).toBe(true);
  });
  it('a tiny walk is still honest', () => {
    const h = hype({ ...base, completedFraction: 0.02, distanceM: 100 });
    expect(h.headline).toBe('You started. That counts.');
  });
  it('survives junk numbers', () => {
    expect(() => hype({ ...base, distanceM: NaN, climbFt: NaN, movingMs: NaN, completedFraction: NaN })).not.toThrow();
  });
});

describe('highlightChips', () => {
  it('shows only highlights that are on the trail, in its own words', () => {
    expect(highlightChips(base.trail, ['views', 'Waterfall', 'LAKE', 'lake'])).toEqual(['Views', 'Lake']);
  });
  it('shows nothing when the trail lists none', () => {
    expect(highlightChips({ id: 'x', name: 'x' }, ['Views'])).toEqual([]);
  });
});

describe('boboLine', () => {
  it('is short, with no exclamation mark', () => {
    for (const s of [base, { ...base, climbFt: 10 }, { ...base, completedFraction: 0.2 }]) {
      const l = boboLine(s);
      expect(l.split(/\s+/).length).toBeLessThanOrEqual(8);
      expect(l).not.toContain('!');
    }
    expect(boboLine(base)).toBe('Bobo says: 1,540 ft, worth it.');
  });
});
