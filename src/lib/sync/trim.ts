// Privacy: the first and last 200 m of a hike never leave the phone (matches the share card, which hides the start point).
import { haversine } from '../geo';
import type { TrackPoint } from '../store';

export const TRIM_M = 200;

/**
 * The track with TRIM_M cut off each end, or null when nothing is left to upload
 * (a hike shorter than 2 x TRIM_M, or fewer than 2 points remain). The kept points are at least TRIM_M from both ends.
 */
export function trimTrack(points: TrackPoint[], trimM = TRIM_M): TrackPoint[] | null {
  if (points.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + haversine([points[i - 1].lon, points[i - 1].lat], [points[i].lon, points[i].lat]));
  const total = cum[cum.length - 1];
  let a = 0;
  while (a < points.length && cum[a] < trimM) a++;
  let b = points.length - 1;
  while (b >= 0 && total - cum[b] < trimM) b--;
  if (a > b || b - a + 1 < 2) return null;
  return points.slice(a, b + 1);
}
