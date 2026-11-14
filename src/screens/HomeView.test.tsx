import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cellsToTrails } from '../lib/cells';
import { NO_FILTERS, buildCollections, coverageRegions, type Region } from '../lib/home';
import type { SavedItem } from '../lib/saved';
import { HomeView, type HomeViewProps } from './HomeView';

const cells = JSON.parse(readFileSync(new URL('../lib/fixtures/wa-cells.json', import.meta.url), 'utf8')) as Record<string, Parameters<typeof cellsToTrails>[0]>;
const trails = Object.values(cells).flatMap((files) => files.flatMap((f) => cellsToTrails([f])));
// Real trails, plus a short copy of one (first quarter of its line) so the under-3-mi rows have something to show.
const spur = { ...trails[0], id: `${trails[0].id}-s`, name: 'Ledge Spur', coords: trails[0].coords.slice(0, Math.floor(trails[0].coords.length / 4)), lengthM: trails[0].lengthM / 4, loop: false, highlights: ['view', 'dogs'] };
const tagged = [...trails.map((t, i) => ({ ...t, highlights: i === 0 ? ['view', 'falls'] : t.highlights })), spur];
const idx = (keys: string[]) => ({ v: 1, built: '', source: '', cell: 0.25, bbox: null, cells: keys });
const WA: Region[] = coverageRegions(idx(['232_549']));
const ALL: Region[] = coverageRegions(idx(['232_549', `${Math.floor((-122.6 + 180) / 0.25)}_${Math.floor((45.5 + 90) / 0.25)}`, `${Math.floor((-118.2 + 180) / 0.25)}_${Math.floor((34 + 90) / 0.25)}`]));
const noop = () => {};

const base: HomeViewProps = {
  mode: 'ready', hello: 'Good morning', loc: 'unasked', area: { kind: 'region', name: 'Washington' }, regions: WA,
  collections: buildCollections(tagged), results: null, filters: NO_FILTERS, filtersOpen: false, hike: null, saved: [],
  savedIds: new Set(), offlineIds: new Set(), outsideName: null, nearestCovered: null, search: <input aria-label="Search" />,
  onOpen: noop, onToggleSave: noop, onUseLocation: noop, onPickRegion: noop, onSeeAll: noop, onMap: noop, onResume: noop,
  onFilters: noop, onToggleFilters: noop, onRetry: noop,
};
const html = (over: Partial<HomeViewProps> = {}) => renderToStaticMarkup(<HomeView {...base} {...over} />);
const text = (h: string) => h.replace(/<[^>]*>/g, '|').replace(/\|+/g, ' | ');
const savedItem = (i: number, offline: boolean): SavedItem => ({ trail: trails[i], offline, bytes: 0, at: 1 });

describe('Home: 1 first visit, location not asked', () => {
  const h = html();
  it('starts in the region with one clear "Use my location" button', () => {
    expect(h).toContain('Starting in Washington');
    expect(h.match(/Use my location/g)).toHaveLength(1);
    expect(h).toContain('Top picks in Washington');
  });
  it('never says "near you" before location is known, and says where it stays', () => {
    expect(h).not.toMatch(/near you/i);
    expect(h).toContain('Your exact location never leaves this device.');
    expect(h).not.toContain('stays on your phone');
  });
  it('shows the approved row copy, the rank note button and the map entry', () => {
    expect(h).toContain('Ranked by Ridgeline’s trail score');
    expect(h).toContain('How we rank');
    expect(h).toContain('aria-expanded="false"');
    expect(h).toContain('Explore the map');
    expect(h).toContain('views tagged in OpenStreetMap');
    expect(h).not.toContain('Great this weekend');
  });
  it('lists each trail with distance labelled "round trip", gain, difficulty and a labelled save button', () => {
    expect(h).toMatch(/\d+(\.\d)? mi round trip/);
    expect(h).toMatch(/About [\d,]+ ft gain/);
    expect(h).toMatch(/Easy|Moderate|Hard/);
    expect(h).not.toContain('Mild');
    expect(h).toMatch(/aria-label="Save Rattlesnake Ledge Trail"/);
    expect(h).toContain('Drive time: later');
  });
  it('shows the data-driven coverage line and the Change region chip', () => {
    expect(h).toContain('Trails in WA. More regions coming.');
    expect(h).toContain('Change region'); // always on the card, even with one region (the list then has just that one)
  });
  it('offers "Change region" when several regions are covered, listing them from the data', () => {
    const m = html({ regions: ALL });
    expect(m).toContain('Change region');
    expect(m).toContain('Oregon'); expect(m).toContain('California');
    expect(m).toContain('Trails in WA, OR and CA. More regions coming.');
  });
  it('uses the static Bobo once and no map or tile markup', () => {
    expect(h.match(/class="bobo"/g)).toHaveLength(1);
    expect(h).not.toMatch(/<canvas|tiles\.|openfreemap|maplibre/i);
  });
});

