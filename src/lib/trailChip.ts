import { shortDistance } from './voice/units';
import type { Units } from './settings';

/**
 * The line on Navigate's map: how far is left, and "Off the trail" once you have joined the route and then wandered more than
 * the engine's off-route distance away. It uses the same numbers as the sheet ("to go") and the off-route banner, so the three never
 * disagree: `along` and `offRoute` come from the GPS engine, which holds off-route until you have joined the trail.
 * Nothing shows before you reach the trail (the banner says "to the trail" until then).
 */
export function trailChip(g: { along: number | null; offRoute: boolean; offsetM: number | null }, total: number, units: Units): { off: boolean; text: string } | null {
  if (g.along == null && !g.offRoute) return null;
  const left = `${shortDistance(Math.max(0, g.along != null ? total - g.along : total), units)} left`;
  return g.offRoute ? { off: true, text: `Off the trail · ${shortDistance(g.offsetM ?? 0, units)} away · ${left}` } : { off: false, text: left };
}
