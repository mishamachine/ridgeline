// Trail discovery from OpenStreetMap via the Overpass API.
import { BBox, LngLat, haversine, lineLength, cumulative, totalAscent, M_TO_FT, M_TO_MI } from './geo';

export type Difficulty = 'Easy' | 'Moderate' | 'Hard';

export interface Trail {
  id: string;
  name: string;
  coords: LngLat[];
  lengthM: number;
  loop: boolean;
  /** Route crosses the edge of the area searched, so only a section is shown. */
  partial: boolean;
  osmUrl: string;
  tags: Record<string, string>;
  /** Elevation (m) at 100 evenly spaced points from start to end. Absent when the data has none. */
  elevation?: number[];
  ascentM?: number;
  descentM?: number;
  /** Hosted v2 data: the shown numbers differ by over 10% from the full-line figure stored at build time, or could not be matched to one. Kept out of Home's collection rows. */
  statsMismatch?: boolean;
  /**
   * Highlight kinds from the hosted data: view, lake, falls, beach, bikes, horses, dogs, nodogs, climb, long.
   * A trailing '?' means partial or mixed evidence. Absent for Overpass trails and old files.
   */
  highlights?: string[];
  /** Where to start: nearest car park to a trail end if the data has one, else the start of the line. */
  trailhead?: LngLat;
  trailheadIsParking?: boolean;
  /** Places where another path meets the trail, in order from the start. Absent when the data has none. */
  junctions?: Junction[];
}

/** `along` is metres from the start of `coords`; each branch has a point about 20 m along it. */
export interface Junction { along: number; branches: { name?: string; point: LngLat }[] }

export const HIGHLIGHT_CLIMB_FT = 2500;
export const HIGHLIGHT_LONG_MI = 8;

// Public Overpass servers, tried in order. The main one is often at capacity.
export const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const SERVER_TIMEOUT_MS = 30000;
const JOIN_TOLERANCE_M = 25;
const MIN_TRAIL_M = 500;
const LOOP_TOLERANCE_M = 100;

type OsmPoint = { lat: number; lon: number } | null;
type OsmWay = { type: 'way'; id: number; geometry?: OsmPoint[]; tags?: Record<string, string> };
type OsmRel = {
  type: 'relation';
  id: number;
  tags?: Record<string, string>;
  members: { type: string; ref: number; role: string; geometry?: OsmPoint[] }[];
};
type OsmElement = OsmWay | OsmRel;

export function overpassQuery(b: BBox): string {
  const bb = `${b.south.toFixed(5)},${b.west.toFixed(5)},${b.north.toFixed(5)},${b.east.toFixed(5)}`;
  return `[out:json][timeout:25];
(
  relation["route"~"^(hiking|foot)$"](${bb});
  way["highway"~"^(path|footway|track|bridleway)$"]["name"](${bb});
);
out body geom(${bb});`;
}

export async function fetchTrails(b: BBox, signal?: AbortSignal): Promise<Trail[]> {
  const body = new URLSearchParams({ data: overpassQuery(b) });
  let lastError = 'Trail search failed.';
  for (const server of OVERPASS_SERVERS) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), SERVER_TIMEOUT_MS);
    const onAbort = () => timeout.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      const res = await fetch(server, { method: 'POST', body, signal: timeout.signal });
      if (res.ok) {
        const json = await res.json();
        return parseOverpass(json.elements ?? []);
      }
      lastError = `Trail search failed (${res.status}).`; // busy or down: try the next server
    } catch (e) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      lastError = 'Trail servers are busy. Try again in a minute.';
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
  throw new Error(lastError === 'Trail search failed.' ? lastError : 'Trail servers are busy. Try again in a minute.');
}

/** Split a geometry list at missing points (nodes outside the search area). */
function toSegments(geom: OsmPoint[] | undefined): { segs: LngLat[][]; clipped: boolean } {
  const segs: LngLat[][] = [];
  let cur: LngLat[] = [];
  let clipped = false;
  for (const p of geom ?? []) {
    if (!p) { clipped = true; if (cur.length > 1) segs.push(cur); cur = []; continue; }
    cur.push([p.lon, p.lat]);
  }
  if (cur.length > 1) segs.push(cur);
  if (!geom || geom.length === 0) clipped = true;
  return { segs, clipped };
}

