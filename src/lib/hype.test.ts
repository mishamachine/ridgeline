import { describe, expect, it } from 'vitest';
import { BOBO_LINES_FINISHED, BOBO_LINES_PARTIAL, HikeSummary, FINISHED_FRACTION, boboLine, cardHeadline, highlightChips, hype, shareText } from './hype';

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
  it('is short, with no exclamation mark, for every line and hike', () => {
    for (const l of [...BOBO_LINES_FINISHED, ...BOBO_LINES_PARTIAL]) {
      expect(l.split(/\s+/).length).toBeLessThanOrEqual(8);
      expect(l).not.toContain('!');
    }
    for (let d = 0; d < 12; d++) for (const s of [base, { ...base, climbFt: 10 }, { ...base, completedFraction: 0.2 }]) {
      const l = boboLine({ ...s, startedAt: base.startedAt + d * 86400000 });
      expect(l.split(/\s+/).length).toBeLessThanOrEqual(8);
      expect(l).not.toContain('!');
    }
  });
  it('rotates between hikes and is honest for partial ones', () => {
    const lines = new Set(Array.from({ length: 8 }, (_, d) => boboLine({ ...base, climbFt: 10, startedAt: d * 86400000 })));
    expect(lines.size).toBeGreaterThan(2);
    for (let d = 0; d < 8; d++) expect(BOBO_LINES_PARTIAL).toContain(boboLine({ ...base, completedFraction: 0.3, startedAt: d * 86400000 }));
  });
});

describe('cardHeadline and shareText', () => {
  it('only crushes a finished hike', () => {
    expect(cardHeadline(base)).toBe('I crushed Rattlesnake Ledge.');
    expect(cardHeadline({ ...base, completedFraction: 0.5 })).toBe('I hiked 3.8 mi on Rattlesnake Ledge.');
    expect(shareText({ ...base, completedFraction: 0.5 })).toMatch(/^I hiked 3\.8 mi on Rattlesnake Ledge\./);
    expect(shareText(base)).toContain('I just hiked Rattlesnake Ledge: 3.8 mi, 1,540 ft climbed.');
  });
});