describe('Home: 2 location allowed', () => {
  const h = html({ loc: 'allowed', area: { kind: 'you', name: 'you' } });
  it('says "near you" with no location button', () => {
    expect(h).toContain('Top picks near you');
    expect(h).not.toContain('Use my location');
    expect(h).not.toContain('Starting in');
  });
});

describe('Home: 3 location denied', () => {
  const h = html({ loc: 'denied', area: { kind: 'place', name: 'Seattle, WA' } });
  it('shows the chosen place and a quiet "Change region", with no nagging', () => {
    expect(h).toContain('Location is off.');
    expect(h).toContain('Showing Seattle, WA');
    expect(h).toContain('Change region');
    expect(h).toContain('Top picks around Seattle, WA');
    expect(h).not.toContain('Use my location');
  });
});

describe('Home: 4 returning user', () => {
  it('puts the hike in progress first, with one tap to resume', () => {
    const h = html({ hike: trails[2], saved: [savedItem(2, true)] });
    expect(h).toContain('Welcome back');
    expect(h).toContain('Hike in progress');
    expect(h).toContain('>Resume<');
    expect(h.indexOf('Hike in progress')).toBeLessThan(h.indexOf('Top picks'));
    expect(h).toContain('aria-label="Continue"');
  });
  it('shows up to three saved trails with the Offline badge', () => {
    const h = html({ saved: [savedItem(0, true), savedItem(1, false), savedItem(2, true), savedItem(3, true)], offlineIds: new Set([trails[0].id]) });
    expect(h).toContain('Offline maps ready');
    expect(h).toContain('Offline</span>');
    expect(h.match(/<h2 id="row-saved"/g)).toHaveLength(1);
    const saved = h.slice(h.indexOf('row-saved'));
    expect(saved.match(/class="hm-card"/g)).toHaveLength(3);
  });
});

describe('Home: 5 outside coverage', () => {
  const south = ALL.find((r) => r.code === 'CA')!;
  const h = html({ mode: 'outside', area: null, loc: 'allowed', regions: ALL, outsideName: 'Austin, TX', nearestCovered: south, collections: [] });
  it('says so plainly, lists the covered regions from the data and offers the nearest one', () => {
    expect(h).toContain('We don’t cover here yet');
    expect(h).toContain('Ridgeline doesn’t have trails for Austin, TX. Here is where we do.');
    expect(h).toContain('Washington'); expect(h).toContain('Oregon'); expect(h).toContain('California');
    expect(h).not.toContain('British Columbia'); // not covered in this data
    expect(h).toContain('Show trails in California');
  });
  it('shows no trail count, no trail card and the big Bobo only', () => {
    expect(h).not.toMatch(/\d+ trails?\b/);
    expect(h).not.toContain('hm-card');
    expect(h.match(/class="bobo"/g)).toHaveLength(1);
    expect(h).not.toContain('Filter and sort');
  });
  it('names the location generically when it is the person, not a searched place', () => {
    expect(html({ mode: 'outside', outsideName: null, regions: WA, nearestCovered: WA[0] })).toContain('Ridgeline doesn’t have trails for your location.');
  });
});

describe('Home: 6 offline', () => {
  const h = html({ mode: 'offline', saved: [savedItem(0, true), savedItem(1, true)], offlineIds: new Set([trails[0].id, trails[1].id]), collections: [] });
  it('says offline maps still work and shows saved trails only', () => {
    expect(h).toContain('You’re offline. Your offline maps still work.');
    expect(h).toContain('Place search needs a connection.');
    expect(h).toContain('Offline trails');
    expect(h).not.toContain('Top picks');
    expect(h).not.toContain('Explore the map');
    expect(h).not.toContain('Drive time');
  });
});

