import { describe, it, expect } from 'vitest';
import { haversine, cumulative, projectOnLine, resample, lineLength, tilesForBBox, totalAscent, LngLat } from './geo';
import { chainSegments, parseOverpass, difficulty, estimateMinutes, climbAhead, overpassQuery } from './trails';
import { tileCacheKey } from './tiles';
import { toGPX, addFix, newActivity } from './tracker';
import { hm, mi, ft } from './format';

describe('geo', () => {
  it('haversine matches a known distance (1° of latitude ≈ 111.2 km)', () => {
    expect(haversine([0, 0], [0, 1]) / 1000).toBeCloseTo(111.19, 1);
  });

  it('projects a point onto a line', () => {
    const line: LngLat[] = [[0, 0], [0.01, 0]];
    const cum = cumulative(line);
    const p = projectOnLine(line, cum, [0.005, 0.0009]);
    expect(p.along).toBeCloseTo(cum[1] / 2, 0);
    expect(p.offset).toBeCloseTo(100, -1); // ~100 m north of the line
  });

  it('resamples evenly and keeps endpoints', () => {
    const line: LngLat[] = [[0, 0], [0.01, 0], [0.01, 0.01]];
    const pts = resample(line, 5);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[4]).toEqual([0.01, 0.01]);
    expect(lineLength(pts)).toBeCloseTo(lineLength(line), 0);
  });

  it('covers a bbox with tiles', () => {
    const t = tilesForBBox({ west: -121.8, south: 47.4, east: -121.7, north: 47.5 }, 14, 14);
    expect(t.length).toBeGreaterThan(4);
    expect(t.every(([z]) => z === 14)).toBe(true);
  });

  it('total ascent ignores small noise', () => {
    expect(totalAscent([100, 101, 100, 101, 100])).toBe(0);
    expect(totalAscent([100, 150, 120, 200])).toBe(130);
  });
});

