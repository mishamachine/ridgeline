// Privacy: the first and last 200 m of a hike never leave the phone (matches the share card, which hides the start point).
import { haversine } from '../geo';
import type { TrackPoint } from '../store';

export const TRIM_M = 200;

/**
 * The track without any point within TRIM_M (straight line, not along the track) of where the hike started or ended,
 * or null when fewer than 2 points are left. Straight-line matters: a loop that comes back past the start, or a route
 * that passes the trailhead mid-hike, must not reveal where the person lives or parks.
 */
export function trimTrack(points: TrackPoint[], trimM = TRIM_M): TrackPoint[] | null {
  if (points.length < 2) return null;
  const a = points[0], b = points[points.length - 1];
  const far = (p: TrackPoint, q: TrackPoint) => haversine([p.lon, p.lat], [q.lon, q.lat]) >= trimM;
  const kept = points.filter((p) => far(p, a) && far(p, b));
  return kept.length >= 2 ? kept : null;
}

/**
 * The server accepts a route of at most 1 MB (about 8,000 points). Longer ones are thinned before upload by keeping every n-th point,
 * always including the first and last kept points, so one long hike can never make the upload fail.
 */
export const MAX_UPLOAD_POINTS = 5000;
export function fitTrack(points: TrackPoint[] | null, max = MAX_UPLOAD_POINTS): TrackPoint[] | null {
  if (!points || points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out: TrackPoint[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}
