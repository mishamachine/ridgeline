// Geometry helpers. Coordinates are [lon, lat] (GeoJSON order).
export type LngLat = [number, number];
export type BBox = { west: number; south: number; east: number; north: number };

const R = 6371008.8; // mean Earth radius, meters
const rad = (d: number) => (d * Math.PI) / 180;

export function haversine(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cumulative distance (m) at each vertex; first is 0. */
export function cumulative(coords: LngLat[]): number[] {
  const out = [0];
  for (let i = 1; i < coords.length; i++) out.push(out[i - 1] + haversine(coords[i - 1], coords[i]));
  return out;
}

export const lineLength = (coords: LngLat[]) => (coords.length < 2 ? 0 : cumulative(coords).at(-1)!);

/**
 * Closest point on the line to p.
 * Returns distance along the line (m) and perpendicular offset (m).
 * Uses a local flat projection per segment, accurate for trail-scale distances.
 */
export function projectOnLine(coords: LngLat[], cum: number[], p: LngLat): { along: number; offset: number; index: number } {
  let best = { along: 0, offset: Infinity, index: 0 };
  const kx = Math.cos(rad(p[1])) * (Math.PI / 180) * R;
  const ky = (Math.PI / 180) * R;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky;
    const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    const d = Math.hypot(cx, cy);
    if (d < best.offset) best = { along: cum[i] + t * (cum[i + 1] - cum[i]), offset: d, index: i };
  }
  return best;
}

/** Point at a given distance along the line. */
export function pointAt(coords: LngLat[], cum: number[], dist: number): LngLat {
  if (dist <= 0) return coords[0];
  const total = cum.at(-1)!;
  if (dist >= total) return coords.at(-1)!;
  let i = 1;
  while (cum[i] < dist) i++;
  const t = (dist - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  const a = coords[i - 1], b = coords[i];
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

/** n evenly spaced points along the line (n >= 2). */
export function resample(coords: LngLat[], n: number): LngLat[] {
  const cum = cumulative(coords);
  const total = cum.at(-1)!;
  return Array.from({ length: n }, (_, k) => pointAt(coords, cum, (total * k) / (n - 1)));
}

export function bboxOf(coords: LngLat[], padMeters = 0): BBox {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [x, y] of coords) {
    west = Math.min(west, x); east = Math.max(east, x);
    south = Math.min(south, y); north = Math.max(north, y);
  }
  const dLat = padMeters / 111320;
  const dLon = padMeters / (111320 * Math.cos(rad((south + north) / 2)));
  return { west: west - dLon, south: south - dLat, east: east + dLon, north: north + dLat };
}

export const lon2tile = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
export const lat2tile = (lat: number, z: number) =>
  Math.floor(((1 - Math.log(Math.tan(rad(lat)) + 1 / Math.cos(rad(lat))) / Math.PI) / 2) * 2 ** z);

/** All [z, x, y] tiles covering the bbox for each zoom in [zmin, zmax]. */
export function tilesForBBox(b: BBox, zmin: number, zmax: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let z = zmin; z <= zmax; z++) {
    const x0 = lon2tile(b.west, z), x1 = lon2tile(b.east, z);
    const y0 = lat2tile(b.north, z), y1 = lat2tile(b.south, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
  }
  return out;
}

/** Hilltop DEM pixels are 90 m wide, so a switchback trail reads up and down by tens of metres that are not there. */
export const ASCENT_NOISE_M = 8;

/** Running median over `w` points. Removes one-sample DEM spikes without moving real slopes; the two end values stay as measured. Short series are left alone. */
export function medianSmooth(elev: number[], w = 5): number[] {
  if (elev.length < 12) return elev;
  const h = w >> 1;
  return elev.map((v, i) => {
    if (i === 0 || i === elev.length - 1) return v;
    const a = elev.slice(Math.max(0, i - h), i + h + 1).sort((x, y) => x - y);
    return a[a.length >> 1];
  });
}

/**
 * Total ascent from an elevation series (m): median-smoothed, then a climb only counts once the profile has
 * risen `noise` m from its last low, and a drop only once it has fallen `noise` m from its last high.
 */
export function totalAscent(elev: number[], noise = ASCENT_NOISE_M): number {
  if (elev.length < 2) return 0;
  const s = medianSmooth(elev);
  let gain = 0, lo = s[0], hi = s[0], up = false;
  for (const v of s) {
    if (up) {
      if (v > hi) hi = v;
      else if (hi - v >= noise) { gain += hi - lo; up = false; lo = v; }
    } else {
      if (v < lo) lo = v;
      else if (v - lo >= noise) { up = true; hi = v; }
    }
  }
  return up ? gain + (hi - lo) : gain;
}

export const M_TO_MI = 0.000621371;
export const M_TO_FT = 3.28084;