describe('Home: filters, difficulty and how-we-rank copy', () => {
  it('shows length, difficulty (Easy / Moderate / Hard), dogs, drive time and sort, with the difficulty explainer', () => {
    const h = html({ filtersOpen: true });
    for (const s of ['Under 3 mi', '3–6 mi', '6–10 mi', '10+ mi', 'Easy', 'Moderate', 'Hard', 'Dogs: tagged yes', 'Sort: Best', 'Sort: Nearest', 'Sort: Shortest']) expect(h).toContain(s);
    expect(h).toContain('Difficulty is based only on distance and climb. It doesn’t account for terrain, weather or conditions.');
    expect(h).toMatch(/<button[^>]*disabled[^>]*>Drive time: later/);
    expect(h).not.toContain('Mild');
  });
  it('replaces the rows with results while a filter is on, with a count', () => {
    const h = html({ filtersOpen: true, filters: { ...NO_FILTERS, difficulty: 'Hard' }, results: trails.slice(0, 2) });
    expect(h).toContain('2 trails');
    expect(h).not.toContain('Top picks');
  });
  it('says what matched nothing', () => { expect(html({ results: [] })).toContain('No trails match these filters.'); });
});

describe('Home: accessibility basics', () => {
  const h = html({ filtersOpen: true });
  it('labels every button and gives every image text or hides it', () => {
    for (const m of h.matchAll(/<button\b[^>]*>(.*?)<\/button>/gs)) {
      const label = /aria-label="[^"]+"/.test(m[0]) || text(m[1]).replace(/[|\s]/g, '').length > 0;
      expect(label, m[0]).toBe(true);
    }
    for (const m of h.matchAll(/<img\b[^>]*>/g)) expect(/alt=/.test(m[0]) && (/aria-hidden="true"/.test(m[0]) || /alt="[^"]+"/.test(m[0]))).toBe(true);
  });
  it('names its landmarks and groups', () => {
    expect(h).toContain('aria-labelledby="row-top"');
    expect(h).toContain('aria-label="Filter and sort"');
    expect(h).toContain('role="group" aria-label="Difficulty"');
  });
  it('keeps reading order: header, search, filters, rows, coverage', () => {
    const o = ['Ridgeline', 'aria-label="Search"', 'id="home-filters"', 'row-top', 'More regions coming.'].map((s) => h.indexOf(s));
    expect(o).toEqual([...o].sort((a, b) => a - b));
    expect(o.every((i) => i >= 0)).toBe(true);
  });
});

describe('Home: copy for the device', () => {
  it('says "device" on the web (the native apps say "phone")', () => {
    const off = html({ mode: 'offline', saved: [], collections: [] });
    expect(off).toContain('Nothing saved on this device yet.');
    expect(html({ mode: 'offline', saved: [savedItem(0, true)] })).toContain('Saved on this device');
  });
  it('rounds gain to 50 ft, with no decimals', () => {
    for (const m of html().matchAll(/About ([\d,]+) ft gain/g)) expect(Number(m[1].replace(',', '')) % 50).toBe(0);
  });
});

describe('Home: no dead ends and structure', () => {
  it('offers "Browse all trails" when trails fail to load and when outside coverage', () => {
    expect(html({ mode: 'error', collections: [] })).toContain('Browse all trails');
    expect(html({ mode: 'outside', collections: [], area: null, nearestCovered: null })).toContain('Browse all trails');
    expect(html()).not.toContain('Browse all trails');
  });
  it('has one h1: the wordmark when ready, the empty-state title when outside coverage', () => {
    expect(html().match(/<h1/g)).toHaveLength(1);
    expect(html({ mode: 'outside', collections: [], area: null }).match(/<h1/g)).toHaveLength(1);
  });
});

describe('Home: dogs on cards', () => {
  it('says Dogs: tagged yes on a tagged trail and keeps the row subtitle', () => {
    const t = { ...trails[3], highlights: ['dogs'] };
    const h = html({ collections: [{ id: 'dogs', title: 'Dog-friendly', sub: 'Dogs tagged Yes in OpenStreetMap', pick: () => true, trails: [t] }] });
    expect(h).toContain('Dogs: tagged yes');
    expect(h).toContain('Dogs tagged Yes in OpenStreetMap');
  });
  it('says Dogs: Unknown inside a national park', () => {
    const [x0, y0] = trails[3].coords[0]; // moved to Mount Rainier National Park
    const t = { ...trails[3], highlights: ['dogs'], trailhead: undefined, coords: trails[3].coords.map(([x, y]) => [x - x0 - 121.73, y - y0 + 46.8] as [number, number]) };
    const h = html({ collections: [{ id: 'top', title: 'Top picks', sub: '', pick: () => true, trails: [t] }] });
    expect(h).toContain('Dogs: Unknown');
    expect(h).not.toContain('Dogs: Yes');
  });
});
