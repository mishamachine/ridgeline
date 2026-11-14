import { describe, it, expect } from 'vitest';
import type { Trail } from './trails';
import { filterTrails, isJunkName, rankTrails, relevance, suitability } from './quality';
import { level, roundTripM, roundTripClimbM, tripMinutes } from './plan';
import { driveLabel, mapsOptions, trailheadOf } from './maps';
import { shortlistUrl, trailUrl } from './share';
import { parseRoute, routePath } from './route';
import { norm, searchNames, type NameEntry } from './nameIndex';
import { placeQueryUrl, searchPlaces, toPlaces } from './geocode';
import { highlightsOf } from '../components/Chips';
import { SITE_URL } from './site';


const line = (lon: number, lat: number, mi: number): [number, number][] => [[lon, lat], [lon, lat + mi / 69]];
function trail(over: Partial<Trail> & { name: string; id: string }): Trail {
  const coords = over.coords ?? line(-121.78, 47.49, 2);
  return { lengthM: 3200, loop: false, partial: false, osmUrl: '', tags: {}, coords, ...over };
}

describe('quality filter', () => {
  it('flags junk names', () => {
    for (const n of ['Private', 'Abandoned connector (Impassable)', 'NF-65 (abandoned)', '1263', 'Sporting Clays Course', 'Trail', 'no name'])
      expect(isJunkName(n), n).toBe(true);
    for (const n of ['Rattlesnake Ledge Trail', 'Poo Poo Point', 'Mount Si Old Trail']) expect(isJunkName(n), n).toBe(false);
  });

  it('drops short ways but keeps short routes', () => {
    const out = filterTrails([
      trail({ id: 'osm-w1-0', name: 'Stub Path', lengthM: 400 }),
      trail({ id: 'osm-r2', name: 'Tiny Route', lengthM: 400 }),
      trail({ id: 'osm-w3-0', name: 'Private', lengthM: 5000 }),
    ]);
    expect(out.map((t) => t.name)).toEqual(['Tiny Route']);
  });

  it('merges same-name segments in one place, keeps same name far apart', () => {
    const a = trail({ id: 'osm-w1-0', name: 'CCC Trail', lengthM: 3000 });
    const b = trail({ id: 'osm-w2-0', name: 'CCC Trail', lengthM: 2000, coords: line(-121.7801, 47.4901, 1) });
    const far = trail({ id: 'osm-w3-0', name: 'CCC Trail', lengthM: 2500, coords: line(-120.5, 47.0, 2) });
    expect(filterTrails([a, b, far]).map((t) => t.id).sort()).toEqual(['osm-w1-0', 'osm-w3-0']);
  });

  it('ranks named routes and day-hike lengths first, not longest first', () => {
    const wonderland = trail({ id: 'osm-w9-0', name: 'Wonderland Trail', lengthM: 138000 });
    const ledge = trail({ id: 'osm-r5588030', name: 'Rattlesnake Ledge Trail', lengthM: 3000 });
    const long = trail({ id: 'osm-r7', name: 'Pratt River Route', lengthM: 19000 });
    const order = rankTrails([wonderland, long, ledge]).map((t) => t.name);
    expect(order[0]).toBe('Rattlesnake Ledge Trail');
    expect(order.at(-1)).toBe('Wonderland Trail');
    expect(relevance(ledge)).toBeGreaterThan(relevance(wonderland));
  });

  it('prefers near and suitable: a close easy trail beats a far hard one', () => {
    const near = trail({ id: 'osm-r10', name: 'Near Easy', lengthM: 3000, ascentM: 50, descentM: 50, coords: line(-121.78, 47.49, 2) });
    const far = trail({ id: 'osm-r11', name: 'Far Hard', lengthM: 3000, ascentM: 1500, descentM: 100, coords: line(-121.0, 47.0, 2) });
    expect(rankTrails([far, near], [-121.78, 47.49]).map((t) => t.name)).toEqual(['Near Easy', 'Far Hard']);
    expect(suitability(far, [-121.78, 47.49])).toBeLessThan(suitability(far));
  });
});