describe('trails', () => {
  it('chains segments in any orientation', () => {
    const a: LngLat[] = [[0, 0], [0.001, 0]];
    const b: LngLat[] = [[0.002, 0], [0.001, 0]]; // reversed, touches a's end
    const c: LngLat[] = [[-0.001, 0], [0, 0]];   // touches a's start
    const chains = chainSegments([a, b, c]);
    expect(chains).toHaveLength(1);
    expect(chains[0][0]).toEqual([-0.001, 0]);
    expect(chains[0].at(-1)).toEqual([0.002, 0]);
  });

  it('parses relations and named ways, skipping route members and short paths', () => {
    const g = (pts: number[][]) => pts.map(([lon, lat]) => ({ lon, lat }));
    const els = [
      { type: 'relation', id: 1, tags: { name: 'Ridge Route', sac_scale: 'hiking' }, members: [
        { type: 'way', ref: 10, role: '', geometry: g([[0, 0], [0.01, 0]]) },
        { type: 'way', ref: 11, role: '', geometry: g([[0.01, 0], [0.01, 0.01]]) },
      ] },
      { type: 'way', id: 10, tags: { name: 'Member Way', highway: 'path' }, geometry: g([[0, 0], [0.01, 0]]) },
      { type: 'way', id: 20, tags: { name: 'Creek Path', highway: 'path' }, geometry: g([[1, 1], [1.01, 1]]) },
      { type: 'way', id: 21, tags: { name: 'Creek Path', highway: 'path' }, geometry: g([[1.01, 1], [1.01, 1.001]]) },
      { type: 'way', id: 30, tags: { name: 'Tiny', highway: 'path' }, geometry: g([[2, 2], [2.0001, 2]]) },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const trails = parseOverpass(els as any);
    expect(trails.map((t) => t.name).sort()).toEqual(['Creek Path', 'Ridge Route']);
    const ridge = trails.find((t) => t.name === 'Ridge Route')!;
    expect(ridge.lengthM).toBeCloseTo(haversine([0, 0], [0.01, 0]) + haversine([0.01, 0], [0.01, 0.01]), 0);
    expect(ridge.loop).toBe(false);
    expect(ridge.tags.sac_scale).toBe('hiking');
  });

  it('splits geometry clipped at the search edge and marks it partial', () => {
    const els = [{ type: 'way', id: 5, tags: { name: 'Edge Trail' }, geometry: [{ lon: 0, lat: 0 }, { lon: 0.01, lat: 0 }, null, { lon: 0.02, lat: 0 }] }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [t] = parseOverpass(els as any);
    expect(t.partial).toBe(true);
    expect(t.coords).toHaveLength(2);
  });

  it('rates difficulty with the Shenandoah formula', () => {
    // 4.2 mi, 1,180 ft → sqrt(2*1180*4.2) ≈ 99.6 → Moderate
    expect(difficulty({ lengthM: 4.2 / 0.000621371, ascentM: 1180 / 3.28084 })).toBe('Moderate');
    expect(difficulty({ lengthM: 2000, ascentM: 30 })).toBe('Easy');
    expect(difficulty({ lengthM: 16000, ascentM: 1200 })).toBe('Hard');
    expect(difficulty({ lengthM: 2000 })).toBeNull();
  });

  it("estimates time with Naismith's rule", () => {
    // 3 mi flat = 60 min; plus 1,000 ft = +30 min
    expect(estimateMinutes(3 / 0.000621371, 0)).toBeCloseTo(60, 5);
    expect(estimateMinutes(3 / 0.000621371, 1000 / 3.28084)).toBeCloseTo(90, 5);
  });

  it('computes climb remaining from position', () => {
    const t = { lengthM: 1000, elevation: Array.from({ length: 100 }, (_, i) => (i < 50 ? i * 2 : 98)) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(climbAhead(t as any, 0)).toBeCloseTo(98, 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(climbAhead(t as any, 600)).toBe(0);
  });

  it('builds a bounded Overpass query', () => {
    const q = overpassQuery({ west: -121.8, south: 47.4, east: -121.7, north: 47.5 });
    expect(q).toContain('out tags geom(47.40000,-121.80000,47.50000,-121.70000)');
  });
});

describe('tiles', () => {
  it('strips the data version from tile cache keys', () => {
    expect(tileCacheKey('https://tiles.openfreemap.org/planet/20261018_080001_pt/14/2650/5720.pbf'))
      .toBe('https://tiles.openfreemap.org/planet/14/2650/5720.pbf');
    expect(tileCacheKey('https://example.com/planet/x/1/2/3.pbf')).toBeNull();
  });
});

describe('tracker + format', () => {
  const fix = (lon: number, lat: number, acc = 5, t = 0) =>
    ({ coords: { longitude: lon, latitude: lat, altitude: 100, accuracy: acc }, timestamp: t }) as unknown as GeolocationPosition;

  it('drops inaccurate and stationary fixes', () => {
    const a = newActivity('Test');
    expect(addFix(a, fix(0, 0))).toBe(true);
    expect(addFix(a, fix(0, 0.00001))).toBe(false); // ~1 m
    expect(addFix(a, fix(0, 0.001, 200))).toBe(false); // poor accuracy
    expect(addFix(a, fix(0, 0.001))).toBe(true);
  });

  it('writes valid GPX with escaped names', () => {
    const a = newActivity('A & B <hike>');
    addFix(a, fix(-121.7, 47.4, 5, Date.UTC(2026, 9, 21)));
    const gpx = toGPX(a);
    expect(gpx).toContain('<name>A &#38; B &#60;hike&#62;</name>');
    expect(gpx).toContain('<trkpt lat="47.400000" lon="-121.700000"><ele>100.0</ele><time>2026-10-21T00:00:00.000Z</time></trkpt>');
  });

  it('formats numbers', () => {
    expect(hm(150)).toBe('2:30');
    expect(hm(59.6)).toBe('1:00');
    expect(mi(6759)).toBe('4.2');
    expect(ft(359.7)).toBe('1,180');
  });
});
