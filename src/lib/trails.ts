// Trail discovery from OpenStreetMap via the Overpass API.
import { BBox, LngLat, haversine, lineLength, cumulative, resample, totalAscent, M_TO_FT, M_TO_MI } from './geo';

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
  /** Elevation (m) at 100 evenly spaced points from start to end. */
  elevation?: number[];
  ascentM?: number;
  descentM?: number;
}

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

export function parseOverpass(elements: OsmElement[]): Trail[] {
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
    if (!chain || lineLength(chain) < MIN_TRAIL_M) continue;
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
      if (lineLength(chain) < MIN_TRAIL_M) return;
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

// ---- Elevation (Open-Meteo, Copernicus DEM GLO-90) ----
const ELEVATION_API = 'https://api.open-meteo.com/v1/elevation';

export async function fetchElevation(coords: LngLat[], signal?: AbortSignal): Promise<number[]> {
  const pts = resample(coords, 100);
  const lat = pts.map((p) => p[1].toFixed(5)).join(',');
  const lon = pts.map((p) => p[0].toFixed(5)).join(',');
  const res = await fetch(`${ELEVATION_API}?latitude=${lat}&longitude=${lon}`, { signal });
  if (!res.ok) throw new Error('Elevation unavailable');
  const json = await res.json();
  return json.elevation as number[];
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