describe('round trip numbers', () => {
  const ledge = { lengthM: 3057, loop: false, ascentM: 469, descentM: 5 };
  it('doubles out-and-back, keeps loops', () => {
    expect(roundTripM(ledge)).toBe(6114);
    expect(roundTripM({ lengthM: 3000, loop: true })).toBe(3000);
  });
  it('climbs the way up and the climbs on the way home', () => {
    expect(roundTripClimbM(ledge)).toBe(474);
    expect(roundTripClimbM({ lengthM: 1, loop: true, ascentM: 100 })).toBe(100);
    expect(roundTripClimbM({ lengthM: 1, loop: false })).toBeNull();
  });
  it('estimates the whole outing (3.8 mi at 3 mph plus 30 min per 1,000 ft up: about 2 h)', () => {
    const m = tripMinutes(ledge);
    expect(m).toBeGreaterThan(118);
    expect(m).toBeLessThan(128);
  });
  it('computes a level for an unrated trail and none without elevation', () => {
    expect(level({ lengthM: 1600, loop: false, ascentM: 20, descentM: 20 })).toBe('Easy');
    expect(level(ledge)).toBe('Moderate');
    expect(level({ lengthM: 12000, loop: false, ascentM: 1200, descentM: 100 })).toBe('Hard');
    expect(level({ lengthM: 3000, loop: false })).toBeNull();
  });
});

describe('Drive there', () => {
  const t = { coords: [[-121.7681, 47.4343], [-121.77, 47.44]] as [number, number][], trailhead: undefined as [number, number] | undefined, trailheadIsParking: undefined as boolean | undefined };
  it('uses the trail start when there is no trailhead', () => {
    expect(trailheadOf(t)).toEqual({ lon: -121.7681, lat: 47.4343 });
    expect(driveLabel(t)).toBe('Drive to trail start');
  });
  it('prefers a mapped trailhead and says parking when it is one', () => {
    const th = { ...t, trailhead: [-121.7, 47.5] as [number, number], trailheadIsParking: true };
    expect(trailheadOf(th)).toEqual({ lon: -121.7, lat: 47.5 });
    expect(driveLabel(th)).toBe('Drive to parking');
  });
  it('iOS gets Apple Maps then Google; others go straight to Google', () => {
    const ios = mapsOptions(t, 'ios');
    expect(ios.map((o) => o.label)).toEqual(['Apple Maps', 'Google Maps']);
    expect(ios[0].url).toBe('https://maps.apple.com/?daddr=47.434300,-121.768100&dirflg=d');
    expect(mapsOptions(t, 'other')).toEqual([{ label: 'Google Maps', url: 'https://www.google.com/maps/dir/?api=1&destination=47.434300,-121.768100' }]);
  });
});

describe('share links and routing', () => {
  const a = trail({ id: 'osm-r5588030', name: 'Rattlesnake Ledge', coords: [[-121.7681, 47.4343], [-121.77, 47.44]] });
  const b = trail({ id: 'osm-w123-0', name: 'Little Si', coords: [[-121.7, 47.5], [-121.71, 47.51]] });
  it('builds a trail link on the public site', () => {
    expect(trailUrl(a)).toBe(`${SITE_URL}/trail/osm-r5588030?ll=-121.768,47.434`);
  });
  it('builds a shortlist link /s?ids=a,b', () => {
    expect(shortlistUrl([a, b])).toBe(`${SITE_URL}/s?ids=osm-r5588030,osm-w123-0&ll=-121.768_47.434~-121.7_47.5`);
  });
  it('parses trail, shortlist and tab URLs, with and without a base path', () => {
    expect(parseRoute('/trail/osm-r5588030', '?ll=-121.768,47.434')).toEqual({ kind: 'trail', id: 'osm-r5588030', ll: [-121.768, 47.434] });
    expect(parseRoute('/ridgeline/trail/osm-w1-0', '', '/ridgeline/')).toEqual({ kind: 'trail', id: 'osm-w1-0', ll: undefined });
    expect(parseRoute('/s', '?ids=a,b&ll=-121.1_47.1~-121.2_47.2')).toEqual({ kind: 'shared', ids: ['a', 'b'], lls: [[-121.1, 47.1], [-121.2, 47.2]] });
    expect(parseRoute('/s', '?ids=a,b')).toEqual({ kind: 'shared', ids: ['a', 'b'], lls: [null, null] });
    expect(parseRoute('/saved', '')).toEqual({ kind: 'tab', tab: 'saved' });
    expect(parseRoute('/', '')).toEqual({ kind: 'tab', tab: 'find' });
    expect(parseRoute('/hike/', '')).toEqual({ kind: 'tab', tab: 'hike' });
  });
  it('ignores bad ids and falls back to Find', () => {
    expect(parseRoute('/trail/<script>', '')).toEqual({ kind: 'tab', tab: 'find' });
    expect(parseRoute('/s', '?ids=<x>')).toEqual({ kind: 'tab', tab: 'find' });
    expect(parseRoute('/s', `?ids=${Array.from({ length: 40 }, (_, i) => `t${i}`).join(',')}`)).toMatchObject({ kind: 'shared' });
  });
  it('round-trips through routePath', () => {
    for (const r of [parseRoute('/trail/osm-r1', '?ll=-121.5,47.5'), parseRoute('/s', '?ids=a,b'), parseRoute('/hike', '')]) {
      const url = routePath(r, '/ridgeline/');
      const [path, q = ''] = url.split('?');
      expect(parseRoute(path, q ? `?${q}` : '', '/ridgeline/')).toEqual(r);
    }
  });
});

