import type { LngLat } from './geo';

/** Thumbnail box (SVG user units) and the padding kept clear on every side (9%). */
export const SKETCH_SIZE = 96;
export const SKETCH_PAD_FRAC = 0.09;

/**
 * Fit a route's bounds into a square box with equal padding on every side, keeping the
 * aspect ratio (longitude is scaled by cos(latitude)). Returns points in SVG space (y down).
 */
export function fitRoute(coords: LngLat[], size = SKETCH_SIZE, padFrac = SKETCH_PAD_FRAC): [number, number][] {
  if (!coords.length) return [];
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of coords) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  const k = Math.cos(((s + n) / 2) * Math.PI / 180);
  const sx = Math.max((e - w) * k, 1e-6), sy = Math.max(n - s, 1e-6);
  const pad = size * padFrac;
  const scale = Math.min((size - 2 * pad) / sx, (size - 2 * pad) / sy);
  const ox = (size - (e - w) * k * scale) / 2, oy = (size - (n - s) * scale) / 2;
  const step = Math.max(1, Math.floor(coords.length / 60));
  return coords.filter((_, i) => i % step === 0 || i === coords.length - 1)
    .map(([x, y]) => [ox + (x - w) * k * scale, size - oy - (y - s) * scale]);
}