/** Join segments end-to-end into continuous lines. Returns chains, longest first. */
export function chainSegments(input: LngLat[][]): LngLat[][] {
  const pool = input.filter((s) => s.length > 1).map((s) => [...s]);
  pool.sort((a, b) => lineLength(b) - lineLength(a));
  const chains: LngLat[][] = [];
  while (pool.length) {
    let chain = pool.shift()!;
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i];
        const start = chain[0], end = chain.at(-1)!;
        let joined: LngLat[] | null = null;
        if (haversine(end, s[0]) < JOIN_TOLERANCE_M) joined = [...chain, ...s.slice(1)];
        else if (haversine(end, s.at(-1)!) < JOIN_TOLERANCE_M) joined = [...chain, ...[...s].reverse().slice(1)];
        else if (haversine(start, s.at(-1)!) < JOIN_TOLERANCE_M) joined = [...s, ...chain.slice(1)];
        else if (haversine(start, s[0]) < JOIN_TOLERANCE_M) joined = [...[...s].reverse(), ...chain.slice(1)];
        if (joined) { chain = joined; pool.splice(i, 1); grew = true; break; }
      }
    }
    chains.push(chain);
  }
  return chains.sort((a, b) => lineLength(b) - lineLength(a));
}

function makeTrail(id: string, name: string, coords: LngLat[], partial: boolean, osmUrl: string, tags: Record<string, string>): Trail {
  return {
    id, name, coords, partial, osmUrl, tags,
    lengthM: lineLength(coords),
    loop: haversine(coords[0], coords.at(-1)!) < LOOP_TOLERANCE_M,
  };
}

/** Key of a named path's stored stats: "w<name>|<lon,lat>|<lon,lat>", the two ends sorted as text. One definition for the build (trail-stats.mjs), cells.ts and parseOverpass. */
export function pathStatKey(name: string, a: LngLat, b: LngLat): string {
  const ends = [a, b].map((c) => `${c[0].toFixed(5)},${c[1].toFixed(5)}`).sort();
  return `w${name}|${ends.join('|')}`;
}

/** `stored` (hosted v2 data): each route's length measured on the full line, key "r<id>"; the minimum length is judged on it for a complete route; named paths use key "w<name>|<lon,lat>|<lon,lat>" (the two ends sorted as text). */
export function parseOverpass(elements: OsmElement[], stored?: ReadonlyMap<string, number[]>): Trail[] {
  const trails: Trail[] = [];
  const memberWayIds = new Set<number>();
  const keepTags = (t: Record<string, string> = {}) => {
    const out: Record<string, string> = {};
    for (const k of ['sac_scale', 'surface', 'dog', 'operator', 'description', 'trail_visibility', 'website']) if (t[k]) out[k] = t[k];
    return out;
  };

  for (const el of elements) {
    if (el.type !== 'relation') continue;
    const name = el.tags?.name ?? el.tags?.ref;
    if (!name) continue;
    let clipped = false;
    const segs: LngLat[][] = [];
    for (const m of el.members) {
      if (m.type !== 'way') continue;
      memberWayIds.add(m.ref);
      const r = toSegments(m.geometry);
      clipped ||= r.clipped;
      segs.push(...r.segs);
    }
    const chain = chainSegments(segs)[0];
    // A complete route is judged on its full-line length; one clipped by the view on the line that is here, so a sliver stays out.
    if (!chain || ((!clipped ? stored?.get(`r${el.id}`)?.[0] : undefined) ?? lineLength(chain)) < MIN_TRAIL_M) continue;
    trails.push(makeTrail(`osm-r${el.id}`, name, chain, clipped, `https://www.openstreetmap.org/relation/${el.id}`, keepTags(el.tags)));
  }

  // Named paths not already part of a route: group by name, then chain.
  const byName = new Map<string, { segs: LngLat[][]; ids: number[]; clipped: boolean; tags: Record<string, string> }>();
  for (const el of elements) {
    if (el.type !== 'way' || memberWayIds.has(el.id) || !el.tags?.name) continue;
    const g = byName.get(el.tags.name) ?? { segs: [], ids: [], clipped: false, tags: {} };
    const r = toSegments(el.geometry);
    g.segs.push(...r.segs);
    g.ids.push(el.id);
    g.clipped ||= r.clipped;
    g.tags = { ...keepTags(el.tags), ...g.tags };
    byName.set(el.tags.name, g);
  }
  const relNames = new Set(trails.map((t) => t.name.toLowerCase()));
  for (const [name, g] of byName) {
    if (relNames.has(name.toLowerCase())) continue;
    chainSegments(g.segs).forEach((chain, i) => {
      // Same rule as for routes: a complete path is judged on its full-line length (key: name, then its two ends, sorted as text),
      // but only when that agrees with the drawn chain (within 8%, as in cells.ts): a stored figure from a different stitching is ignored.
      const full = !g.clipped ? stored?.get(pathStatKey(name, chain[0], chain.at(-1)!))?.[0] : undefined;
      const drawn = lineLength(chain);
      const ok = full != null && Math.abs(drawn / full - 1) <= 0.08;
      if ((ok ? full : drawn) < MIN_TRAIL_M) return;
      const id = `osm-w${Math.min(...g.ids)}-${i}`;
      trails.push(makeTrail(id, name, chain, g.clipped, `https://www.openstreetmap.org/way/${Math.min(...g.ids)}`, g.tags));
    });
  }
  return trails.sort((a, b) => b.lengthM - a.lengthM);
}

