import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cellsToTrails, type CellIndex } from './cells';
import {
  COLLECTIONS, NO_FILTERS, applyFilters, buildCollections, coverageLine, coverageRegions, defaultRegion, greeting, inBucket, isCovered, nearestRegion,
  type Region,
} from './home';
import { level } from './plan';
import type { Trail } from './trails';

// Real trails, stitched by the app's own parser from slices of the hosted cell files (see gain.test.ts).
const cells = JSON.parse(readFileSync(new URL('./fixtures/wa-cells.json', import.meta.url), 'utf8')) as Record<string, Parameters<typeof cellsToTrails>[0]>;
const all = Object.values(cells).flatMap((files) => files.flatMap((f) => cellsToTrails([f])));
const by = (name: string) => all.find((t) => t.name === name)!;
const ledge = by('Rattlesnake Ledge Trail'), chirico = by('Chirico Trail'), si = by('Mount Si Trail'), annette = by('Annette Lake Trail');

// The index shape build_trails.py writes, with the cell size it uses (0.25 degrees). 232_549 is the Ledge cell.
const index = (cellKeys: string[], extra: Partial<CellIndex> = {}): CellIndex => ({ v: 1, built: '2026-11-06T00:00:00Z', source: 'test', cell: 0.25, bbox: [-122, 47.25, -121.5, 47.5], cells: cellKeys, ...extra });
const WA = index(['232_549', '232_550']);
const key = (lon: number, lat: number) => `${Math.floor((lon + 180) / 0.25)}_${Math.floor((lat + 90) / 0.25)}`;
const PORTLAND = key(-122.6, 45.5), LA = key(-118.2, 34.0), VAN = key(-123.1, 49.2);

describe('coverage regions come from the data', () => {
  it('lists only Washington when only Washington cells exist', () => {
    expect(coverageRegions(WA).map((r) => r.code)).toEqual(['WA']);
  });
  it('lists whatever regions have cells, and not Washington when it has none', () => {
    const regions = coverageRegions(index([PORTLAND, LA, VAN]));
    expect(regions.map((r) => r.code)).toEqual(['OR', 'CA', 'BC']);
    expect(regions.map((r) => r.name)).not.toContain('Washington');
  });
  it('gives each region a centre inside it, taken from a covered cell', () => {
    const [wa] = coverageRegions(WA);
    expect(wa.center[0]).toBeCloseTo(-121.875, 2);
    expect(wa.center[1]).toBeCloseTo(47.375, 2);
  });
  it('uses a regions list in index.json when a build writes one', () => {
    const r = coverageRegions({ ...WA, regions: [{ code: 'ID', name: 'Idaho', center: [-116.2, 43.6] }] } as CellIndex);
    expect(r).toMatchObject([{ code: 'ID', name: 'Idaho', center: [-116.2, 43.6] }]);
  });
  it('is empty without an index', () => { expect(coverageRegions(null)).toEqual([]); });
  it('writes the coverage line from the list', () => {
    const r = (codes: string[]) => codes.map((code) => ({ code, name: code, center: [0, 0], cells: 1 }) as Region);
    expect(coverageLine(r(['WA']))).toBe('Trails in WA. More regions coming.');
    expect(coverageLine(r(['WA', 'OR']))).toBe('Trails in WA and OR. More regions coming.');
    expect(coverageLine(r(['WA', 'OR', 'CA', 'BC']))).toBe('Trails in WA, OR, CA and BC. More regions coming.');
    expect(coverageLine([])).toBe('More regions coming.');
    expect(coverageLine(r(['WA']))).not.toMatch(/every week/);
  });
});

describe('first-visit region (time zone, never IP)', () => {
  const regions = coverageRegions(index([PORTLAND, LA, key(-121.9, 47.4)]));
  it('takes the most populous covered region that uses the time zone', () => {
    expect(defaultRegion(regions, 'America/Los_Angeles')?.code).toBe('CA');
  });
  it('falls back to the most populous covered region for an unknown zone', () => {
    expect(defaultRegion(regions, 'Asia/Tokyo')?.code).toBe('CA');
    expect(defaultRegion(regions, undefined)?.code).toBe('CA');
  });
  it('picks Vancouver time for British Columbia when it is covered', () => {
    expect(defaultRegion(coverageRegions(index([VAN, LA])), 'America/Vancouver')?.code).toBe('BC');
  });
  it('is null when nothing is covered', () => { expect(defaultRegion([], 'America/Los_Angeles')).toBeNull(); });
  it('finds the nearest covered region for "Show trails in"', () => {
    expect(nearestRegion(regions, [-97.7, 30.3])?.code).toBeTruthy(); // Austin: the nearest, whichever it is
    expect(nearestRegion(regions, [-122.3, 47.6])?.code).toBe('WA');
    expect(nearestRegion([], [0, 0])).toBeNull();
  });
});

