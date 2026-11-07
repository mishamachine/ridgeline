// Turn raw OpenStreetMap ways into a list a hiker would want: drop junk, merge duplicates, best first.
import { haversine, M_TO_MI, type LngLat } from './geo';
import { level, roundTripM } from './plan';
import type { Trail } from './trails';

const MIN_WAY_M = 805; // half a mile; routes (relations) are exempt
const DUP_RADIUS_M = 5000;

const JUNK_WORDS = /\b(private|abandoned|closed|impassable|disused|decommissioned|proposed|under construction|no name|noname|unnamed|unknown|temporary|driveway|sporting clays|shooting range|razed|test|tbd|todo)\b/i;
const NUMBER_ONLY = /^[\d\s./#-]+[A-Za-z]?$/;           // "1263", "5030-612"
const ROAD_CODE = /^(nf|fs|fr|sr|us|i)[- ]?\d+/i;       // "NF-65"
const SHORT_JUNK = /^(path|trail|track|footway|connector|unnamed trail|service road)$/i;

export function isJunkName(name: string): boolean {
  const n = name.trim();
  return n.length < 3 || JUNK_WORDS.test(n) || NUMBER_ONLY.test(n) || ROAD_CODE.test(n) || SHORT_JUNK.test(n);
}

export const isRoute = (t: Pick<Trail, 'id'>) => t.id.startsWith('osm-r');

const center = (t: Trail): LngLat => {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of t.coords) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [(w + e) / 2, (s + n) / 2];
};

/** Higher is better: named routes first, then trails of a sensible day-hike length. */
export function relevance(t: Trail): number {
  const mi = roundTripM(t) * M_TO_MI; // the whole outing: out-and-back counts twice
  let len: number;
  if (mi < 3) len = 60 * (mi / 3);
  else if (mi <= 10) len = 60;
  else len = 60 * Math.max(0, 1 - (mi - 10) / 22); // 30 mi and beyond: nothing
  const hl = Math.min(3, t.highlights?.filter((h) => !h.endsWith('?')).length ?? 0) * 2;
  return (isRoute(t) ? 30 : 0) + len + hl;
}

/** Remove junk names and tiny ways, and merge trails that share a name and sit in the same place. */
export function filterTrails(trails: Trail[]): Trail[] {
  const kept = trails.filter((t) => !isJunkName(t.name) && (isRoute(t) || t.lengthM >= MIN_WAY_M));
  const best: Trail[] = [];
  const byName = new Map<string, Trail[]>();
  for (const t of kept.sort((a, b) => relevance(b) - relevance(a) || b.lengthM - a.lengthM)) {
    const key = t.name.trim().toLowerCase();
    const group = byName.get(key) ?? [];
    const c = center(t);
    if (group.some((g) => haversine(center(g), c) < DUP_RADIUS_M)) continue;
    group.push(t);
    byName.set(key, group);
    best.push(t);
  }
  return best;
}

/** Closeness and suitability on top of relevance: nearer to `origin` is better; Hard trails sit below easier ones of the same kind. */
export function suitability(t: Trail, origin?: LngLat): number {
  let s = relevance(t);
  if (origin) s -= Math.min(40, (haversine(origin, center(t)) * M_TO_MI) * 1.5);
  if (level(t) === 'Hard') s -= 15;
  return s;
}

export const rankTrails = (trails: Trail[], origin?: LngLat) =>
  [...trails].sort((a, b) => suitability(b, origin) - suitability(a, origin) || b.lengthM - a.lengthM);
