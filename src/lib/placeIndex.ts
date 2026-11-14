// Place index for search (towns, peaks, parks, trailheads), built from OpenStreetMap only by scripts/place_index.py.
// One shard per covered region: places/<region>.json = { v: 1, region, e: [[name, kind, lat, lon], ...] }, lat/lon as 1e-5 integers.
// Not wired into the search UI yet; it will replace the temporary Nominatim place search.
import { haversine, type LngLat } from './geo';
import { getIndex } from './cells';
import { byDistance, distanceDeg, regionsOf, type CoverageRegion } from './coverage';
import { norm } from './nameIndex';
import { trailBase } from './native/trailBase';

/** c city, t town, v village, h hamlet, p peak, a park or protected area, r trailhead. */
export type PlaceKind = 'c' | 't' | 'v' | 'h' | 'p' | 'a' | 'r';
export type PlaceRow = [string, PlaceKind, number, number];
export interface PlaceHit { name: string; kind: PlaceKind; lon: number; lat: number; region: string }

const NEAR_DEG = 1.5;
const SCALE = 1e5;
const RANK: Record<PlaceKind, number> = { c: 6, t: 5, a: 4, p: 3, v: 2, h: 1, r: 0 };
const shards = new Map<string, Promise<PlaceHit[]>>();

export function decodePlaces(file: { region?: string; e?: PlaceRow[] }): PlaceHit[] {
  return (file.e ?? []).map(([name, kind, lat, lon]) => ({ name, kind, lat: lat / SCALE, lon: lon / SCALE, region: file.region ?? '' }));
}

function shard(r: CoverageRegion, base: string): Promise<PlaceHit[]> {
  let p = shards.get(r.id);
  if (!p) {
    p = fetch(`${base}${r.places ?? `places/${r.id}.json`}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((f) => (f ? decodePlaces(f) : []))
      .catch(() => [] as PlaceHit[])
      .then((e) => { if (!e.length) shards.delete(r.id); return e; });
    shards.set(r.id, p);
  }
  return p;
}

/** Places for the nearest covered region and those within ~150 km of `near`; every region without it. Empty when none is deployed. */
export async function loadPlaces(near?: LngLat): Promise<PlaceHit[]> {
  const index = await getIndex().catch(() => null);
  const base = index?.base ?? trailBase();
  const regions = regionsOf(index).filter((r) => r.places);
  const pick = near ? byDistance(regions, near).filter((r, i) => i === 0 || distanceDeg(r, near) <= NEAR_DEG) : regions;
  return (await Promise.all(pick.map((r) => shard(r, base)))).flat();
}

/** Best matches for typed text: exact, then starts-with, then word-starts, bigger places first, nearer ones first. */
export function searchPlaceIndex(places: PlaceHit[], query: string, limit = 5, near?: LngLat): PlaceHit[] {
  const q = norm(query);
  if (q.length < 2) return [];
  const scored: { p: PlaceHit; s: number }[] = [];
  for (const p of places) {
    const n = norm(p.name);
    let s = 0;
    if (n === q) s = 100;
    else if (n.startsWith(q)) s = 80;
    else if (n.split(' ').some((w) => w.startsWith(q))) s = 60;
    if (!s) continue;
    s += RANK[p.kind];
    if (near) s -= Math.min(6, haversine(near, [p.lon, p.lat]) / 40000);
    scored.push({ p, s });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.p);
}
