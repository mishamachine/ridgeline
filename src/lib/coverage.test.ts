import { describe, expect, it } from 'vitest';
import { byDistance, inCoverage, listNames, placeBias, regionAt, type CoverageRegion } from './coverage';

const WA: CoverageRegion = { id: 'washington', name: 'Washington', cc: 'us', bbox: [-124.75, 45.5, -116.75, 49.0] };
const OR: CoverageRegion = { id: 'oregon', name: 'Oregon', cc: 'us', bbox: [-124.75, 41.75, -116.25, 46.5] };

describe('coverage', () => {
  it('finds the region a point is in, and says so when none', () => {
    expect(regionAt([WA, OR], [-122.6, 45.0])?.id).toBe('oregon');
    expect(regionAt([WA, OR], [-121.7, 48.0])?.id).toBe('washington');
    expect(regionAt([WA, OR], [-112, 40])).toBeNull();
    expect(inCoverage([WA, OR], [-112, 40])).toBe(false);
  });
  it('rules nothing out when there is no region list', () => { expect(inCoverage([], [0, 0])).toBe(true); });
  it('lists the covered names from the data', () => {
    expect(listNames([WA])).toBe('Washington');
    expect(listNames([WA, OR])).toBe('Washington and Oregon');
    expect(listNames([WA, OR, { ...OR, name: 'Idaho' }])).toBe('Washington, Oregon and Idaho');
  });
  it('orders regions nearest first', () => { expect(byDistance([WA, OR], [-120, 42.5])[0].id).toBe('oregon'); });
  it('builds the place-search bias from the regions, none without them', () => {
    expect(placeBias([WA, OR])).toEqual({ viewbox: '-124.75,49,-116.25,41.75', countrycodes: 'us' });
    expect(placeBias([])).toEqual({});
  });
});

describe('support page attribution', () => {
  it('carries the ODbL sentence verbatim', async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync('public/support/index.html', 'utf8').replace(/<[^>]+>/g, '');
    expect(text).toContain("Ridgeline's trail data contains information from OpenStreetMap, made available under the Open Database License (ODbL). The trail database we derive from it is available under the ODbL on request: machinemisha@gmail.com.");
  });
});
