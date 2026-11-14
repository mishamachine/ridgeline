import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cellsToTrails } from './cells';
import { highlightsOf, hasHighlight } from '../components/Chips';
import { statsLine } from '../components/TrailCard';
import { buildCollections, regionNameAt } from './home';
import { dogsStatus, inNationalPark, isWestCoastTrail } from './parks';
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
    const dogsFar = [1, 2].map((i) => moveTo({ ...littleSi, id: `${littleSi.id}-${i}` }, -121.7 + i * 0.3, 47.5));
    expect(buildCollections([littleSi, ...dogsFar, rainier]).find((c) => c.id === 'dogs')!.trails.map((t) => t.id).sort()).toEqual([littleSi.id, ...dogsFar.map((t) => t.id)].sort());
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

describe('Canada dogs', () => {
  const inCanadianPark = (name = littleSi.name) => ({ ...moveTo(littleSi, -125.6, 49.1), name });   // Pacific Rim area, not the West Coast Trail box
  it('follows the OSM tag in a Canadian national park: no park boxes', () => {
    for (const [lon, lat] of [[-125.6, 49.1], [-117.5, 51.3], [-116.5, 51.4], [-116.0, 50.9], [-118.1, 51.0]]) {   // Pacific Rim, Glacier, Yoho, Kootenay, Revelstoke
      const t = moveTo(littleSi, lon, lat);
      expect(inNationalPark(t)).toBe(false);
      expect(dogsStatus(t)).toBe('yes');
    }
    expect(dogsStatus({ ...inCanadianPark(), highlights: ['nodogs'] })).toBe('none');
    expect(highlightsOf({ ...inCanadianPark(), highlights: ['nodogs'] }).map((h) => h.kind)).toContain('nodogs');
  });
  it('the West Coast Trail is always Dogs: Unknown, by name inside its box', () => {
    const wct = moveTo({ ...littleSi, name: 'West Coast Trail' }, -124.9, 48.7);
    expect(isWestCoastTrail(wct)).toBe(true);
    expect(dogsStatus(wct)).toBe('unknown');
    expect(dogsStatus({ ...wct, highlights: ['dogs'] })).toBe('unknown');
    expect(hasHighlight({ ...wct, highlights: ['dogs'] }, 'dogs')).toBe(false);
    expect(dogsStatus({ ...wct, highlights: undefined })).toBe('unknown');
  });
  it('a same-named trail elsewhere, or another trail in the box, is not caught', () => {
    expect(dogsStatus(moveTo({ ...littleSi, name: 'West Coast Trail' }, -122.0, 47.5))).toBe('yes');
    expect(isWestCoastTrail(moveTo({ ...littleSi, name: 'Pacific Crest Trail' }, -124.9, 48.7))).toBe(false);
  });
});

describe('US park boxes and Canada', () => {
  it('Sooke (south Vancouver Island) is outside the Olympic box: the OSM tag decides', () => {
    const sooke = moveTo(littleSi, -123.68, 48.33);
    expect(inNationalPark(sooke)).toBe(false);
    expect(dogsStatus({ ...sooke, highlights: ['dogs'] })).toBe('yes');
    // the US side is unchanged: Hurricane Ridge is inside Olympic
    expect(inNationalPark(moveTo(littleSi, -123.5, 47.97))).toBe(true);
    // the exemption stops at Haro Strait: inside the Olympic box but east of -123.25 keeps the US rules
    expect(inNationalPark(moveTo(littleSi, -123.1, 48.32))).toBe(true);
    expect(dogsStatus({ ...moveTo(littleSi, -123.1, 48.32), highlights: ['dogs'] })).toBe('unknown');
    // San Juan Island (Lime Kiln, Friday Harbor) is north of the Olympic box: no park box, OSM tag decides, as before
    for (const [lon, lat] of [[-123.15, 48.52], [-123.01, 48.53]]) expect(dogsStatus({ ...moveTo(littleSi, lon, lat), highlights: ['dogs'] })).toBe('yes');
  });
});
