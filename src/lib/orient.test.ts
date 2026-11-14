// An Eagle Creek-shaped trail: 12 km, mapped from the top down to the car park, so the line runs downhill.
// The app must report the climb on the way out from the car park, not "36 ft".
import { describe, expect, it } from 'vitest';
import { cellsToTrails, type CellFile } from './cells';
import { gainM, level, roundTripClimbM, tripMinutes } from './plan';
import { M_TO_FT } from './geo';

const N = 40;
const lon = (i: number) => -121.9 + i * 0.00385;       // ~300 m apart at 45.6 N
const coords = Array.from({ length: N }, (_, i) => [lon(i), 45.6]);
const flat = coords.flat();
const down = [1000, ...Array(N - 1).fill(-25)];         // 1000 m at the first vertex, 25 m lower at each next one
const cell = (th?: number[]): CellFile => ({ v: 1, w: [], r: [{ id: 1, t: { name: 'Eagle Creek Trail' }, n: 1, m: [[11, flat, down]], ...(th ? { th, h: [] } : {}) }] });
const parkingAtLowEnd = [lon(N - 1), 45.6, 1];
const parkingAtHighEnd = [lon(0), 45.6, 1];
const load = (f: CellFile) => cellsToTrails([f]).find((t) => t.id === 'osm-r1')!;

describe('out-and-back orientation', () => {
  it('turns a line that runs downhill into one that starts at the car park', () => {
    const t = load(cell(parkingAtLowEnd));
    expect(t.coords[0][0]).toBeCloseTo(lon(N - 1), 5);              // starts at the car park (the low end)
    expect(t.elevation![0]).toBeLessThan(t.elevation!.at(-1)!);     // and climbs
    expect(t.ascentM!).toBeGreaterThan(900);
    expect(t.descentM!).toBeLessThan(100);
    expect(Math.round(t.ascentM! * M_TO_FT)).toBeGreaterThan(3000);
  });

  it('leaves a line that already starts at the car park alone', () => {
    const t = load(cell(parkingAtHighEnd));
    expect(t.coords[0][0]).toBeCloseTo(lon(0), 5);
    expect(t.descentM!).toBeGreaterThan(900);
  });

  it('with no known car park the direction is unknown, so the headline gain is still the way up', () => {
    const t = load(cell());
    expect(t.ascentM!).toBeLessThan(100);
    expect(gainM(t)!).toBeGreaterThan(900);                         // max(ascent, descent)
  });

  it('level and time use the whole outing (ascent + descent), the same either way round', () => {
    const a = load(cell(parkingAtLowEnd)), b = load(cell());
    expect(roundTripClimbM(a)).toBeCloseTo(roundTripClimbM(b)!, 0);
    expect(level(a)).toBe(level(b));
    expect(tripMinutes(a)).toBeCloseTo(tripMinutes(b), 0);
  });

  it('puts junction distances along the oriented line', () => {
    const f = cell(parkingAtLowEnd);
    f.r[0].m[0].push([[N - 2, [[lon(N - 2), 45.6005]]]] as never);   // a branch near the car park end of the mapped line
    const t = load(f);
    expect(t.junctions?.[0].along).toBeLessThan(1000);                // near the start of the oriented trail
  });
});
