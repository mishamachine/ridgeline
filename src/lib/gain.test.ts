// Climb on real trails. Cells are slices of the hosted trail files (fixtures/wa-cells.json: the real relations, with their Copernicus DEM heights).
// Reference numbers are the Washington Trails Association "Elevation Gain" for each hike (wta.org/go-hiking/hikes/<slug>, read 6 Nov 2026).
// They are a sanity band only (+-10%); nothing here is copied into the app.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cellsToTrails } from './cells';
import { M_TO_FT, totalAscent } from './geo';
import { gainM, level, roundTripClimbM, tripMinutes } from './plan';
import { climbAhead } from './trails';

const cells = JSON.parse(readFileSync(new URL('./fixtures/wa-cells.json', import.meta.url), 'utf8')) as Record<string, Parameters<typeof cellsToTrails>[0]>;
const load = (key: string, id: string) => cellsToTrails(cells[key]).find((t) => t.id === id)!;
const ft = (m: number | null) => Math.round((m ?? 0) * M_TO_FT);

const REFERENCE: [string, string, string, number][] = [
  ['ledge', 'osm-r5588030', 'Rattlesnake Ledge (WTA 1,160 ft)', 1160],
  ['mount-si', 'osm-r5553769', 'Mount Si (WTA 3,150 ft)', 3150],
  ['granite-mountain', 'osm-r4794995', 'Granite Mountain (WTA 3,800 ft)', 3800],
  ['annette-lake', 'osm-r4794619', 'Annette Lake (WTA 1,800 ft)', 1800],
];

describe('headline gain on real trails', () => {
  it.each(REFERENCE)('%s: %s is within 10%% of the published gain', (key, id, _name, published) => {
    const t = load(key, id);
    const g = ft(gainM(t));
    expect(g).toBeGreaterThan(published * 0.9);
    expect(g).toBeLessThan(published * 1.1);
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
  it('loops give the whole ascent; out and back gives one way, from the car park end when known', () => {
    expect(gainM({ ...base, loop: true })).toBe(400);
    expect(gainM(base)).toBe(400);
    const coords = [[-121.77, 47.43], [-121.77, 47.46]] as [number, number][];
    expect(gainM({ ...base, coords, trailhead: [-121.77, 47.4601], trailheadIsParking: true })).toBe(100); // the chain runs downhill from the car park: way up = its descent
    expect(gainM({ ...base, coords, trailhead: [-121.77, 47.4301], trailheadIsParking: true })).toBe(400);
    expect(gainM({ lengthM: 1, loop: false })).toBeNull();
  });
});
