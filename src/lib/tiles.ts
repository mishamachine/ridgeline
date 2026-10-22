// Shared constants for map data, used by both the app and the service worker.
export const TILE_HOST = 'tiles.openfreemap.org';
export const TILEJSON_URL = `https://${TILE_HOST}/planet`;
export const GLYPHS_URL = `https://${TILE_HOST}/fonts/{fontstack}/{range}.pbf`;
export const OFFLINE_CACHE = 'rl-offline-v1';
export const RUNTIME_TILE_CACHE = 'rl-tiles-v1';
export const GLYPH_CACHE = 'rl-glyphs-v1';
export const CELL_CACHE = 'rl-trail-cells-v1';
export const FONTSTACKS = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'];
export const GLYPH_RANGES = ['0-255', '256-511', '8192-8447'];

const TILE_RE = /\/planet\/[^/]+\/(\d+)\/(\d+)\/(\d+)\.pbf$/;

/**
 * Tile URLs carry a weekly data version (…/planet/20261018_080001_pt/z/x/y.pbf).
 * Cache tiles under a version-free key so saved maps keep working after updates.
 */
export function tileCacheKey(url: string): string | null {
  const u = new URL(url);
  if (u.hostname !== TILE_HOST) return null;
  const m = u.pathname.match(TILE_RE);
  return m ? `https://${TILE_HOST}/planet/${m[1]}/${m[2]}/${m[3]}.pbf` : null;
}

export const glyphUrl = (fontstack: string, range: string) =>
  GLYPHS_URL.replace('{fontstack}', encodeURIComponent(fontstack)).replace('{range}', range);
