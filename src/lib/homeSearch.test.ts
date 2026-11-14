import { afterEach, describe, expect, it, vi } from 'vitest';
import { onEnter, resetThrottleForTests } from './homeSearch';
import { placeQueryUrl } from './geocode';

// The shape Nominatim returned for "Stawamus Chief" (countrycodes us,ca), 14 Nov 2026.
const HITS = [
  { display_name: 'Stawamus Chief, Area D (Elaho/Garibaldi), Squamish-Lillooet Regional District, British Columbia, Canada', name: 'Stawamus Chief', lon: '-123.1543115', lat: '49.6775687', boundingbox: ['49.6767582', '49.6787056', '-123.1545231', '-123.1536494'] },
  { display_name: 'Stawamus Chief Provincial Park, Area D (Elaho/Garibaldi), Squamish-Lillooet Regional District, British Columbia, Canada', name: 'Stawamus Chief Provincial Park', lon: '-123.1338080', lat: '49.6894911', boundingbox: ['49.6631581', '49.7058364', '-123.1598261', '-123.1048299'] },
];

afterEach(() => { vi.unstubAllGlobals(); resetThrottleForTests(); });

describe('Enter on "Stawamus Chief" (no trail has that name)', () => {
  it('searches Canada as well as the US', () => expect(new URL(placeQueryUrl('Stawamus Chief')).searchParams.get('countrycodes')).toBe('us,ca'));
  it('runs one place lookup and lists the park, with no exact trail match', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => HITS }));
    vi.stubGlobal('fetch', fetchMock);
    const names = [['osm-w1', 'Third Peak Trail', -123.1503, 49.6836, 525], ['osm-w2', 'Chief Backside Trail', -123.1338, 49.6855, 1120]] as never;
    const r = await onEnter('Stawamus Chief', names, undefined, true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.kind).toBe('places');
    if (r.kind === 'places') {
      expect(r.places.map((p) => p.name)).toContain('Stawamus Chief Provincial Park');
      const park = r.places.find((p) => p.name === 'Stawamus Chief Provincial Park')!;
      expect(park.lat).toBeCloseTo(49.689, 2);
      expect(park.bbox[0]).toBeLessThan(park.lon);   // a real box around the park
    }
  });
});
