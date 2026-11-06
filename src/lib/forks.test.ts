import { describe, it, expect } from 'vitest';
import { angleDiff, bearing, forkInstruction } from './forks';
import { cumulative, type LngLat } from './geo';
import type { Junction } from './trails';

// A route running due east along lat 47.5, with the junction in the middle.
const D = 0.0003; // ~ 22 m of longitude at 47.5N
const route: LngLat[] = [[-121.8, 47.5], [-121.8 + D, 47.5], [-121.8 + 2 * D, 47.5], [-121.8 + 3 * D, 47.5]];
const cum = cumulative(route);
const at = cum[2];
const J = (...pts: LngLat[]): Junction => ({ along: at, branches: pts.map((point) => ({ point })) });
const j = route[2];
// Points 20 m from the junction at a compass bearing (0 = north, 90 = east).
const out = (deg: number): LngLat => [j[0] + Math.sin(deg * Math.PI / 180) * 20 / (111320 * Math.cos(47.5 * Math.PI / 180)), j[1] + Math.cos(deg * Math.PI / 180) * 20 / 110574];

describe('bearing helpers', () => {
  it('measures compass bearings and signed differences', () => {
    expect(bearing([0, 0], [0, 1])).toBeCloseTo(0);
    expect(bearing([0, 0], [1, 0])).toBeCloseTo(90);
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
  });
});

describe('forkInstruction', () => {
  it('stays left when the other branch splits off to the right, and right when it splits to the left', () => {
    expect(forkInstruction(route, cum, J(out(120)), 'forward')).toBe('left');   // other branch heads south-east: on our right
    expect(forkInstruction(route, cum, J(out(60)), 'forward')).toBe('right');   // other branch heads north-east: on our left
  });

  it('continues straight past a side path that leaves at a wide angle', () => {
    expect(forkInstruction(route, cum, J(out(180)), 'forward')).toBe('straight');
    expect(forkInstruction(route, cum, J(out(0)), 'forward')).toBe('straight');
  });

  it('continues straight through a crossing, and when branches are close on both sides', () => {
    expect(forkInstruction(route, cum, J(out(0), out(180)), 'forward')).toBe('straight');
    expect(forkInstruction(route, cum, J(out(60), out(120)), 'forward')).toBe('straight');
  });

  it('flips left and right when walking the same route backwards', () => {
    // Heading west: a south-west branch is on our left, so we stay right; a north-west one is on our right, so we stay left.
    expect(forkInstruction(route, cum, J(out(240)), 'reverse')).toBe('right');
    expect(forkInstruction(route, cum, J(out(300)), 'reverse')).toBe('left');
    // The same branch seen from the other direction is far off the heading: just continue.
    expect(forkInstruction(route, cum, J(out(120)), 'reverse')).toBe('straight');
  });

  it('reports a turn when the route itself bends', () => {
    const bend: LngLat[] = [[-121.8, 47.5], [-121.8 + D, 47.5], [-121.8 + D, 47.5 + 0.0003], [-121.8 + D, 47.5 + 0.0006]];
    const c = cumulative(bend);
    const junction: Junction = { along: c[1], branches: [{ point: [bend[1][0] + 0.0002, bend[1][1]] }] };
    expect(forkInstruction(bend, c, junction, 'forward')).toBe('left');   // east then north: a left turn
    expect(forkInstruction(bend, c, junction, 'reverse')).toBe('right');  // north then west: a right turn
  });
});
