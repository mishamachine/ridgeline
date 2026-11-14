// What Enter does in Home's search box. Typing never reaches this file: type-ahead is searchNames over our own index.
import { searchPlaces, type Place } from './geocode';
import type { LngLat } from './geo';
import { norm, searchNames, type NameEntry } from './nameIndex';

export type EnterResult =
  | { kind: 'trail'; entry: NameEntry }                 // the name matches a trail exactly: open it
  | { kind: 'places'; places: Place[]; trails: NameEntry[] }
  | { kind: 'none' }
  | { kind: 'offline' };

const MIN_GAP_MS = 1100; // Nominatim's limit is 1 request per second; stay just over it
let lastStart = 0;
let chain: Promise<unknown> = Promise.resolve();

/**
 * BRIDGE until the build-time place index ships: one Nominatim lookup per Enter, never on keystrokes, never autocomplete,
 * at most one request per second across the whole app session. Remove with the place index.
 */
export function throttledPlaceSearch(q: string, now: () => number = Date.now): Promise<Place[]> {
  const run = chain.then(async () => {
    const wait = lastStart + MIN_GAP_MS - now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastStart = now();
    return searchPlaces(q);
  });
  chain = run.catch(() => {});
  return run;
}

/** Exact trail name: open it. Otherwise one place lookup, shown with any trail-name matches. */
export async function onEnter(q: string, names: NameEntry[], near: LngLat | undefined, online: boolean): Promise<EnterResult> {
  const query = q.trim();
  if (query.length < 2) return { kind: 'none' };
  const trails = searchNames(names, query, 3, near);
  const exact = trails.find((t) => norm(t[1]) === norm(query));
  if (exact) return { kind: 'trail', entry: exact };
  if (!online) return trails.length ? { kind: 'places', places: [], trails } : { kind: 'offline' };
  const places = await throttledPlaceSearch(query);
  return places.length || trails.length ? { kind: 'places', places, trails } : { kind: 'none' };
}

export const resetThrottleForTests = () => { lastStart = 0; chain = Promise.resolve(); };
