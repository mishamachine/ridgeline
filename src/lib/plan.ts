// Trip numbers the way a hiker plans: the whole outing, not one way.
import { M_TO_FT, M_TO_MI } from './geo';
import { estimateMinutes, type Difficulty, type Trail } from './trails';

type T = Pick<Trail, 'lengthM' | 'loop' | 'ascentM' | 'descentM'>;

/** Out-and-back trails are walked twice; loops once. */
export const roundTripM = (t: Pick<Trail, 'lengthM' | 'loop'>) => (t.loop ? t.lengthM : t.lengthM * 2);

/** Climb over the whole outing (m). Out and back = the way up plus the climbs on the way home. */
export function roundTripClimbM(t: T): number | null {
  if (t.ascentM == null) return null;
  return t.loop ? t.ascentM : t.ascentM + (t.descentM ?? 0);
}

/** Naismith's rule over the whole outing, in minutes. Without elevation: distance only. */
export function tripMinutes(t: T): number {
  return estimateMinutes(roundTripM(t), roundTripClimbM(t) ?? 0);
}

/**
 * Level from distance and climb of the whole outing (Shenandoah rating: sqrt(2 × gain_ft × miles)).
 * Computed, not rated by anyone. Null when the trail has no elevation.
 */
export function level(t: T): Difficulty | null {
  const climb = roundTripClimbM(t);
  if (climb == null) return null;
  const score = Math.sqrt(2 * climb * M_TO_FT * roundTripM(t) * M_TO_MI);
  return score < 50 ? 'Easy' : score <= 150 ? 'Moderate' : 'Hard';
}

/** Computed highlights, same thresholds as the data build: 8 mi long, 2,500 ft of climb. */
export const LONG_ROUTE_MI = 8;
export const BIG_CLIMB_FT = 2500;
export const isLong = (t: Pick<Trail, 'lengthM'>) => t.lengthM * M_TO_MI > LONG_ROUTE_MI;
export const isBigClimb = (t: Pick<Trail, 'ascentM'>) => t.ascentM != null && t.ascentM * M_TO_FT >= BIG_CLIMB_FT;