/**
 * Difficulty from distance and climb, using the Shenandoah National Park
 * rating: sqrt(2 × gain_ft × distance_mi). Under 50 easy, over 150 hard.
 */
export function difficulty(t: Pick<Trail, 'lengthM' | 'ascentM'>): Difficulty | null {
  if (t.ascentM == null) return null;
  const score = Math.sqrt(2 * t.ascentM * M_TO_FT * t.lengthM * M_TO_MI);
  return score < 50 ? 'Easy' : score <= 150 ? 'Moderate' : 'Hard';
}

/** Naismith's rule: 3 mph plus 30 minutes per 1,000 ft of climb. Returns minutes. */
export function estimateMinutes(distanceM: number, ascentM: number): number {
  return (distanceM * M_TO_MI / 3) * 60 + (ascentM * M_TO_FT / 1000) * 30;
}

/** Remaining climb (m) from a position along the trail, using the elevation profile. */
export function climbAhead(t: Trail, alongM: number): number {
  if (!t.elevation) return 0;
  const n = t.elevation.length;
  const k = Math.min(n - 1, Math.max(0, Math.floor((alongM / t.lengthM) * (n - 1))));
  return totalAscent(t.elevation.slice(k));
}

// ---- Elevation ----
// Elevation comes from the hosted trail files (Copernicus DEM GLO-90, sampled at build time by
// scripts/elevation.py), one value per vertex. Trails found through Overpass have none.
export const PROFILE_POINTS = 100;

/**
 * Elevation (m) at `n` evenly spaced distances along a line, interpolated from per-vertex heights.
 * Same shape as the old run-time profile: first value at the start, last at the end.
 */
export function profileFromVertices(coords: LngLat[], z: number[], n = PROFILE_POINTS): number[] {
  const cum = cumulative(coords);
  const total = cum.at(-1) ?? 0;
  if (coords.length < 2 || z.length !== coords.length || total <= 0) return [];
  const out: number[] = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const d = (total * k) / (n - 1);
    while (seg < coords.length - 2 && cum[seg + 1] < d) seg++;
    const span = cum[seg + 1] - cum[seg];
    const f = span > 0 ? Math.min(1, Math.max(0, (d - cum[seg]) / span)) : 0;
    out.push(Math.round(z[seg] + (z[seg + 1] - z[seg]) * f));
  }
  return out;
}

export function withElevation(t: Trail, elevation: number[]): Trail {
  return {
    ...t,
    elevation,
    ascentM: totalAscent(elevation),
    descentM: totalAscent([...elevation].reverse()),
  };
}

export { cumulative };
