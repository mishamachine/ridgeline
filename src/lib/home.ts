// Home screen logic: where we cover, where to start, which trails go in which row. No React, no network except our own hosted files.
import { cellsFor, fetchCellTrails, getIndex, type CellIndex } from './cells';
import { haversine, M_TO_MI, type BBox, type LngLat } from './geo';
import { level, roundTripM } from './plan';
import { filterTrails, rankTrails } from './quality';
import { trailheadOf } from './maps';
import { dogsStatus } from './parks';
import type { Units } from './settings';
import type { Difficulty, Trail } from './trails';

/** A region we can name. `center` is a covered spot inside it, taken from the data. */
export interface Region { code: string; name: string; center: LngLat; cells: number }

/**
 * Optional `regions` list in index.json (a future data build can write it). When it is absent, regions are worked out
 * from the covered cells against the reference table below.
 */
export interface IndexRegion { code: string; name: string; center?: LngLat }
type IndexWithRegions = CellIndex & { regions?: IndexRegion[] };

/**
 * Reference geography only: names, rough boxes, time zones and a rough population rank. It says nothing about coverage:
 * a region is listed on Home only when the hosted data has a cell inside it. Boxes are approximate and do not overlap
 * (the Washington/Oregon edge is drawn at 46.0 N, near the Columbia River). Population is only used to order ties.
 */
interface RefRegion { code: string; name: string; bbox: [number, number, number, number]; tz: string[]; pop: number }
export const REGION_REFERENCE: RefRegion[] = [
  { code: 'WA', name: 'Washington', bbox: [-124.9, 46.0, -116.9, 49.1], tz: ['America/Los_Angeles'], pop: 8 },
  { code: 'OR', name: 'Oregon', bbox: [-124.7, 42.0, -116.4, 46.0], tz: ['America/Los_Angeles', 'America/Boise'], pop: 4 },
  { code: 'CA', name: 'California', bbox: [-124.5, 32.5, -114.1, 42.0], tz: ['America/Los_Angeles'], pop: 39 },
  { code: 'BC', name: 'British Columbia', bbox: [-139.1, 48.2, -114.0, 60.0], tz: ['America/Vancouver', 'America/Dawson_Creek', 'America/Fort_Nelson', 'America/Creston'], pop: 5 },
];

const cellCenter = (key: string, size: number): LngLat | null => {
  const [x, y] = key.split('_').map(Number);
  return Number.isFinite(x) && Number.isFinite(y) ? [(x + 0.5) * size - 180, (y + 0.5) * size - 90] : null;
};

/** Covered regions, from the hosted index. Empty when the index is missing. */
export function coverageRegions(index: IndexWithRegions | null): Region[] {
  if (!index) return [];
  const centers = index.cells.map((k) => cellCenter(k, index.cell)).filter((c): c is LngLat => !!c);
  if (index.regions?.length) {
    return index.regions.flatMap((r) => { const center = r.center ?? centers[0]; return center ? [{ code: r.code, name: r.name, center, cells: centers.length }] : []; }); // no centre, no region
  }
  const out: Region[] = [];
  for (const ref of REGION_REFERENCE) {
    const [w, s, e, n] = ref.bbox;
    const inside = centers.filter((c) => c[0] >= w && c[0] < e && c[1] >= s && c[1] < n);
    if (!inside.length) continue;
    const mean: LngLat = [inside.reduce((a, c) => a + c[0], 0) / inside.length, inside.reduce((a, c) => a + c[1], 0) / inside.length];
    const center = inside.reduce((best, c) => (haversine(c, mean) < haversine(best, mean) ? c : best), inside[0]);
    out.push({ code: ref.code, name: ref.name, center, cells: inside.length });
  }
  return out;
};

/** First visit: the most populous covered region that uses the device's time zone, else the most populous covered region. Never IP-based. */
export function defaultRegion(regions: Region[], timeZone: string | undefined): Region | null {
  if (!regions.length) return null;
  const pop = (r: Region) => REGION_REFERENCE.find((x) => x.code === r.code)?.pop ?? 0;
  const byPop = (a: Region, b: Region) => pop(b) - pop(a);
  const inZone = regions.filter((r) => timeZone && REGION_REFERENCE.find((x) => x.code === r.code)?.tz.includes(timeZone));
  return [...(inZone.length ? inZone : regions)].sort(byPop)[0];
}

/** Name of the reference region a point lies in (names only: says nothing about coverage). */
export const regionNameAt = (lon: number, lat: number): string | null =>
  REGION_REFERENCE.find(({ bbox: [w, s, e, n] }) => lon >= w && lon < e && lat >= s && lat < n)?.name ?? null;

export const deviceTimeZone = (): string | undefined => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; }
};

export function nearestRegion(regions: Region[], p: LngLat): Region | null {
  return [...regions].sort((a, b) => haversine(p, a.center) - haversine(p, b.center))[0] ?? null;
}

/** "Trails in WA, OR and CA. More regions coming." The list is whatever the data covers. */
export function coverageLine(regions: Region[]): string {
  if (!regions.length) return 'More regions coming.';
  const codes = regions.map((r) => r.code);
  const list = codes.length === 1 ? codes[0] : `${codes.slice(0, -1).join(', ')} and ${codes.at(-1)}`;
  return `Trails in ${list}. More regions coming.`;
}

