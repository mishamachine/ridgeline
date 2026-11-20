// What a tap on the basemap's own paths (not our trail list) should say. No MapLibre import: the map is passed in.
import type { LngLat } from './geo';

export const NOT_LISTED = 'Not in Ridgeline’s trail list yet';
export const BASEMAP_PATH_LAYER = 'path';          // dashed paths and tracks in the basemap style (mapStyle.ts)
const NAME_SOURCE = { source: 'omt', sourceLayer: 'transportation_name' };
export const TAP_PX = 10;                                  // how far from the finger a drawn path still counts
const NAME_PX = 24;                                 // how far a named line may sit from the tap and still name it

type Pt = { x: number; y: number };
type Feat = { properties?: Record<string, unknown> | null; geometry: { type: string; coordinates: unknown } };
export interface TapMap {
  queryRenderedFeatures(geometry: [[number, number], [number, number]], opts: { layers: string[] }): Feat[];
  querySourceFeatures(source: string, opts: { sourceLayer: string; filter?: unknown }): Feat[];
  project(c: LngLat): Pt;
}

const distToSegment = (p: Pt, a: Pt, b: Pt) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

function lines(g: Feat['geometry']): LngLat[][] {
  if (g.type === 'LineString') return [g.coordinates as LngLat[]];
  if (g.type === 'MultiLineString') return g.coordinates as LngLat[][];
  return [];
}

/** Pixel bounding box of a lon/lat line; all four corners are projected so a rotated map still gives a box that contains the line. */
function pixelBox(line: LngLat[], map: Pick<TapMap, 'project'>) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of line) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  const c = [map.project([w, s]), map.project([w, n]), map.project([e, s]), map.project([e, n])];
  return { x0: Math.min(...c.map((p) => p.x)), x1: Math.max(...c.map((p) => p.x)), y0: Math.min(...c.map((p) => p.y)), y1: Math.max(...c.map((p) => p.y)) };
}
const nearBox = (b: ReturnType<typeof pixelBox>, p: Pt, px: number) => p.x >= b.x0 - px && p.x <= b.x1 + px && p.y >= b.y0 - px && p.y <= b.y1 + px;

/** Name of the nearest named path or track line within NAME_PX of the tap, from the loaded tiles. */
export function nearestPathName(map: TapMap, point: Pt): string | undefined {
  let best: { d: number; name: string } | undefined;
  for (const f of map.querySourceFeatures(NAME_SOURCE.source, { sourceLayer: NAME_SOURCE.sourceLayer, filter: ['in', ['get', 'class'], ['literal', ['path', 'track']]] })) {
    const name = typeof f.properties?.name === 'string' ? f.properties.name.trim() : '';
    if (!name) continue;
    for (const line of lines(f.geometry)) {
      if (!nearBox(pixelBox(line, map), point, NAME_PX)) continue;   // cheap reject by bounding box before measuring every segment
      const px = line.map((c) => map.project(c));
      for (let i = 1; i < px.length; i++) {
        const d = distToSegment(point, px[i - 1], px[i]);
        if (d <= NAME_PX && (!best || d < best.d)) best = { d, name };
      }
    }
  }
  return best?.name;
}

/** Lower case, accents and punctuation dropped, spaces collapsed: "Cedar River  Trail." matches "cedar river trail". */
export const normName = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** A basemap path under the tap: `{ name }` (name may be absent), or null when the tap is not on a path. */
export function basemapPathAt(map: TapMap, point: Pt): { name?: string } | null {
  const hit = map.queryRenderedFeatures([[point.x - TAP_PX, point.y - TAP_PX], [point.x + TAP_PX, point.y + TAP_PX]], { layers: [BASEMAP_PATH_LAYER] });
  if (!hit.length) return null;
  const own = hit.map((f) => f.properties?.name).find((n): n is string => typeof n === 'string' && !!n.trim());
  return { name: own?.trim() || nearestPathName(map, point) };
}

export const MATCH_PX = 16;   // a loaded trail with the tapped name must also run within this many px of the tap

/** The loaded trail the tapped path is: same normalised name AND the nearest line within MATCH_PX of the tap, never just the first trail with that name. */
export function matchTrail<T extends { name: string; coords: LngLat[] }>(map: Pick<TapMap, 'project'>, trails: readonly T[], name: string | undefined, point: Pt): T | undefined {
  const n = name ? normName(name) : '';
  if (!n) return undefined;
  let best: { d: number; t: T } | undefined;
  for (const t of trails) {
    if (normName(t.name) !== n || t.coords.length < 2 || !nearBox(pixelBox(t.coords, map), point, MATCH_PX)) continue;
    const px = t.coords.map((c) => map.project(c));
    for (let i = 1; i < px.length; i++) {
      const d = distToSegment(point, px[i - 1], px[i]);
      if (d <= MATCH_PX && (!best || d < best.d)) best = { d, t };
    }
  }
  return best?.t;
}

export type TapOutcome = 'open' | 'hidden' | 'unlisted' | 'wait';
/**
 * What a tap on a basemap path does. `match` is the loaded trail it is, if any; `listed` and `shown` are the ids that pass the junk filter
 * and that also pass the filter chips. Nothing is said while the list is still loading.
 */
export function classifyTap(match: { id: string } | undefined, listed: ReadonlySet<string>, shown: ReadonlySet<string>, loading: boolean): TapOutcome {
  if (loading) return 'wait';
  if (match && shown.has(match.id)) return 'open';
  if (match && listed.has(match.id)) return 'hidden';
  return 'unlisted';
}

export const HIDDEN = 'Hidden by your filters';
