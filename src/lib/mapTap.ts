// What a tap on the basemap's own paths (not our trail list) should say. No MapLibre import: the map is passed in.
import type { LngLat } from './geo';

export const NOT_LISTED = 'Not in Ridgeline’s trail list yet';
export const BASEMAP_PATH_LAYER = 'path';          // dashed paths and tracks in the basemap style (mapStyle.ts)
const NAME_SOURCE = { source: 'omt', sourceLayer: 'transportation_name' };
const TAP_PX = 10;                                  // how far from the finger a drawn path still counts
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

/** Name of the nearest named path or track line within NAME_PX of the tap, from the loaded tiles. */
export function nearestPathName(map: TapMap, point: Pt): string | undefined {
  let best: { d: number; name: string } | undefined;
  for (const f of map.querySourceFeatures(NAME_SOURCE.source, { sourceLayer: NAME_SOURCE.sourceLayer, filter: ['in', ['get', 'class'], ['literal', ['path', 'track']]] })) {
    const name = typeof f.properties?.name === 'string' ? f.properties.name.trim() : '';
    if (!name) continue;
    for (const line of lines(f.geometry)) {
      const px = line.map((c) => map.project(c));
      for (let i = 1; i < px.length; i++) {
        const d = distToSegment(point, px[i - 1], px[i]);
        if (d <= NAME_PX && (!best || d < best.d)) best = { d, name };
      }
    }
  }
  return best?.name;
}

/** A basemap path under the tap: `{ name }` (name may be absent), or null when the tap is not on a path. */
export function basemapPathAt(map: TapMap, point: Pt): { name?: string } | null {
  const hit = map.queryRenderedFeatures([[point.x - TAP_PX, point.y - TAP_PX], [point.x + TAP_PX, point.y + TAP_PX]], { layers: [BASEMAP_PATH_LAYER] });
  if (!hit.length) return null;
  const own = hit.map((f) => f.properties?.name).find((n): n is string => typeof n === 'string' && !!n.trim());
  return { name: own?.trim() || nearestPathName(map, point) };
}
