// Dogs on trails. OpenStreetMap's dog tag is not enough inside a US national park, where dog rules are strict and
// trail-specific: there we never say "Dogs: Yes". This file is how the app knows it is in a park.
import type { LngLat } from './geo';
import type { Trail } from './trails';

/**
 * US national parks in WA, OR and CA as rough bounding boxes [west, south, east, north]. The hosted trail files carry no park
 * outlines, so this is a stand-in until a build-time park polygon index exists (OSM boundary=national_park). The boxes are
 * hand-drawn from memory of each park's extent and have NOT been checked against NPS boundary data (unverified). They are
 * generous on purpose: an edge trail near a park may lose its "Dogs: Yes", which is the safe direction. National parks only:
 * monuments, recreation areas and seashores are not listed yet.
 */
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
];

const inBox = (p: LngLat, [w, s, e, n]: [number, number, number, number]) => p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= n;

/** True when any part of the trail, or its trailhead, lies inside a listed national park. */
export function inNationalPark(t: Pick<Trail, 'coords'> & Partial<Pick<Trail, 'trailhead'>>): boolean {
  const pts: LngLat[] = t.trailhead ? [t.trailhead, ...(t.coords ?? [])] : (t.coords ?? []);
  return NATIONAL_PARK_BOXES.some((p) => pts.some((c) => inBox(c, p.box)));
}

export type DogsStatus = 'yes' | 'unknown' | 'none';
/** "yes" only for a firm OSM dog tag outside a national park. A maybe tag, or any trail in a national park, is "unknown". */
export function dogsStatus(t: Pick<Trail, 'highlights' | 'coords'> & Partial<Pick<Trail, 'trailhead'>>): DogsStatus {
  if (inNationalPark(t)) return 'unknown';
  if (t.highlights?.includes('dogs')) return 'yes';
  return t.highlights?.includes('dogs?') ? 'unknown' : 'none';
}

export const DOGS_YES = 'Dogs: Yes (OSM)';
export const DOGS_UNKNOWN = 'Dogs: Unknown';
export const DOGS_PAGE_NOTE = 'Dogs: tagged yes in OpenStreetMap. Check local rules before you go.';
