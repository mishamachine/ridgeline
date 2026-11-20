import { describe, expect, it } from 'vitest';
import { richCell } from '../../e2e/fixtures';
import { highlightsOf } from '../components/Chips';
import { cellsToTrails } from './cells';
import { NO_FILTERS, applyFilters, buildCollections } from './home';
import { basemapPathAt, nearestPathName, classifyTap, matchTrail, normName, NOT_LISTED, type TapMap } from './mapTap';
import { PAVED_MIN_GAIN_M, isHomeExcludedCycleway, isMtb, isPavedShared } from './quality';
import { PAVED_KIND, dominantSurface, sharedLabel, isStreetName, overpassQuery, parseOverpass, withElevation, type Trail } from './trails';

// Cedar River Trail, Renton WA: real OpenStreetMap tags (read from Overpass, 20 Nov 2026).
const CEDAR = { highway: 'cycleway', foot: 'yes', bicycle: 'yes', name: 'Cedar River Trail' };
const g = [{ lat: 47.4800, lon: -122.2100 }, { lat: 47.4900, lon: -122.2100 }, { lat: 47.5000, lon: -122.2100 }];

const ramp = (gain: number) => Array.from({ length: 100 }, (_, k) => Math.round((gain * k) / 99));

describe('paved shared-use trails', () => {
  it('Overpass search asks for named cycleways that people may walk', () => {
    const q = overpassQuery({ west: -122.3, south: 47.4, east: -122.1, north: 47.5 });
    expect(q).toContain('way["highway"="cycleway"]["foot"!~"^(no|private|use_sidepath)$"]["name"]');
  });

  it('marks a named cycleway kind=paved_shared and keeps its surface; it is not a mountain-bike trail', () => {
    const [t] = parseOverpass([{ type: 'way', id: 37822008, geometry: g, tags: { ...CEDAR, surface: 'asphalt' } }]);
    expect(t.tags.kind).toBe(PAVED_KIND);
    expect(t.tags.surface).toBe('asphalt');
    expect(isPavedShared(t)).toBe(true);
    expect(isMtb(t)).toBe(false);
    // paved, bicycle=designated, no foot tag: still shared, not "mountain-bike"
    const [u] = parseOverpass([{ type: 'way', id: 5, geometry: g, tags: { highway: 'cycleway', bicycle: 'designated', surface: 'asphalt', name: 'Rail Trail' } }]);
    expect(isPavedShared(u)).toBe(true);
    expect(isMtb(u)).toBe(false);
  });

  it('a bare or dirt cycleway with no foot tag is a mountain-bike trail; with foot yes, or a hard surface, it is shared', () => {
    const tags = (extra: Record<string, string>) => ({ highway: 'cycleway', name: 'Dirt Way Trail', ...extra });
    const one = (extra: Record<string, string>) => parseOverpass([{ type: 'way', id: 6, geometry: g, tags: tags(extra) }])[0];
    const flow = one({ bicycle: 'designated', surface: 'dirt' });
    expect(isMtb(flow)).toBe(true);
    expect(isPavedShared(flow)).toBe(false);
    for (const bare of [{ surface: 'dirt' }, { surface: 'ground' }, { surface: 'unpaved', motor_vehicle: 'yes' }]) {   // dirt cycleways with no foot tag (real Oregon shapes)
      const m = one(bare as Record<string, string>);
      expect(isMtb(m), JSON.stringify(bare)).toBe(true);
      expect(isPavedShared(m), JSON.stringify(bare)).toBe(false);
    }
    const okExtras: Record<string, string>[] = [{ bicycle: 'designated', foot: 'yes' }, { bicycle: 'designated', foot: 'designated' }, { bicycle: 'designated', foot: 'permissive' }, { surface: 'gravel' }, { bicycle: 'designated', surface: 'compacted' }];
    for (const bare of [{}, { motor_vehicle: 'yes' }, { bicycle: 'designated' }]) {   // bare cycleway (real Bloody Stump / Moto Trail shape): neither shared nor mountain-bike
      const b = one(bare as Record<string, string>);
      expect(isMtb(b), JSON.stringify(bare)).toBe(false);
      expect(isPavedShared(b), JSON.stringify(bare)).toBe(false);
      expect(b.tags.highway).toBe('cycleway');
      expect(highlightsOf(b).some((h) => h.kind === 'paved')).toBe(false);   // no label
      expect(isHomeExcludedCycleway(withElevation(b, ramp(300))), JSON.stringify(bare)).toBe(true);   // never in Home's picks, even with real gain
    }
    okExtras.push({ foot: 'official' });
    for (const extra of okExtras) {
      const t = one(extra);
      expect(isMtb(t), JSON.stringify(extra)).toBe(false);
      expect(isPavedShared(t), JSON.stringify(extra)).toBe(true);
    }
  });

  it('leaves out cycleways with foot private or use_sidepath, and street-like names unless there is a trail word', () => {
    const run = (name: string, foot?: string) => parseOverpass([{ type: 'way', id: 7, geometry: g, tags: { highway: 'cycleway', name, ...(foot ? { foot } : {}) } }]).length;
    expect(run('Cedar River Trail', 'private')).toBe(0);
    expect(run('Cedar River Trail', 'use_sidepath')).toBe(0);
    for (const n of ['Main Avenue', 'Elm Street Bike Lane', 'Cycletrack', 'Pine Boulevard']) { expect(isStreetName(n), n).toBe(true); expect(run(n)).toBe(0); }
    for (const n of ['NE 8th Parkway', '123 Parkway', 'West Parkway']) expect(isStreetName(n), n).toBe(true);
    for (const n of ['Tommy Thompson Parkway', 'Lake Tapps Parkway']) { expect(isStreetName(n), n).toBe(false); expect(run(n)).toBe(1); }
    // a street-named mountain-bike cycleway stays (as mountain-bike), so Find still lists it
    const flow = parseOverpass([{ type: 'way', id: 8, geometry: g, tags: { highway: 'cycleway', name: 'Shakedown Street', surface: 'dirt', 'mtb:scale': '2' } }]);
    expect(flow).toHaveLength(1);
    expect(isMtb(flow[0])).toBe(true);
    for (const n of ['Cedar River Trail', 'Lakeside Avenue Trail', 'Elliott Bay Greenway', 'Foothills Loop', 'St. Helens Trail']) { expect(isStreetName(n), n).toBe(false); expect(run(n)).toBe(1); }
  });

  it('a hosted cell entry carrying kind=paved_shared round-trips', () => {
    const cell = { v: 1 as const, r: [], w: [{ id: 7, t: { name: 'Cedar River Trail', kind: PAVED_KIND, surface: 'asphalt' }, g: [-122.21, 47.48, -122.21, 47.5] }] };
    const [t] = cellsToTrails([cell]);
    expect(t.tags.kind).toBe(PAVED_KIND);
    expect(isPavedShared(t)).toBe(true);
  });

  it('shows the "Paved · shared with bikes" label first on the card', () => {
    const [t] = parseOverpass([{ type: 'way', id: 1, geometry: g, tags: CEDAR }]);
    expect(highlightsOf(t)[0]).toEqual({ kind: 'paved', maybe: false, label: 'Shared with bikes' });   // no surface tag: no claim about it
    expect(highlightsOf({ ...t, highlights: ['bikes'] }).map((h) => h.kind)).toEqual(['paved']);   // no second "Bikes share" chip
    const [a] = parseOverpass([{ type: 'way', id: 2, geometry: g, tags: { ...CEDAR, surface: 'asphalt' } }]);
    expect(highlightsOf(a)[0].label).toBe('Paved · shared with bikes');
  });

  it('the label follows the surface tag', () => {
    for (const v of ['asphalt', 'paved', 'concrete', 'concrete:plates', 'concrete:lanes', 'paving_stones', 'Asphalt']) expect(sharedLabel(v), v).toBe('Paved · shared with bikes');
    for (const v of ['gravel', 'fine_gravel', 'compacted']) expect(sharedLabel(v), v).toBe('Gravel · shared with bikes');
    for (const v of ['dirt', 'ground', 'unpaved']) expect(sharedLabel(v), v).toBe('Unpaved · shared with bikes');
    for (const v of [undefined, '', 'sand', 'wood', 'grass', 'paved_but_not']) expect(sharedLabel(v), String(v)).toBe('Shared with bikes');
  });

  describe('Home top picks', () => {
    const pool = cellsToTrails([richCell()]).slice(0, 5).map((t, i) => ({ ...t, id: `${t.id}-${i}`, name: `${t.name} ${i}`, highlights: ['falls', 'view'], coords: t.coords.map(([x, y]) => [x + i * 0.3, y] as [number, number]) }));
    const paved = (t: Trail, gain: number | null): Trail => {
      const p: Trail = { ...t, tags: { ...t.tags, kind: PAVED_KIND, foot: 'yes', highway: 'cycleway' } };
      return gain == null ? { ...p, elevation: undefined, ascentM: undefined, descentM: undefined } : withElevation(p, ramp(gain));
    };
    const ids = (ts: Trail[]) => buildCollections(ts).flatMap((r) => r.trails.map((t) => t.id));

    it('leaves a flat paved trail out of the rows, and one with unknown gain', () => {
      expect(isHomeExcludedCycleway(paved(pool[0], 20))).toBe(true);
      expect(ids([paved(pool[0], 20), ...pool.slice(1)])).not.toContain(pool[0].id);
      expect(ids([paved(pool[0], null), ...pool.slice(1)])).not.toContain(pool[0].id);
    });
    it('keeps a paved trail with real gain (500 ft / 152 m or more)', () => {
      expect(PAVED_MIN_GAIN_M).toBe(152);
      expect(isHomeExcludedCycleway(paved(pool[0], PAVED_MIN_GAIN_M))).toBe(false);
      expect(ids([paved(pool[0], 200), ...pool.slice(1)])).toContain(pool[0].id);
    });
    it('Home needs an explicit foot yes, designated or permissive: a gravel or compacted cycleway with no foot tag is in Find but not in Home', () => {
      const mk = (extra: Record<string, string>) => parseOverpass([{ type: 'way', id: 11, geometry: g, tags: { highway: 'cycleway', name: 'Rail Trail', ...extra } }])[0];
      const gain = (t: Trail) => withElevation(t, ramp(200));
      for (const surface of ['gravel', 'compacted', 'asphalt']) {
        const t = gain(mk({ surface }));
        expect(isPavedShared(t), surface).toBe(true);        // shown in Find
        expect(isHomeExcludedCycleway(t), surface).toBe(true);          // not eligible for Home
        expect(applyFilters([t, ...pool.slice(1)], NO_FILTERS).map((x) => x.id), surface).toContain(t.id);
      }
      for (const foot of ['yes', 'designated', 'permissive']) expect(isHomeExcludedCycleway(gain(mk({ surface: 'gravel', foot }))), foot).toBe(false);
      expect(isHomeExcludedCycleway(withElevation(mk({ surface: 'gravel', foot: 'yes' }), ramp(20)))).toBe(true);   // explicit foot but no real gain
    });
    it('still lists a flat paved trail in All trails and filters', () => {
      expect(applyFilters([paved(pool[0], 20), ...pool.slice(1)], NO_FILTERS).map((t) => t.id)).toContain(pool[0].id);
    });
  });
});

