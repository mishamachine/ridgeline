// Cell format v2 (scripts/cell_format.py): the same real WA cells, simplified to 5 m and delta-encoded, must give the same trails.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cellsToTrails, decodeCell, type CellFile } from './cells';

type Fx = Record<string, CellFile[]>;
const read = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')) as Fx;
const v1 = read('wa-cells.json'), v2 = read('wa-cells-v2.json');

describe('cell format v2', () => {
  it('is marked v2 and much smaller than v1', () => {
    for (const k of Object.keys(v2)) for (const c of v2[k]) expect(c.v).toBe(2);
    expect(JSON.stringify(v2).length).toBeLessThan(JSON.stringify(v1).length * 0.3);
  });

  it('decodes to v1 shape with absolute coordinates and one height per vertex', () => {
    const c = decodeCell(v2['ledge'][0]);
    expect(c.v).toBe(1);
    for (const r of c.r) for (const m of r.m) {
      expect(m[1].length / 2).toBe(m[2]!.length);
      expect(Math.abs(m[1][0] - (-121.8))).toBeLessThan(0.5); // North Bend, not a raw delta
    }
  });

  it('passes v1 files through untouched', () => { const c = v1['ledge'][0]; expect(decodeCell(c)).toBe(c); });

  it.each(Object.keys(v1))('%s: same trails, length within 3.5% (shorter, from cut switchback corners), ascent within 4%', (key) => {
    const a = cellsToTrails(v1[key]), b = cellsToTrails(v2[key]);
    expect(b.map((t) => t.id).sort()).toEqual(a.map((t) => t.id).sort());
    for (const t of a) {
      const u = b.find((x) => x.id === t.id)!;
      expect(u.name).toBe(t.name);
      expect(u.lengthM).toBeLessThanOrEqual(t.lengthM * 1.001);
      expect(1 - u.lengthM / t.lengthM).toBeLessThan(0.035);
      if (t.ascentM && t.ascentM > 100) expect(Math.abs(u.ascentM! / t.ascentM - 1)).toBeLessThan(0.04);
      expect(u.coords[0]).toEqual(t.coords[0]);
      expect(u.coords.at(-1)).toEqual(t.coords.at(-1));
    }
  });

  it('total ascent over all the sample trails is within 2% of v1', () => {
    let a = 0, b = 0;
    for (const key of Object.keys(v1)) {
      for (const t of cellsToTrails(v1[key])) a += t.ascentM ?? 0;
      for (const t of cellsToTrails(v2[key])) b += t.ascentM ?? 0;
    }
    expect(Math.abs(b / a - 1)).toBeLessThan(0.02);
  });

  it('keeps junction branch points as offsets from their vertex', () => {
    const body: CellFile = { v: 2, r: [], w: [{ id: 1, t: { name: 'A' }, g: [-12200000, 4700000, 1000, 0, 1000, 0], z: [100, 1, 1], j: [[1, [[5, 7, 'B']]]], th: [10, -20, 1] }] };
    const w = decodeCell(body).w[0];
    expect(w.g).toEqual([-122, 47, -121.99, 47, -121.98, 47]);
    expect(w.j![0][1][0]).toEqual([-121.99 + 0.00005, 47 + 0.00007, 'B']);
    expect(w.th).toEqual([-121.9999, 46.9998, 1]);
  });
});

describe('stored length and gain (measured on the full line at build time)', () => {
  const withS = (s: Record<string, number[]>): CellFile => ({ ...v2['ledge'][0], s });
  const ledge = (f: CellFile) => cellsToTrails([f]).find((t) => t.id === 'osm-r5588030')!;
  const drawn = ledge(v2['ledge'][0]);

  it('uses them for a complete trail', () => {
    const t = ledge(withS({ r5588030: [3100, 340, 25] }));
    expect([t.lengthM, t.ascentM, t.descentM]).toEqual([3100, 340, 25]);
  });
  it('uses them for a complete route even when they differ a lot from the drawn line (a branching relation stitches differently on it)', () => {
    const t = ledge(withS({ r5588030: [Math.round(drawn.lengthM * 1.2), 999, 999] }));
    expect([t.lengthM, t.ascentM]).toEqual([Math.round(drawn.lengthM * 1.2), 999]);
  });
  it('for a named path, ignores them when they disagree with the drawn line by more than 8% (a different stitching)', () => {
    const g = [-121.9, 47.0, -121.89, 47.0, -121.88, 47.0, -121.87, 47.0];
    const key = 'w-121.87000,47.00000|-121.90000,47.00000';   // the two ends, sorted as text
    const path = (s: number[]): CellFile => ({ v: 1, r: [], s: { [key]: s }, w: [{ id: 5, t: { name: 'Ridge Path' }, g, z: [100, 3, 3, 3] }] });
    const get = (f: CellFile) => cellsToTrails([f]).find((t) => t.name === 'Ridge Path')!;
    const base = get(path([0, 0, 0]));
    expect(get(path([Math.round(base.lengthM * 1.02), 50, 5])).ascentM).toBe(50);          // agrees: used
    expect(get(path([Math.round(base.lengthM * 1.5), 50, 5])).ascentM).toBe(base.ascentM); // disagrees: ignored
  });
  it('ignores them for a partial trail (members in cells that are not loaded)', () => {
    const f = withS({ r5588030: [3100, 340, 25] });
    f.r = f.r.map((r) => ({ ...r, n: r.n + 1 }));
    const t = ledge(f);
    expect(t.partial).toBe(true);
    expect(t.lengthM).toBe(drawn.lengthM);
  });
  it('without them the drawn numbers stand', () => { expect(ledge(v2['ledge'][0]).lengthM).toBe(drawn.lengthM); });
});

