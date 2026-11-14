// Which regions the hosted trail data covers. All of it comes from trails/index.json (built from the data), nothing is hard-coded.
import type { LngLat } from './geo';
import type { CellIndex } from './cells';

export interface CoverageRegion { id: string; name: string; cc?: string; bbox: [number, number, number, number]; cells?: number; names?: string; places?: string }

export const regionsOf = (index: CellIndex | null): CoverageRegion[] => index?.regions ?? [];

/** The region whose box holds the point; where boxes overlap (a state line), the smaller box, which is the better fit. */
export function regionAt(regions: CoverageRegion[], c: LngLat): CoverageRegion | null {
  const area = (r: CoverageRegion) => (r.bbox[2] - r.bbox[0]) * (r.bbox[3] - r.bbox[1]);
  const inside = regions.filter((r) => c[0] > r.bbox[0] && c[0] < r.bbox[2] && c[1] > r.bbox[1] && c[1] < r.bbox[3]);
  return inside.sort((a, b) => area(a) - area(b))[0] ?? null;
}

/** True when the point is in a covered region. With no region list (older data, or none loaded) nothing is ruled out. */
export const inCoverage = (regions: CoverageRegion[], c: LngLat): boolean => !regions.length || !!regionAt(regions, c);

/** Degrees from the point to the region's box (0 inside). */
export const distanceDeg = (r: CoverageRegion, c: LngLat): number => {
  const x = Math.max(r.bbox[0] - c[0], 0, c[0] - r.bbox[2]);
  const y = Math.max(r.bbox[1] - c[1], 0, c[1] - r.bbox[3]);
  return Math.hypot(x, y);
};

/** Covered regions, nearest first. */
export const byDistance = (regions: CoverageRegion[], c: LngLat): CoverageRegion[] =>
  [...regions].sort((a, b) => distanceDeg(a, c) - distanceDeg(b, c));

export function centreOf(r: CoverageRegion): LngLat { return [(r.bbox[0] + r.bbox[2]) / 2, (r.bbox[1] + r.bbox[3]) / 2]; }

/** "Washington", "Washington and Oregon", "Washington, Oregon and Idaho". */
export function listNames(regions: CoverageRegion[]): string {
  const n = regions.map((r) => r.name);
  return n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

/** Nominatim viewbox (west,north,east,south) around every covered region, and the country codes they sit in. */
export function placeBias(regions: CoverageRegion[]): { viewbox?: string; countrycodes?: string } {
  if (!regions.length) return {};
  const w = Math.min(...regions.map((r) => r.bbox[0])), s = Math.min(...regions.map((r) => r.bbox[1]));
  const e = Math.max(...regions.map((r) => r.bbox[2])), n = Math.max(...regions.map((r) => r.bbox[3]));
  const cc = [...new Set(regions.map((r) => r.cc).filter(Boolean))].join(',');
  return { viewbox: `${w},${n},${e},${s}`, ...(cc ? { countrycodes: cc } : {}) };
}