describe('name search', () => {
  const E: NameEntry[] = [
    ['osm-r5588030', 'Rattlesnake Ledge Trail', -121.768, 47.434, 3050],
    ['osm-r1', 'Rattlesnake Mountain Trail', -121.8, 47.45, 12000],
    ['osm-w9', 'Rattlesnake Lake Loop', -121.77, 47.43, 1500],
    ['osm-r2', 'Mount Rainier Wonderland Trail', -121.7, 46.85, 138000],
    ['osm-w10', 'Rattlesnake Ledge Trail', -121.7681, 47.4343, 900],
  ];
  it('finds a trail anywhere in the index, not only in view', () => {
    expect(searchNames(E, 'rattlesnake ledge')[0][0]).toBe('osm-r5588030');
    expect(searchNames(E, 'rainier')[0][1]).toContain('Rainier');
  });
  it('is forgiving about case, punctuation and accents', () => {
    expect(norm('Café-Trail #2')).toBe('cafe trail 2');
    expect(searchNames(E, 'RATTLESNAKE-LEDGE')[0][0]).toBe('osm-r5588030');
  });
  it('merges same-name twins that sit together, and ignores one-letter queries', () => {
    expect(searchNames(E, 'ledge').filter((e) => e[1] === 'Rattlesnake Ledge Trail')).toHaveLength(1);
    expect(searchNames(E, 'r')).toEqual([]);
  });
});

describe('place search', () => {
  it('makes one US and Canada request with no regional bias', () => {
    const u = new URL(placeQueryUrl('Mount Rainier'));
    expect(u.searchParams.get('countrycodes')).toBe('us,ca');
    expect(u.searchParams.has('viewbox')).toBe(false);
    expect(u.searchParams.has('bounded')).toBe(false);
  });
  it('asks once per query and answers repeats from memory', async () => {
    let calls = 0;
    const real = globalThis.fetch;
    globalThis.fetch = (async () => { calls++; return new Response('[]'); }) as typeof fetch;
    try {
      await searchPlaces('Rainier'); await searchPlaces(' rainier ');
      expect(calls).toBe(1);
    } finally { globalThis.fetch = real; }
  });
  it('turns Nominatim hits into places', () => {
    const [p] = toPlaces([{ display_name: 'Mount Rainier National Park, Pierce County, Washington, United States', name: 'Mount Rainier National Park', lon: '-121.7', lat: '46.85', boundingbox: ['46.7', '47.0', '-121.9', '-121.5'] }]);
    expect(p).toMatchObject({ name: 'Mount Rainier National Park', lon: -121.7, lat: 46.85, bbox: [-121.9, 46.7, -121.5, 47] });
  });
});

describe('highlights', () => {
  it('shows "maybe" ones muted and never as firm; adds computed Big climb and Long', () => {
    const hs = highlightsOf({ highlights: ['view', 'bikes?'], lengthM: 20000, loop: false, ascentM: 500 });
    expect(hs).toEqual([{ kind: 'view', maybe: false }, { kind: 'long', maybe: false }, { kind: 'bikes', maybe: true }]);
    expect(highlightsOf({ lengthM: 3000, loop: false, ascentM: 800 })).toEqual([{ kind: 'climb', maybe: false }]);
    // 4.5 mi one way is 9 mi round trip: Long. The same length as a loop is 4.5 mi: not.
    expect(highlightsOf({ lengthM: 7240, loop: false }).map((h) => h.kind)).toEqual(['long']);
    expect(highlightsOf({ lengthM: 7240, loop: true })).toEqual([]);
  });
});

describe('link origin', () => {
  it('every link uses the public site, whatever host the app is served from', async () => {
    const { linkOrigin, linkBase } = await import('./origin');
    expect(linkOrigin()).toBe(SITE_URL);
    expect(linkBase()).toBe('/');
    (globalThis as unknown as { window: unknown }).window = { location: { origin: 'https://example.test' } };
    try {
      expect(linkOrigin()).toBe(SITE_URL);
      expect(trailUrl(trail({ id: 'osm-r1', name: 'X' }))).toMatch(/^https:\/\/hike\.bbprojectfactory\.com\/trail\/osm-r1\?ll=/);
      (globalThis as unknown as { window: unknown }).window = { Capacitor: { isNativePlatform: () => true }, location: { origin: 'capacitor://localhost' } };
      expect(linkOrigin()).toBe(SITE_URL);
    } finally { delete (globalThis as unknown as { window?: unknown }).window; }
  });
});
