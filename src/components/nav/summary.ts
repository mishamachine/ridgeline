import { M_TO_FT, totalAscent } from '../../lib/geo';
import type { Activity } from '../../lib/store';
import type { Trail } from '../../lib/trails';
import { trackDistance } from '../../lib/tracker';
import type { HikeSummary as CelebrateSummary } from '../../lib/hype';

/** What the celebration screen gets when a hike is finished. */
export interface HikeSummary {
  trail: Trail;
  activity: Activity;
  distanceM: number;
  climbFt: number;
  movingMs: number;
  startedAt: number;
  endedAt: number;
  /** Trail highlights (lake, summit...) once you have covered most of the trail. */
  highlightsHit: string[];
  /** 0..1: the furthest point reached along the route, capped by the distance actually walked, over the route's length. */
  completedFraction: number;
}

export const HIGHLIGHTS_AT = 0.8;

export function buildSummary(o: {
  trail: Trail;
  activity: Activity;
  endedAt: number;
  pausedMs: number;
  elevation?: number[];
  total: number;
  startAlong: number | null;
  maxAlong: number;
  /** Climb of an earlier leg (the way out, when the hiker turned back automatically), m. */
  priorClimbM?: number;
}): HikeSummary {
  const { trail, activity, total } = o;
  const distanceM = trackDistance(activity.points);
  // A mis-snap at the trailhead can put you far along the route; you cannot have covered more than you walked.
  const completedFraction = total > 0 ? Math.min(1, Math.max(0, Math.min(o.maxAlong, distanceM) / total)) : 0;
  let climbM = o.priorClimbM ?? 0;
  if (o.elevation && o.elevation.length > 1 && total > 0 && o.startAlong != null && o.maxAlong > o.startAlong) {
    const k = (d: number) => Math.round((d / total) * (o.elevation!.length - 1));
    climbM += totalAscent(o.elevation.slice(k(o.startAlong), k(o.maxAlong) + 1));
  }
  return {
    trail,
    activity,
    distanceM,
    climbFt: Math.round(climbM * M_TO_FT),
    movingMs: Math.max(0, o.endedAt - activity.startedAt - o.pausedMs),
    startedAt: activity.startedAt,
    endedAt: o.endedAt,
    highlightsHit: completedFraction >= HIGHLIGHTS_AT ? [...(trail.highlights ?? [])] : [],
    completedFraction,
  };
}

/** The celebration screen and share card read the hike in this shape. */
export function toCelebrateSummary(s: HikeSummary): CelebrateSummary {
  const { trail } = s;
  return {
    trail: { id: trail.id, name: trail.name, highlights: trail.highlights, elevation: trail.elevation },
    distanceM: s.distanceM,
    climbFt: s.climbFt,
    movingMs: s.movingMs,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    highlightsHit: s.highlightsHit,
    completedFraction: s.completedFraction,
    track: s.activity.points.map((p) => ({ lat: p.lat, lon: p.lon })),
  };
}
