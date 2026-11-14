// Dogs on trails. OpenStreetMap's dog tag is not enough inside a US national park, where dog rules are strict and
// trail-specific: there we never say "Dogs: Yes". This file is how the app knows it is in a park.
import type { LngLat } from './geo';
import type { Trail } from './trails';

/**
 * US national parks in WA, OR and CA as rough bounding boxes [west, south, east, north]. The hosted trail files carry no park
 * outlines, so this is a stand-in until a build-time park polygon index exists (OSM boundary=national_park). The boxes are
 * hand-drawn from memory of each park's extent and have NOT been checked against NPS boundary data (unverified). They are
 * generous on purpose: an edge trail near a park may lose its "Dogs: Yes", which is the safe direction. National parks, plus Muir Woods
 * and Point Reyes; other monuments, recreation areas and seashores are not listed yet.
 */
// Approximate bounding boxes, NOT NPS data; replaced by OSM park polygons in the data build (coverage batch 2).
export const NATIONAL_PARK_BOXES: { name: string; box: [number, number, number, number] }[] = [
  { name: 'Mount Rainier', box: [-122.15, 46.68, -121.45, 47.10] },
  { name: 'Olympic', box: [-124.75, 47.30, -122.95, 48.35] },
  { name: 'North Cascades', box: [-121.60, 48.05, -120.50, 49.00] },
  { name: 'Crater Lake', box: [-122.30, 42.78, -121.90, 43.08] },
  { name: 'Redwood', box: [-124.20, 41.20, -123.85, 41.80] },
  { name: 'Lassen Volcanic', box: [-121.70, 40.35, -121.25, 40.65] },
  { name: 'Yosemite', box: [-119.95, 37.40, -119.15, 38.25] },
  { name: 'Sequoia and Kings Canyon', box: [-119.10, 36.15, -118.25, 37.35] },
  { name: 'Pinnacles', box: [-121.30, 36.40, -121.10, 36.55] },
  { name: 'Channel Islands', box: [-120.55, 33.85, -119.30, 34.10] },
  { name: 'Joshua Tree', box: [-116.45, 33.60, -115.25, 34.20] },
  { name: 'Death Valley', box: [-118.05, 35.45, -116.25, 37.35] },
  { name: 'Muir Woods National Monument', box: [-122.62, 37.86, -122.54, 37.93] },
  { name: 'Point Reyes National Seashore', box: [-123.15, 37.95, -122.75, 38.30] },
];

/**
 * Canada: trails follow the OpenStreetMap dog tag like anywhere else (no park boxes). One exception: the West Coast Trail
 * (Pacific Rim National Park Reserve), where dog rules are strict, is always "Unknown". Matched by name inside a rough box
 * around the trail on Vancouver Island, so a same-named trail elsewhere is not caught. The box is approximate, not Parks Canada data.
 */
export const WEST_COAST_TRAIL = { name: /\bwest coast trail\b/i, box: [-125.30, 48.45, -124.30, 48.95] as [number, number, number, number] };

/**
 * Canada, south Vancouver Island west of Haro Strait (Sooke, Metchosin, Victoria): the Olympic box above runs a little north of the
 * border, so points here are never counted as inside a US national park. Kept west of -123.25 so US land (the San Juan Islands, Port
 * Angeles side) keeps the US rules. A box, not a region code, on purpose: the hosted cells carry no region, and Washington and British
 * Columbia boxes overlap here (border cells are built by both). Approximate; Canadian park trails follow the OSM tag anyway.
 */
const CANADA_SOUTH_VI: [number, number, number, number] = [-124.0, 48.28, -123.25, 48.6];

const inBox = (p: LngLat, [w, s, e, n]: [number, number, number, number]) => p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= n;

/** True when any part of the trail, or its trailhead, lies inside a listed national park. */
export function inNationalPark(t: Pick<Trail, 'coords'> & Partial<Pick<Trail, 'trailhead'>>): boolean {
  const pts: LngLat[] = t.trailhead ? [t.trailhead, ...(t.coords ?? [])] : (t.coords ?? []);
  return NATIONAL_PARK_BOXES.some((p) => pts.some((c) => inBox(c, p.box) && !inBox(c, CANADA_SOUTH_VI)));
}

/** True for the West Coast Trail (by name, with part of the trail inside its box). */
export function isWestCoastTrail(t: Partial<Pick<Trail, 'name' | 'coords' | 'trailhead'>>): boolean {
  if (!t.name || !WEST_COAST_TRAIL.name.test(t.name)) return false;
  const pts: LngLat[] = t.trailhead ? [t.trailhead, ...(t.coords ?? [])] : (t.coords ?? []);
  return pts.some((c) => inBox(c, WEST_COAST_TRAIL.box));
}

export type DogsStatus = 'yes' | 'unknown' | 'none';
/** "yes" only for a firm OSM dog tag outside a national park. A maybe tag, or any trail in a national park, is "unknown". */
export function dogsStatus(t: Pick<Trail, 'highlights' | 'coords'> & Partial<Pick<Trail, 'trailhead' | 'name'>>): DogsStatus {
  if (inNationalPark(t) || isWestCoastTrail(t)) return 'unknown';
  if (t.highlights?.includes('dogs')) return 'yes';
  return t.highlights?.includes('dogs?') ? 'unknown' : 'none';
}

export const DOGS_YES = 'Dogs: tagged yes';
export const DOGS_UNKNOWN = 'Dogs: Unknown';
export const DOGS_PAGE_NOTE = 'Dogs: tagged yes in OpenStreetMap. Check local rules before you go.';