describe('label from the dominant surface', () => {
  const way = (id: number, surface: string | undefined, km: number, at: number) => ({ type: 'way' as const, id, geometry: [{ lat: 47.4 + at, lon: -122 }, { lat: 47.4 + at + km / 111.2, lon: -122 }], tags: { highway: 'cycleway', foot: 'yes', name: 'Cedar River Trail', ...(surface ? { surface } : {}) } });
  const label = (...ways: ReturnType<typeof way>[]) => { const [t] = parseOverpass(ways); return highlightsOf(t)[0].label; };
  it('takes the surface covering most of the length, not the first way\'s', () => {
    expect(dominantSurface([{ surface: 'dirt', len: 6.2 }, { surface: 'asphalt', len: 20.6 }])).toBe('asphalt');   // Cedar River: 6.2 of 26.8 km unpaved
    expect(dominantSurface([{ surface: 'asphalt', len: 5 }, { surface: 'dirt', len: 5 }])).toBeUndefined();         // no surface reaches 60%
    expect(dominantSurface([{ surface: 'asphalt', len: 5 }, { len: 5 }])).toBeUndefined();                          // no-surface ways count against it
    expect(dominantSurface([{ surface: 'concrete', len: 1 }, { surface: 'asphalt', len: 4 }, { surface: 'paved', len: 1 }])).toBe('asphalt');
    expect(dominantSurface([])).toBeUndefined();
  });
  it('labels a merged trail by that surface', () => {
    expect(label(way(1, 'dirt', 6, 0), way(2, 'asphalt', 20, 0.1))).toBe('Paved · shared with bikes');   // the first way is dirt
    expect(label(way(1, 'dirt', 10, 0), way(2, 'asphalt', 10, 0.2))).toBe('Shared with bikes');           // an even split
    expect(label(way(1, 'fine_gravel', 10, 0))).toBe('Gravel · shared with bikes');
  });
});

