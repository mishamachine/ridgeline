import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cellsToTrails } from './cells';
import { highlightsOf, hasHighlight } from '../components/Chips';
import { statsLine } from '../components/TrailCard';
import { buildCollections, regionNameAt } from './home';
import { dogsStatus, inNationalPark } from './parks';
import type { Trail } from './trails';

// Real trail shapes (Little Si has an OSM dogs tag), moved to a spot inside a park to test the park rule.
const cells = JSON.parse(readFileSync(new URL('./fixtures/wa-cells.json', import.meta.url), 'utf8')) as Record<string, Parameters<typeof cellsToTrails>[0]>;
const littleSi = cells['little-si'].flatMap((f) => cellsToTrails([f])).find((t) => t.highlights?.includes('dogs'))!;
const moveTo = (t: Trail, lon: number, lat: number): Trail => {
  const [x0, y0] = t.coords[0];
  return { ...t, coords: t.coords.map(([x, y]) => [x - x0 + lon, y - y0 + lat] as [number, number]), trailhead: t.trailhead && [t.trailhead[0] - x0 + lon, t.trailhead[1] - y0 + lat] };
};
const rainier = moveTo(littleSi, -121.73, 46.80);      // Skyline Trail area, Mount Rainier National Park
const muirWoods = moveTo(littleSi, -122.58, 37.89);   // Muir Woods National Monument
const pointReyes = moveTo(littleSi, -122.95, 38.05);   // Point Reyes National Seashore
const yosemite = moveTo(littleSi, -119.55, 37.74);     // Yosemite Valley

describe('dogs and national parks', () => {
  it('shows Dogs: tagged yes for a firm tag outside a park', () => {
    expect(inNationalPark(littleSi)).toBe(false);
    expect(dogsStatus(littleSi)).toBe('yes');
    expect(highlightsOf(littleSi).map((h) => h.kind)).toContain('dogs');
  });
  it('never says Yes inside a national park: Unknown instead, and out of the Dog-friendly row', () => {
    for (const t of [rainier, yosemite, muirWoods, pointReyes]) {
      expect(inNationalPark(t)).toBe(true);
      expect(dogsStatus(t)).toBe('unknown');
      expect(hasHighlight(t, 'dogs')).toBe(false);
      const kinds = highlightsOf(t).map((h) => h.kind);
      expect(kinds).not.toContain('dogs');
      expect(kinds).toContain('dogsunknown');
    }
    expect(buildCollections([littleSi, rainier]).find((c) => c.id === 'dogs')!.trails.map((t) => t.id)).toEqual([littleSi.id]);
    expect(buildCollections([rainier]).find((c) => c.id === 'dogs')).toBeUndefined();
  });
  it('a maybe tag is Unknown, and no tag shows nothing', () => {
    expect(dogsStatus({ ...littleSi, highlights: ['dogs?'] })).toBe('unknown');
    expect(dogsStatus({ ...littleSi, highlights: undefined })).toBe('none');
  });
});

describe('distance wording', () => {
  it('says round trip on list cards', () => {
    expect(statsLine(littleSi)).toMatch(/^\d+(\.\d)? mi round trip · /);
    expect(statsLine(littleSi)).not.toMatch(/ mi( loop)? ·/);
  });
  it('names the region of a trail for suggestions, not a distance', () => {
    expect(regionNameAt(-121.75, 47.49)).toBe('Washington');
    expect(regionNameAt(-97.7, 30.3)).toBeNull();
  });
});
