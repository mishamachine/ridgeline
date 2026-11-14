import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cellsToTrails } from './cells';
import { distanceLabel, gainLabel } from '../components/HomeCard';
import { awayLabel, statsLine } from '../components/TrailCard';
import { LENGTHS, inBucket } from './home';
import { METRIC_COPY } from './metricCopy';

const cells = JSON.parse(readFileSync(new URL('./fixtures/wa-cells.json', import.meta.url), 'utf8')) as Record<string, Parameters<typeof cellsToTrails>[0]>;
const t = cells['little-si'].flatMap((f) => cellsToTrails([f])).find((x) => x.ascentM != null)!;
const trail = { ...t, loop: false, lengthM: 3000, ascentM: 354, descentM: 20 };

describe('metric labels (en-CA)', () => {
  it('same rules as imperial: round trip, rounded climb with About', () => {
    expect(distanceLabel(trail, 'metric')).toBe('6.0 km round trip');
    expect(gainLabel(trail, 'metric')).toBe('About 350 m gain');
    expect(statsLine(trail, 'metric')).toMatch(/^6\.0 km round trip · 354 m gain · ~/);
    expect(statsLine({ ...trail, ascentM: undefined, descentM: undefined } as unknown as typeof trail, 'metric')).toBe('6.0 km round trip');
  });
  it('a loop is its own length', () => expect(distanceLabel({ ...trail, loop: true }, 'metric')).toBe('3.0 km round trip'));
  it('imperial is unchanged, and is the default', () => {
    expect(distanceLabel(trail)).toBe('3.7 mi round trip');
    expect(distanceLabel(trail, 'imperial')).toBe(distanceLabel(trail));
    expect(gainLabel(trail)).toBe('About 1,150 ft gain');
    expect(statsLine(trail)).toMatch(/^3\.7 mi round trip · 1,161 ft gain/);
    expect(awayLabel(0.5)).toBe('Under 1 mi away');
    expect(awayLabel(12)).toBe('12 mi away');
  });
  it('distance away in km', () => { expect(awayLabel(0.3, 'metric')).toBe('Under 1 km away'); expect(awayLabel(10, 'metric')).toBe('16 km away'); });
  it('length buckets break at 5, 10 and 15 km, matching the chip labels', () => {
    const at = (km: number) => ({ ...trail, loop: true, lengthM: km * 1000 });
    expect(LENGTHS.map((l) => METRIC_COPY.lengthChips[l.id])).toEqual(['Under 5 km', '5–10 km', '10–15 km', '15+ km']);
    expect(inBucket(at(4.9), 'under3', 'metric')).toBe(true);
    expect(inBucket(at(5), 'under3', 'metric')).toBe(false);
    expect(inBucket(at(5), '3to6', 'metric')).toBe(true);
    expect(inBucket(at(14.9), '6to10', 'metric')).toBe(true);
    expect(inBucket(at(15), '10plus', 'metric')).toBe(true);
    expect(inBucket(at(4.8), 'under3')).toBe(true); // imperial thresholds unchanged: 4.8 km is 3.0 mi
    expect(inBucket(at(5), 'under3')).toBe(false);
  });
});

describe('coverage line reads the data', () => {
  it('lists British Columbia when the index has it', async () => {
    const { coverageLine, coverageRegions } = await import('./home');
    const idx = { v: 2, built: '', source: '', cell: 0.25, bbox: null, cells: ['232_549'], regions: [
      { id: 'washington', code: 'WA', name: 'Washington', center: [-122, 47.5] }, { id: 'british-columbia', code: 'BC', name: 'British Columbia', center: [-123.1, 49.3] }] };
    expect(coverageLine(coverageRegions(idx as never))).toBe('Trails in WA and BC. More regions coming.');
  });
});