describe('tap on a basemap path', () => {
  const pt = { x: 100, y: 100 };
  const fake = (rendered: unknown[], named: unknown[] = []): TapMap => ({
    queryRenderedFeatures: () => rendered as never,
    querySourceFeatures: () => named as never,
    project: (c) => ({ x: c[0], y: c[1] }),   // the test coordinates are already pixels
  });
  const line = (name: string | null, y: number) => ({ properties: name ? { name } : {}, geometry: { type: 'LineString', coordinates: [[0, y], [200, y]] } });

  it('says it is not in the list, with the name from the tapped feature', () => {
    expect(NOT_LISTED).toBe('Not in Ridgeline’s trail list yet');
    expect(basemapPathAt(fake([{ properties: { name: 'Cedar River Trail' }, geometry: { type: 'LineString', coordinates: [] } }]), pt)).toEqual({ name: 'Cedar River Trail' });
  });
  it('takes the name from the nearest named line within 24 px, else gives no name', () => {
    const hit = [{ properties: { class: 'path' }, geometry: { type: 'LineString', coordinates: [] } }];
    expect(basemapPathAt(fake(hit, [line('Far Trail', 160), line('Near Trail', 108)]), pt)).toEqual({ name: 'Near Trail' });
    expect(basemapPathAt(fake(hit, [line('Far Trail', 160)]), pt)).toEqual({ name: undefined });
    expect(nearestPathName(fake([], [line(null, 100)]), pt)).toBeUndefined();
  });
  it('normalises names: case, spaces and punctuation are ignored', () => {
    expect(normName('  Cedar  RIVER trail. ')).toBe('cedar river trail');
    expect(normName('Snoqualmie-Valley Trail')).toBe('snoqualmie valley trail');
  });
  const tr = (id: string, name: string, y: number) => ({ id, name, coords: [[0, y], [200, y]] as [number, number][] });   // pixel-like coordinates: project() is the identity
  it('matches the loaded trail by name AND nearest line, not just the first with that name', () => {
    const m = fake([]);
    const list = [tr('a', 'Cedar River Trail', 400), tr('b', 'Cedar River Trail', 104), tr('c', 'Other Trail', 100)];
    expect(matchTrail(m, list, 'cedar river  trail', pt)?.id).toBe('b');         // two trails share the name: the one under the finger
    expect(matchTrail(m, [list[0]], 'Cedar River Trail', pt)).toBeUndefined();     // same name but far away: not this path
    expect(matchTrail(m, list, 'Cedar River Trail Link', pt)).toBeUndefined();
    expect(matchTrail(m, list, undefined, pt)).toBeUndefined();
    expect(matchTrail(m, list, '...', pt)).toBeUndefined();
  });
  it('decides what the tap does: open, hidden by filters, not listed, or nothing while loading', () => {
    const a = { id: 'a' }, listed = new Set(['a', 'b']), shown = new Set(['a']);
    expect(classifyTap(a, listed, shown, false)).toBe('open');
    expect(classifyTap({ id: 'b' }, listed, shown, false)).toBe('hidden');       // passes the junk filter, hidden by a chip
    expect(classifyTap({ id: 'z' }, listed, shown, false)).toBe('unlisted');
    expect(classifyTap(undefined, listed, shown, false)).toBe('unlisted');
    expect(classifyTap(a, listed, shown, true)).toBe('wait');                    // the list is still loading: no note
    expect(classifyTap(undefined, listed, shown, true)).toBe('wait');
  });
  it('skips far-away tile lines by bounding box before measuring them', () => {
    let calls = 0;
    const m: TapMap = { queryRenderedFeatures: () => [], querySourceFeatures: () => [{ properties: { name: 'Far Trail' }, geometry: { type: 'LineString', coordinates: Array.from({ length: 500 }, (_, i) => [5000 + i, 5000]) } }] as never, project: (c) => { calls++; return { x: c[0], y: c[1] }; } };
    expect(nearestPathName(m, pt)).toBeUndefined();
    expect(calls).toBeLessThanOrEqual(4);   // only the four box corners were projected
  });
  it('returns null when no basemap path is under the tap', () => {
    expect(basemapPathAt(fake([]), pt)).toBeNull();
  });
});
