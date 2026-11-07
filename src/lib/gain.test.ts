// Climb on real trails. Cells are slices of the hosted trail files (fixtures/wa-cells.json: the real relations, with their Copernicus DEM heights).
// The gains below are a regression snapshot of what the app computes from those cells (+-3%), plus a physical bound.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cellsToTrails } from './cells';
import { M_TO_FT, totalAscent } from './geo';
import { gainM, level, roundTripClimbM, tripMinutes } from './plan';
import { climbAhead } from './trails';

const cells = JSON.parse(readFileSync(new URL('./fixtures/wa-cells.json', import.meta.url), 'utf8')) as Record<string, Parameters<typeof cellsToTrails>[0]>;
const load = (key: string, id: string) => cellsToTrails(cells[key]).find((t) => t.id === id)!;
const ft = (m: number | null) => Math.round((m ?? 0) * M_TO_FT);

const SNAPSHOT: [string, string, number][] = [
  ['ledge', 'osm-r5588030', 1135],
  ['mount-si', 'osm-r5553769', 3251],
  ['granite-mountain', 'osm-r4794995', 3688],
  ['annette-lake', 'osm-r4794619', 1827],
];

describe('headline gain on real trails', () => {
  it.each(SNAPSHOT)('%s %s: gain stays at its snapshot (+-3%%)', (key, id, expected) => {
    const g = ft(gainM(load(key, id)));
    expect(g).toBeGreaterThan(expected * 0.97);
    expect(g).toBeLessThan(expected * 1.03);
  });

  it.each(SNAPSHOT)('%s %s: physical bounds (gain is at least the net rise, and only a little more on these climbs)', (key, id) => {
    const t = load(key, id);
    const range = Math.max(...t.elevation!) - Math.min(...t.elevation!);
    expect(gainM(t)!).toBeGreaterThanOrEqual(range * 0.97);
    expect(gainM(t)!).toBeLessThanOrEqual(range * 1.15);
  });

  it('Rattlesnake Ledge (B-1): about 1,130 ft one way, not 2,329 (ascent + descent) and not the raw 1,545', () => {
    const t = load('ledge', 'osm-r5588030');
    expect(t.ascentM! * M_TO_FT).toBeLessThan(1250);
    expect(ft(gainM(t))).toBe(ft(t.ascentM!));
    expect(ft(gainM(t))).toBeLessThan(ft(t.ascentM!) + ft(t.descentM!));
    // Navigate "climb left" at the start is the same smoothed number; it falls as you climb and the tail past the top adds nothing.
    expect(ft(climbAhead(t, 0))).toBe(ft(t.ascentM!));
    expect(climbAhead(t, t.lengthM * 0.5)).toBeLessThan(climbAhead(t, 0));
    expect(climbAhead(t, t.lengthM * 0.97)).toBeLessThan(5);
  });

  it('time and level use the corrected climb: Ledge is a Moderate outing of about 2 hours', () => {
    const t = load('ledge', 'osm-r5588030');
    expect(ft(roundTripClimbM(t))).toBeLessThan(1700);
    expect(tripMinutes(t)).toBeGreaterThan(105);
    expect(tripMinutes(t)).toBeLessThan(135);
    expect(level(t)).toBe('Moderate');
  });
});

describe('totalAscent', () => {
  const ramp = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));
  it('ignores a one-sample DEM spike and sub-threshold wiggles', () => {
    const e = ramp(40, (i) => 100 + i * 5);
    const spiked = e.map((v, i) => (i === 20 ? v + 50 : v));
    expect(totalAscent(spiked)).toBeCloseTo(totalAscent(e), 0);
    expect(totalAscent(ramp(40, (i) => 100 + (i % 2) * 6))).toBe(0);
  });
  it('still counts real up-and-down climbing (two 100 m humps)', () => {
    const e = ramp(60, (i) => 100 + (i < 15 ? i * 7 : i < 30 ? 105 - (i - 15) * 7 : i < 45 ? (i - 30) * 7 + 0 : 105 - (i - 45) * 7));
    expect(totalAscent(e)).toBeGreaterThan(180);
    expect(totalAscent(e)).toBeLessThan(215);
  });
});

describe('gainM direction', () => {
  const base = { lengthM: 3000, loop: false, ascentM: 400, descentM: 100 };
  it('loops give the whole ascent; out and back gives the bigger of the two ways (a chain can run either direction)', () => {
    expect(gainM({ ...base, loop: true })).toBe(400);
    expect(gainM(base)).toBe(400);
    expect(gainM({ ...base, ascentM: 100, descentM: 400 })).toBe(400);
    expect(gainM({ ...base, descentM: undefined })).toBe(400);
    expect(gainM({ lengthM: 1, loop: false })).toBeNull();
  });
});