describe('branching relations (stitched differently on the simplified line)', () => {
  // A trunk plus two branches that all join end to end on the drawn line: the app's chain is ~16 km, but the build measured the
  // trail on the full line as 8,493 m and 959 m up. For a complete route the stored numbers are the right ones.
  const seg = (lon0: number, n: number, step = 0.0045) => Array.from({ length: n }, (_, i) => [lon0 + i * step, 47.0]).flat();
  const wayZ = (n: number, z0: number) => [z0, ...Array(n - 1).fill(6)];
  const cell = (n: number, s?: Record<string, number[]>): CellFile => ({
    v: 1, s, w: [],
    r: [{ id: 77, t: { name: 'Emerald Ridge' }, n, m: [[1, seg(-121.9, 21), wayZ(21, 500)], [2, seg(-121.9 + 20 * 0.0045, 21), wayZ(21, 620)], [3, seg(-121.9 + 40 * 0.0045, 21), wayZ(21, 740)]] }],
  });
  const trail = (f: CellFile) => cellsToTrails([f]).find((t) => t.id === 'osm-r77');

  it('uses the stored numbers for a complete route even when the drawn chain is much longer', () => {
    const drawn = trail(cell(3))!;
    expect(drawn.lengthM).toBeGreaterThan(12000);                       // the chain the simplified geometry gives
    const t = trail(cell(3, { r77: [8493, 959, 120] }))!;
    expect([t.lengthM, t.ascentM, t.descentM]).toEqual([8493, 959, 120]);
  });
  it('does not use them for a route clipped by the view (a member is in a cell that is not loaded)', () => {
    const t = trail(cell(4, { r77: [8493, 959, 120] }))!;
    expect(t.partial).toBe(true);
    expect(t.lengthM).toBeGreaterThan(12000);
  });
  it('judges the 500 m minimum on the stored length for a complete route, and keeps clipped slivers out', () => {
    const tiny: CellFile = { v: 1, w: [], s: { r5: [2400, 300, 10] }, r: [{ id: 5, t: { name: 'North Spur' }, n: 1, m: [[9, seg(-121.9, 6, 0.0003), wayZ(6, 500)]] }] };   // drawn chain ~ 110 m
    expect(cellsToTrails([tiny]).some((t) => t.id === 'osm-r5')).toBe(true);
    const clipped: CellFile = { ...tiny, r: [{ ...tiny.r[0], n: 2 }] };
    expect(cellsToTrails([clipped]).some((t) => t.id === 'osm-r5')).toBe(false);
  });
});

describe('named paths whose shown numbers differ from the stored ones', () => {
  const g = [-121.9, 47.0, -121.89, 47.0, -121.88, 47.0, -121.87, 47.0];
  const key = 'w-121.87000,47.00000|-121.90000,47.00000';
  const path = (s: number[]): CellFile => ({ v: 1, r: [], s: { [key]: s }, w: [{ id: 5, t: { name: 'Ridge Path' }, g, z: [100, 3, 3, 3] }] });
  const get = (f: CellFile) => cellsToTrails([f]).find((t) => t.name === 'Ridge Path')!;
  const L = get(path([0, 0, 0])).lengthM;
  it('is flagged when the length is over 10% from the stored figure, and is still returned (search, All trails, map)', () => {
    const t = get(path([Math.round(L * 1.5), 50, 5]));
    expect(t.statsMismatch).toBe(true);
    expect(t.lengthM).toBe(L);
  });
  it('is flagged when the gain is over 10% apart although the length agrees within 10%', () => {
    expect(get(path([Math.round(L * 1.09), 300, 5])).statsMismatch).toBe(true);
  });
  it('is not flagged when the stored numbers are used, or when both agree within 10%', () => {
    expect(get(path([Math.round(L * 1.02), 50, 5])).statsMismatch).toBeUndefined();
    expect(get(path([Math.round(L * 1.09), get(path([0, 0, 0])).ascentM ?? 0, 0])).statsMismatch).toBeUndefined();
  });
});
