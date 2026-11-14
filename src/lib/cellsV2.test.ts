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
