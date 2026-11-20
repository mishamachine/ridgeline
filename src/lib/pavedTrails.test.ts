import { describe, expect, it } from 'vitest';
import { richCell } from '../../e2e/fixtures';
import { highlightsOf } from '../components/Chips';
import { cellsToTrails } from './cells';
import { NO_FILTERS, applyFilters, buildCollections } from './home';
import { basemapPathAt, nearestPathName, normName, NOT_LISTED, trailNamed, type TapMap } from './mapTap';
import { PAVED_MIN_GAIN_M, isFlatPaved, isMtb, isPavedShared } from './quality';
import { PAVED_KIND, sharedLabel, overpassQuery, parseOverpass, withElevation, type Trail } from './trails';

// Cedar River Trail, Renton WA: real OpenStreetMap tags (read from Overpass, 20 Nov 2026).
const CEDAR = { highway: 'cycleway', foot: 'yes', bicycle: 'yes', name: 'Cedar River Trail' };
const g = [{ lat: 47.4800, lon: -122.2100 }, { lat: 47.4900, lon: -122.2100 }, { lat: 47.5000, lon: -122.2100 }];

describe('paved shared-use trails', () => {
  it('Overpass search asks for named cycleways that people may walk', () => {
    const q = overpassQuery({ west: -122.3, south: 47.4, east: -122.1, north: 47.5 });
    expect(q).toContain('way["highway"="cycleway"]["foot"!="no"]["name"]');
  });

  it('marks a named cycleway kind=paved_shared and keeps its surface; it is not a mountain-bike trail', () => {
    const [t] = parseOverpass([{ type: 'way', id: 37822008, geometry: g, tags: { ...CEDAR, surface: 'asphalt' } }]);
    expect(t.tags.kind).toBe(PAVED_KIND);
    expect(t.tags.surface).toBe('asphalt');
    expect(isPavedShared(t)).toBe(true);
    expect(isMtb(t)).toBe(false);
    // no foot tag, bicycle=designated: still a cycleway people may walk, not "mountain-bike"
    const [u] = parseOverpass([{ type: 'way', id: 5, geometry: g, tags: { highway: 'cycleway', bicycle: 'designated', name: 'Rail Trail' } }]);
    expect(isPavedShared(u)).toBe(true);
    expect(isMtb(u)).toBe(false);
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
    const [a] = parseOverpass([{ type: 'way', id: 2, geometry: g, tags: { ...CEDAR, surface: 'asphalt' } }]);
    expect(highlightsOf(a)[0].label).toBe('Paved · shared with bikes');
  });

  it('the label follows the surface tag', () => {
    for (const v of ['asphalt', 'paved', 'concrete', 'concrete:plates', 'concrete:lanes', 'paving_stones', 'Asphalt']) expect(sharedLabel(v), v).toBe('Paved · shared with bikes');
    for (const v of ['gravel', 'fine_gravel', 'compacted', 'dirt', 'ground', 'unpaved']) expect(sharedLabel(v), v).toBe('Gravel · shared with bikes');
    for (const v of [undefined, '', 'sand', 'wood', 'grass', 'paved_but_not']) expect(sharedLabel(v), String(v)).toBe('Shared with bikes');
  });

  describe('Home top picks', () => {
    const pool = cellsToTrails([richCell()]).slice(0, 5).map((t, i) => ({ ...t, id: `${t.id}-${i}`, name: `${t.name} ${i}`, highlights: ['falls', 'view'], coords: t.coords.map(([x, y]) => [x + i * 0.3, y] as [number, number]) }));
    const ramp = (gain: number) => Array.from({ length: 100 }, (_, k) => Math.round((gain * k) / 99));
    const paved = (t: Trail, gain: number | null): Trail => {
      const p: Trail = { ...t, tags: { ...t.tags, kind: PAVED_KIND } };
      return gain == null ? { ...p, elevation: undefined, ascentM: undefined, descentM: undefined } : withElevation(p, ramp(gain));
    };
    const ids = (ts: Trail[]) => buildCollections(ts).flatMap((r) => r.trails.map((t) => t.id));

    it('leaves a flat paved trail out of the rows, and one with unknown gain', () => {
      expect(isFlatPaved(paved(pool[0], 20))).toBe(true);
      expect(ids([paved(pool[0], 20), ...pool.slice(1)])).not.toContain(pool[0].id);
      expect(ids([paved(pool[0], null), ...pool.slice(1)])).not.toContain(pool[0].id);
    });
    it('keeps a paved trail with real gain (500 ft / 152 m or more)', () => {
      expect(PAVED_MIN_GAIN_M).toBe(152);
      expect(isFlatPaved(paved(pool[0], PAVED_MIN_GAIN_M))).toBe(false);
      expect(ids([paved(pool[0], 200), ...pool.slice(1)])).toContain(pool[0].id);
    });
    it('still lists a flat paved trail in All trails and filters', () => {
      expect(applyFilters([paved(pool[0], 20), ...pool.slice(1)], NO_FILTERS).map((t) => t.id)).toContain(pool[0].id);
    });
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
  it('matches a tapped name to a loaded trail ignoring case, spaces and punctuation', () => {
    const list = [{ name: 'Snoqualmie Valley Trail' }, { name: 'Cedar River Trail' }];
    expect(normName('  Cedar  RIVER trail. ')).toBe('cedar river trail');
    expect(trailNamed(list, 'cedar river  trail')).toBe(list[1]);
    expect(trailNamed(list, 'Snoqualmie-Valley Trail')).toBe(list[0]);
    expect(trailNamed(list, 'Cedar River Trail Link')).toBeUndefined();
    expect(trailNamed(list, undefined)).toBeUndefined();
    expect(trailNamed(list, '...')).toBeUndefined();
  });
  it('returns null when no basemap path is under the tap', () => {
    expect(basemapPathAt(fake([]), pt)).toBeNull();
  });
});
