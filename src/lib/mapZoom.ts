// Zoom limits for the maps. The vector tiles stop at z14; the map scales that data up beyond it ("overzoom"), which
// stays readable to about z17 and is free, because it needs no new tiles.
export const SOURCE_MAX_ZOOM = 14;
export const MAP_MAX_ZOOM = 17;
export const MAP_MIN_ZOOM = 9;
/** The zoom range "Save offline" stores (src/lib/offline.ts); below it a saved map has no tiles. */
export const SAVED_ZOOMS: [number, number] = [10, SOURCE_MAX_ZOOM];

/**
 * Min and max zoom for a map. With no signal, zooming out past the lowest saved zoom would show blank paper, so the
 * floor rises to it. Zooming in is always fine (overzoom of the z14 tiles).
 */
export function zoomLimits({ online = true }: { online?: boolean } = {}) {
  return { minZoom: online ? MAP_MIN_ZOOM : SAVED_ZOOMS[0], maxZoom: MAP_MAX_ZOOM };
}

/** The minimal map surface the zoom buttons use. */
export interface Zoomable {
  getZoom(): number;
  getMinZoom(): number;
  getMaxZoom(): number;
  zoomTo(zoom: number, o?: { duration?: number }): unknown;
}

const pending = new WeakMap<object, { target: number; at: number }>();
/**
 * One step in or out, about the map centre. It only zooms: it never pans, so Navigate's follow mode stays on.
 * Quick repeat taps add up (each starts from where the last one is heading, not from the half-way point).
 */
export function zoomStep(map: Zoomable, dir: 1 | -1, now = Date.now()) {
  const last = pending.get(map);
  const base = last && now - last.at < 400 ? last.target : map.getZoom();
  const target = Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), base + dir));
  pending.set(map, { target, at: now });
  map.zoomTo(target, { duration: 200 });
}

/** Which end of the range the map is at, for greying out a button. */
export function atZoomLimit(map: Zoomable): { min: boolean; max: boolean } {
  const z = map.getZoom();
  return { min: z <= map.getMinZoom() + 0.01, max: z >= map.getMaxZoom() - 0.01 };
}

/** Follow mode (Navigate) ends only when the person drags the map. Zoom by button, pinch or wheel keeps it. */
export const breaksFollow = (event: 'dragstart' | 'zoomstart' | 'zoom' | 'zoomend' | 'moveend' | 'rotate' | 'pitch') => event === 'dragstart';
