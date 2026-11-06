// Which way to go at a fork, for voice directions. Pure geometry; no speech or UI here.
import { pointAt, type LngLat } from './geo';
import type { Junction } from './trails';

export type ForkInstruction = 'left' | 'right' | 'straight';

const LOOK_M = 15;        // how far each side of the junction the route's heading is measured
const TURN_DEG = 50;      // route turns at least this much: turn left/right
const FORK_DEG = 45;      // another branch within this of the route's heading: a fork, "stay left/right"

/** Compass bearing in degrees (0 = north, clockwise) from a to b on a local flat map. */
export function bearing(a: LngLat, b: LngLat): number {
  const dx = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  const dy = b[1] - a[1];
  return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
}

/** Signed difference to - from in (-180, 180]; positive is clockwise (to the right). */
export function angleDiff(from: number, to: number): number {
  const d = ((to - from + 540) % 360) - 180;
  return d === -180 ? 180 : d;
}

/**
 * What to do at a junction so the walker stays on the route.
 *  - the route itself turns sharply: 'left' or 'right' (turn);
 *  - another branch splits off close to the route's heading: 'left' or 'right' (stay on that side of it);
 *    branches close on both sides: 'straight';
 *  - other branches leave at wide angles: 'straight' (continue).
 * `direction` is the way the walker travels along `routeCoords`: 'forward' (start to end) or 'reverse'.
 * `cum` is the cumulative distance (m) at each vertex.
 */
export function forkInstruction(routeCoords: LngLat[], cum: number[], junction: Junction, direction: 'forward' | 'reverse'): ForkInstruction {
  const here = pointAt(routeCoords, cum, junction.along);
  const sign = direction === 'forward' ? 1 : -1;
  const out = pointAt(routeCoords, cum, junction.along + sign * LOOK_M);
  const back = pointAt(routeCoords, cum, junction.along - sign * LOOK_M);
  const heading = bearing(here, out);
  const turn = angleDiff(bearing(back, here), heading);
  if (Math.abs(turn) >= TURN_DEG) return turn < 0 ? 'left' : 'right';
  const rel = junction.branches.map((b) => angleDiff(heading, bearing(here, b.point)));
  const rightClose = rel.some((a) => a > 0 && a < FORK_DEG);
  const leftClose = rel.some((a) => a < 0 && a > -FORK_DEG);
  if (rightClose && !leftClose) return 'left';   // the other branch is on our right: we stay left
  if (leftClose && !rightClose) return 'right';
  return 'straight';
}
