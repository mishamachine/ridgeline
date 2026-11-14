import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// What Home may fetch: our own hosted files (/trails/...) and nothing else. Home never calls Nominatim or Overpass (Enter searches the local name index too).
const cells = JSON.parse(readFileSync(new URL('./fixtures/wa-cells.json', import.meta.url), 'utf8')) as Record<string, unknown[]>;
const INDEX = { v: 1, built: '2026-11-06T00:00:00Z', source: 'test', cell: 0.25, bbox: [-122, 47.25, -121.5, 47.5], cells: ['232_549'] };
// Name index entries: [id, name, lon, lat, length in metres], as scripts/name_index.py writes them.
const NAMES = { v: 1, e: [
  ['osm-r5588030', 'Rattlesnake Ledge Trail', -121.77165, 47.43564, 6115],
  ['osm-r5553769', 'Mount Si Trail', -121.72316, 47.48801, 5800],
  ['osm-r4794619', 'Annette Lake Trail', -121.47397, 47.39284, 5500],
] };

let urls: string[];
beforeEach(() => {
  vi.resetModules();
  urls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const u = String(input);
    urls.push(u);
    const json = (b: unknown) => ({ ok: true, status: 200, json: async () => b });
    if (u.endsWith('/trails/index.json')) return json(INDEX);
    if (u.endsWith('/trails/names.json')) return json(NAMES);
    if (u.endsWith('/trails/232_549.json')) return json(cells.ledge[0]);
    return { ok: false, status: 404, json: async () => ({}) };
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const thirdParty = (u: string) => /nominatim|overpass|openstreetmap\.org|openfreemap|maps\.mail\.ru|private\.coffee/i.test(u);

describe('Home network use', () => {
  it('loads the collections from hosted trail files only', async () => {
    const { loadAround } = await import('./home');
    const r = await loadAround([-121.77, 47.43]);
    expect(r.kind).toBe('ok');
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u.startsWith('/trails/'))).toBe(true);
    expect(urls.some(thirdParty)).toBe(false);
  });
  it('says "outside" without fetching any cell, and never falls back to Overpass', async () => {
    const { loadAround } = await import('./home');
    const r = await loadAround([-97.74, 30.27]); // Austin
    expect(r).toEqual({ kind: 'outside' });
    expect(urls).toEqual(['/trails/index.json']);
  });
  it('reports "unavailable" when the index is missing, with no third-party call', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async (u: unknown) => { urls.push(String(u)); return { ok: false, status: 404, json: async () => ({}) }; });
    const { loadAround } = await import('./home');
    expect(await loadAround([-121.77, 47.43])).toEqual({ kind: 'unavailable' });
    expect(urls.some(thirdParty)).toBe(false);
  });
  it('type-ahead searches our own name index and calls nothing else', async () => {
    const { loadNameIndex, searchNames } = await import('./nameIndex');
    const names = await loadNameIndex();
    expect(searchNames(names, 'rattle').map((m) => m[1])).toEqual(['Rattlesnake Ledge Trail']);
    expect(searchNames(names, 'lake', 6, [-121.5, 47.4]).map((m) => m[1])).toEqual(['Annette Lake Trail']);
    expect(searchNames(names, 'm')).toEqual([]); // one letter: nothing
    expect(urls).toEqual(['/trails/names.json']);
  });
  it('Enter searches only the local name index: no match gives no network call', async () => {
    const { loadNameIndex, searchNames } = await import('./nameIndex');
    const names = await loadNameIndex();
    expect(searchNames(names, 'zzzz nowhere', 1)).toEqual([]);
    expect(searchNames(names, 'mount si', 1)[0][0]).toBe('osm-r5553769');
    expect(urls.every((u) => u.startsWith('/trails/'))).toBe(true);
    expect(urls.some(thirdParty)).toBe(false);
  });
  it('Home source has no public geocoder, Overpass or map call at all', () => {
    const home = readFileSync(new URL('../screens/Home.tsx', import.meta.url), 'utf8');
    const view = readFileSync(new URL('../screens/HomeView.tsx', import.meta.url), 'utf8');
    const logic = readFileSync(new URL('./home.ts', import.meta.url), 'utf8');
    const card = readFileSync(new URL('../components/HomeCard.tsx', import.meta.url), 'utf8');
    for (const src of [home, view, logic, card]) {
      expect(src).not.toMatch(/fetchTrails|OVERPASS|overpass|maplibre|MapView|nominatim|geocode|searchPlaces/i);
    }
  });
});
