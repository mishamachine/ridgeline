import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// What Home may fetch: our own hosted files (/trails/...) and nothing else. Home never calls Overpass; Nominatim only once per Enter (bridge), never on keystrokes.
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
  it('keystrokes never touch the network: type-ahead is searchNames over the local index', async () => {
    const { loadNameIndex, searchNames } = await import('./nameIndex');
    const names = await loadNameIndex();
    const before = urls.length;
    for (const typed of ['s', 'se', 'sea', 'seat', 'seatt', 'seattl', 'seattle']) searchNames(names, typed);
    expect(urls.length).toBe(before);
    expect(urls.some(thirdParty)).toBe(false);
  });
  it('Enter on an exact trail name opens it with no place lookup', async () => {
    const { loadNameIndex } = await import('./nameIndex');
    const { onEnter } = await import('./homeSearch');
    const r = await onEnter('Mount Si Trail', await loadNameIndex(), undefined, true);
    expect(r).toMatchObject({ kind: 'trail' });
    expect(urls.some(thirdParty)).toBe(false);
  });
  it.each(['Seattle', 'Portland', 'Yosemite', 'Vancouver', 'Squamish'])('Enter on %s makes exactly one Nominatim call, US and Canada', async (place) => {
    vi.useFakeTimers();
    try {
      const { loadNameIndex } = await import('./nameIndex');
      const { onEnter, resetThrottleForTests } = await import('./homeSearch');
      resetThrottleForTests();
      const names = await loadNameIndex();
      urls.length = 0;
      (fetch as ReturnType<typeof vi.fn>).mockImplementation(async (u: unknown) => {
        urls.push(String(u));
        return { ok: true, status: 200, json: async () => [{ display_name: `${place}, Somewhere`, name: place, lon: '-122.3', lat: '47.6', boundingbox: ['47.4', '47.8', '-122.5', '-122.1'] }] };
      });
      const p = onEnter(place, names, undefined, true);
      await vi.runAllTimersAsync();
      const r = await p;
      expect(r).toMatchObject({ kind: 'places' });
      expect(urls).toHaveLength(1);
      expect(urls[0]).toMatch(/^https:\/\/nominatim\.openstreetmap\.org\/search\?/);
      expect(new URL(urls[0]).searchParams.get('countrycodes')).toBe('us,ca');
      expect(urls.some((u) => /overpass/i.test(u))).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it('holds the one-request-per-second limit across back-to-back Enters', async () => {
    vi.useFakeTimers();
    try {
      const { onEnter, resetThrottleForTests } = await import('./homeSearch');
      resetThrottleForTests();
      const starts: number[] = [];
      (fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => { starts.push(Date.now()); return { ok: true, status: 200, json: async () => [] }; });
      const all = Promise.all(['Alpha', 'Bravo', 'Charlie'].map((q) => onEnter(q, [], undefined, true)));
      await vi.runAllTimersAsync();
      await all;
      expect(starts).toHaveLength(3);
      expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000);
      expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(1000);
    } finally { vi.useRealTimers(); }
  });
  it('a repeated place answers from memory: no second request and no wait', async () => {
    const { onEnter, resetThrottleForTests } = await import('./homeSearch');
    resetThrottleForTests();
    let calls = 0;
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => { calls++; return { ok: true, status: 200, json: async () => [{ display_name: 'Squamish, BC', name: 'Squamish', lon: '-123.15', lat: '49.7', boundingbox: ['49.6', '49.8', '-123.3', '-123.0'] }] }; });
    await onEnter('Squamish', [], undefined, true);
    await onEnter(' squamish ', [], undefined, true); // would need ~1.1 s on the throttle if it queued
    expect(calls).toBe(1);
  });
  it('the app fetches the tile template only when a map screen is about to show', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    expect(app.match(/getTileTemplate\(\)/g)).toHaveLength(1);
    expect(app).toMatch(/needsMap && !tpl\) getTileTemplate\(\)/);
    expect(app).toMatch(/const needsMap = !!browse \|\| route\.kind === 'trail' \|\| !!hike/);
  });
  it('offline Enter makes no call', async () => {
    const { onEnter } = await import('./homeSearch');
    expect(await onEnter('Seattle', [], undefined, false)).toEqual({ kind: 'offline' });
    expect(urls.some(thirdParty)).toBe(false);
  });
  it('only the Enter path (homeSearch.ts) reaches a place lookup; Home itself has no Overpass, map or geocode calls', () => {
    const home = readFileSync(new URL('../screens/Home.tsx', import.meta.url), 'utf8');
    const view = readFileSync(new URL('../screens/HomeView.tsx', import.meta.url), 'utf8');
    const logic = readFileSync(new URL('./home.ts', import.meta.url), 'utf8');
    const card = readFileSync(new URL('../components/HomeCard.tsx', import.meta.url), 'utf8');
    const search = readFileSync(new URL('./homeSearch.ts', import.meta.url), 'utf8');
    for (const src of [home, view, logic, card, search]) expect(src).not.toMatch(/fetchTrails|OVERPASS|overpass|maplibre|MapView/i);
    for (const src of [home, view, logic, card]) expect(src).not.toMatch(/searchPlaces|nominatim/i);
    expect(search.match(/searchPlaces\(/g)).toHaveLength(1);
    expect(home.match(/onEnter\(/g)).toHaveLength(1);
  });
});
