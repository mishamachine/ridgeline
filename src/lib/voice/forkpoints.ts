// Forks on the route in the walking direction, and what comes next.
// Geometry comes from forkInstruction() in ../forks.ts; trail.junctions comes from the trail data.
import { cumulative, pointAt, LngLat } from '../geo';
import { angleDiff, bearing, forkInstruction } from '../forks';
import type { Junction } from '../trails';

export type Side = 'left' | 'right';

export interface ForkPoint {
  /** Distance along the route in the walking direction (m). */
  along: number;
  /** 'fork': keep to this side of the split. 'turn': the trail itself turns this way. */
  kind: 'fork' | 'turn';
  side: Side;
  /** The trail you keep following. */
  name: string;
  /** The path you are not taking, when OSM names it. */
  otherName?: string;
}

const TURN_DEG = 50; // same threshold forkInstruction uses to call it a turn
const LOOK_M = 15;

/**
 * Decision points on the route. `coords` are the trail's stored coordinates and the junctions' `along` is measured on them;
 * `reversed` is the walking direction. Plain "continue straight" junctions are left out: no talk where there is nothing to decide.
 */
export function forksFor(coords: LngLat[], junctions: Junction[] | undefined, reversed: boolean, trailName: string): ForkPoint[] {
  if (!junctions?.length || coords.length < 2) return [];
  const cum = cumulative(coords);
  const total = cum.at(-1)!;
  const out: ForkPoint[] = [];
  for (const j of junctions) {
    const a = reversed ? total - j.along : j.along;
    if (a < 30 || a > total - 30) continue; // at the very ends there is nothing to choose
    const dir = reversed ? 'reverse' : 'forward';
    const side = forkInstruction(coords, cum, j, dir);
    if (side === 'straight') continue;
    const sign = reversed ? -1 : 1;
    const here = pointAt(coords, cum, j.along);
    const turn = angleDiff(bearing(pointAt(coords, cum, j.along - sign * LOOK_M), here), bearing(here, pointAt(coords, cum, j.along + sign * LOOK_M)));
    out.push({ along: a, kind: Math.abs(turn) >= TURN_DEG ? 'turn' : 'fork', side, name: trailName, otherName: j.branches.find((b) => b.name)?.name });
  }
  return out.sort((x, y) => x.along - y.along);
}

export type Step =
  | { kind: 'fork'; fork: ForkPoint; toM: number }
  | { kind: 'turnaround'; toM: number }
  | { kind: 'follow'; toM: number; target: 'end' | 'turnaround' };

const NOW_M = 15;

/** What the banner should say from `along`. */
export function nextStep(forks: ForkPoint[], tips: number[], total: number, along: number): Step {
  const fork = forks.find((f) => f.along - along > -NOW_M);
  const tip = tips.find((r) => r - along > -NOW_M);
  if (fork && (tip == null || fork.along <= tip)) return { kind: 'fork', fork, toM: Math.max(0, fork.along - along) };
  if (tip != null) {
    const d = Math.max(0, tip - along);
    return d <= NOW_M ? { kind: 'turnaround', toM: d } : { kind: 'follow', toM: d, target: 'turnaround' };
  }
  return { kind: 'follow', toM: Math.max(0, total - along), target: 'end' };
}
