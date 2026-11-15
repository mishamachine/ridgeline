import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodePlaces, searchPlaceIndex, type PlaceRow } from './placeIndex';

const rows: PlaceRow[] = [
  ['Bend', 'c', 4405820, -12131530], ['Bend Trailhead', 'r', 4410000, -12130000], ['Mount Bachelor', 'p', 4398500, -12168800],
  ['Smith Rock State Park', 'a', 4436700, -12113800], ['Sisters', 't', 4429100, -12154900],
];
const places = decodePlaces({ region: 'oregon', e: rows });

describe('place index', () => {
  it('decodes 1e-5 integers to degrees and keeps the region', () => {
    expect(places[0]).toEqual({ name: 'Bend', kind: 'c', lat: 44.0582, lon: -121.3153, region: 'oregon' });
  });
  it('ranks exact, then bigger places, then starts-with', () => {
    expect(searchPlaceIndex(places, 'bend').map((p) => p.name)).toEqual(['Bend', 'Bend Trailhead']);
    expect(searchPlaceIndex(places, 'smith')[0].name).toBe('Smith Rock State Park');
    expect(searchPlaceIndex(places, 'rock')[0].name).toBe('Smith Rock State Park'); // word start
    expect(searchPlaceIndex(places, 'b')).toEqual([]);
  });
});

describe('place shards', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('loads the shards of nearby regions only', async () => {
    vi.resetModules();
    const urls: string[] = [];
    const index = { v: 1, built: '', source: '', cell: 0.25, bbox: null, cells: [], regions: [
      { id: 'oregon', name: 'Oregon', bbox: [-124.75, 41.75, -116.25, 46.25], places: 'places/oregon.json' },
      { id: 'maine', name: 'Maine', bbox: [-71, 43, -67, 47.5], places: 'places/maine.json' }] };
    vi.stubGlobal('fetch', async (u: string) => { urls.push(u); return new Response(JSON.stringify(u.includes('places/') ? { v: 1, region: 'oregon', e: rows } : index)); });
    const { loadPlaces } = await import('./placeIndex');
    const got = await loadPlaces([-121.3, 44.0]);
    expect(got.length).toBe(rows.length);
    expect(urls.some((u) => u.includes('maine'))).toBe(false);
  });
});