export const greeting = (d = new Date()) => {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

/** Is there hosted data within a short drive of this point? */
export function isCovered(index: CellIndex | null, p: LngLat): boolean {
  if (!index) return false;
  const box: BBox = { west: p[0] - 0.1, east: p[0] + 0.1, south: p[1] - 0.07, north: p[1] + 0.07 };
  const have = new Set(index.cells);
  return cellsFor(box, index.cell).some((c) => have.has(c));
}

export type HomeLoad =
  | { kind: 'ok'; trails: Trail[] }
  | { kind: 'outside' }
  | { kind: 'unavailable' };

/** Trails around a point from our own hosted cells only (no public map or trail servers). */
export async function loadAround(p: LngLat, signal?: AbortSignal): Promise<HomeLoad> {
  const index = await getIndex();
  if (!index) return { kind: 'unavailable' };
  if (!isCovered(index, p)) return { kind: 'outside' };
  const trails = await fetchCellTrails({ west: p[0] - 0.1, east: p[0] + 0.1, south: p[1] - 0.07, north: p[1] + 0.07 }, signal);
  return trails ? { kind: 'ok', trails } : { kind: 'outside' };
}

export const roundTripMi = (t: Trail) => roundTripM(t) * M_TO_MI;
const has = (t: Trail, kind: string) => !!t.highlights?.includes(kind); // firm tags only, never "maybe"

export interface CollectionDef { id: 'top' | 'view' | 'dogs' | 'falls'; title: string; sub: string; pick: (t: Trail) => boolean }
export const COLLECTIONS: CollectionDef[] = [
  { id: 'top', title: 'Top picks', sub: 'Ranked by Ridgeline’s trail score', pick: () => true },
  { id: 'view', title: 'Short with a view', sub: 'Under 3 mi, views tagged in OpenStreetMap', pick: (t) => roundTripMi(t) < 3 && has(t, 'view') },
  { id: 'dogs', title: 'Dog-friendly', sub: 'Dogs tagged Yes in OpenStreetMap', pick: (t) => dogsStatus(t) === 'yes' },
  { id: 'falls', title: 'Waterfalls', sub: 'Waterfall tagged in OpenStreetMap', pick: (t) => has(t, 'falls') },
];
export const HOW_WE_RANK = 'Based on length, climb and what OpenStreetMap records about the trail. Not a review or a safety rating.';
export const DIFFICULTY_NOTE = 'Difficulty is based only on distance and climb. It doesn’t account for terrain, weather or conditions.';

export interface Collection extends CollectionDef { trails: Trail[] }
const ROW_MAX = 8;
/** A row with fewer trails than this is left out: two cards do not make a collection. */
export const ROW_MIN = 3;

/** Rows of up to eight trails, best first. A row with fewer than ROW_MIN trails is left out. */
export function buildCollections(trails: Trail[], origin?: LngLat): Collection[] {
  // A trail whose shown numbers are over 10% from its stored full-line figure stays out of the rows (it remains in search, All trails and on the map).
  const ranked = rankTrails(filterTrails(trails.filter((t) => !t.statsMismatch)), origin);
  return COLLECTIONS.map((c) => ({ ...c, trails: ranked.filter(c.pick).slice(0, ROW_MAX) })).filter((c) => c.trails.length >= ROW_MIN);
}

export type LengthBucket = 'under3' | '3to6' | '6to10' | '10plus';
export const LENGTHS: { id: LengthBucket; label: string }[] = [
  { id: 'under3', label: 'Under 3 mi' }, { id: '3to6', label: '3–6 mi' }, { id: '6to10', label: '6–10 mi' }, { id: '10plus', label: '10+ mi' },
];
export const DIFFICULTIES: Difficulty[] = ['Easy', 'Moderate', 'Hard'];
export type SortKey = 'best' | 'nearest' | 'shortest';
export const SORTS: { id: SortKey; label: string }[] = [{ id: 'best', label: 'Best' }, { id: 'nearest', label: 'Nearest' }, { id: 'shortest', label: 'Shortest' }];

export interface HomeFilters { length: LengthBucket | null; difficulty: Difficulty | null; dogs: boolean; sort: SortKey }
export const NO_FILTERS: HomeFilters = { length: null, difficulty: null, dogs: false, sort: 'best' };
export const isFiltering = (f: HomeFilters) => f.length !== null || f.difficulty !== null || f.dogs || f.sort !== 'best';

/** Metric buckets break at 5, 10 and 15 km of round trip (imperial: 3, 6 and 10 mi). */
export function inBucket(t: Trail, b: LengthBucket, units: Units = 'imperial'): boolean {
  if (units === 'metric') { const k = roundTripM(t) / 1000; return b === 'under3' ? k < 5 : b === '3to6' ? k >= 5 && k < 10 : b === '6to10' ? k >= 10 && k < 15 : k >= 15; }
  const m = roundTripMi(t);
  return b === 'under3' ? m < 3 : b === '3to6' ? m >= 3 && m < 6 : b === '6to10' ? m >= 6 && m < 10 : m >= 10;
}

export function applyFilters(trails: Trail[], f: HomeFilters, origin?: LngLat, units: Units = 'imperial'): Trail[] {
  const out = rankTrails(filterTrails(trails), origin).filter((t) =>
    (!f.length || inBucket(t, f.length, units)) && (!f.difficulty || level(t) === f.difficulty) && (!f.dogs || dogsStatus(t) === 'yes'));
  const away = (t: Trail) => { const th = trailheadOf(t); return origin ? haversine(origin, [th.lon, th.lat]) : 0; };
  if (f.sort === 'nearest' && origin) out.sort((a, b) => away(a) - away(b));
  if (f.sort === 'shortest') out.sort((a, b) => roundTripM(a) - roundTripM(b));
  return out;
}