describe('isCovered', () => {
  it('is true near a covered cell and false far from every cell', () => {
    expect(isCovered(WA, [-121.77, 47.43])).toBe(true);
    expect(isCovered(WA, [-97.74, 30.27])).toBe(false);
    expect(isCovered(null, [-121.77, 47.43])).toBe(false);
  });
});

describe('greeting', () => {
  it('follows the local hour', () => {
    expect(greeting(new Date(2026, 10, 14, 8))).toBe('Good morning');
    expect(greeting(new Date(2026, 10, 14, 14))).toBe('Good afternoon');
    expect(greeting(new Date(2026, 10, 14, 20))).toBe('Good evening');
  });
});

describe('collections', () => {
  const tagged = (t: Trail, highlights: string[]): Trail => ({ ...t, highlights });
  // A short (under 3 mi round trip) copy of a real trail: first half of the line only, so the numbers stay real.
  const short = (t: Trail, highlights?: string[]): Trail => {
    const coords = t.coords.slice(0, Math.floor(t.coords.length / 4));
    return { ...t, id: `${t.id}-s`, name: `${t.name} Spur`, coords, lengthM: t.lengthM / 4, loop: false, highlights, ascentM: (t.ascentM ?? 0) / 4, descentM: (t.descentM ?? 0) / 4 };
  };
  const pool = [tagged(ledge, ['view', 'falls']), tagged(chirico, ['dogs?']), si, annette, short(ledge, ['view']), short(chirico, ['view?', 'dogs'])];

  it('has the four rows and no "Great this weekend"', () => {
    expect(COLLECTIONS.map((c) => c.title)).toEqual(['Top picks', 'Short with a view', 'Dog-friendly', 'Waterfalls']);
  });
  it('puts only firm view tags in "Short with a view", and only trails under 3 mi', () => {
    const row = buildCollections(pool).find((c) => c.id === 'view')!;
    expect(row.trails.map((t) => t.name)).toEqual(['Rattlesnake Ledge Trail Spur']);
    expect(row.trails.every((t) => t.highlights?.includes('view'))).toBe(true);
  });
  it('treats an untagged dog or view as Unknown, never as Yes', () => {
    const rows = buildCollections(pool);
    expect(rows.find((c) => c.id === 'dogs')!.trails.map((t) => t.name)).toEqual(['Chirico Trail Spur']); // 'dogs?' on Chirico is a maybe
  });
  it('lists waterfalls from the tag', () => {
    expect(buildCollections(pool).find((c) => c.id === 'falls')!.trails.map((t) => t.id)).toEqual([ledge.id]);
  });
  it('leaves out an empty row and caps a row at eight', () => {
    expect(buildCollections([si, annette]).map((c) => c.id)).toEqual(['top']);
    const many = Array.from({ length: 12 }, (_, i) => ({ ...ledge, id: `osm-r${i}`, name: `Ledge ${i} Trail`, coords: ledge.coords.map(([x, y]) => [x + i * 0.2, y] as [number, number]) }));
    expect(buildCollections(many)[0].trails).toHaveLength(8);
  });
});

describe('filters and sort', () => {
  const pool = [ledge, chirico, si, annette, { ...ledge, id: 'osm-r1', name: 'Dog Ledge Trail', highlights: ['dogs'], coords: ledge.coords.map(([x, y]) => [x + 0.3, y] as [number, number]) }];
  it('buckets by whole-trip miles (Ledge 3.8, Mount Si 7.2, Annette Lake 6.9)', () => {
    expect([inBucket(ledge, 'under3'), inBucket(ledge, '3to6'), inBucket(ledge, '6to10')]).toEqual([false, true, false]);
    expect([inBucket(si, '6to10'), inBucket(si, '10plus')]).toEqual([true, false]);
    expect(applyFilters(pool, { ...NO_FILTERS, length: '6to10' }).map((t) => t.name).sort()).toEqual(['Annette Lake Trail', 'Mount Si Trail']);
  });
  it('filters by length, difficulty and dogs', () => {
    expect(applyFilters(pool, { ...NO_FILTERS, difficulty: 'Hard' }).every((t) => level(t) === 'Hard')).toBe(true);
    expect(applyFilters(pool, { ...NO_FILTERS, dogs: true }).map((t) => t.name)).toEqual(['Dog Ledge Trail']);
    expect(applyFilters(pool, { ...NO_FILTERS, length: '10plus' })).toEqual([]);
  });
  it('sorts shortest first and nearest first', () => {
    const shortest = applyFilters(pool, { ...NO_FILTERS, sort: 'shortest' });
    expect(shortest.map((t) => t.lengthM)).toEqual([...shortest.map((t) => t.lengthM)].sort((a, b) => a - b));
    const nearest = applyFilters(pool, { ...NO_FILTERS, sort: 'nearest' }, [-121.49, 47.39]);
    expect(nearest[0].name).toMatch(/Annette Lake|Granite/);
  });
});
