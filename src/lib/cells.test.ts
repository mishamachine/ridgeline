import { describe, it, expect } from 'vitest';
import { cellsFor, covers, cellsToTrails, type CellFile, type CellIndex } from './cells';

// Output of scripts/build_trails.py on scripts/sample.osm (two of its cells).
const A: CellFile = {
  v: 1,
  r: [{ id: 900, t: { name: 'Ridge Route', route: 'hiking', sac_scale: 'mountain_hiking' }, n: 2, m: [[100, [-121.8, 47.49, -121.76, 47.49]], [101, [-121.76, 47.49, -121.74, 47.5, -121.7, 47.51]]] }],
  w: [{ id: 200, t: { name: 'Creek Path', surface: 'dirt', dog: 'leashed' }, g: [-121.9, 47.4, -121.88, 47.41, -121.87, 47.42] }],
};
const B: CellFile = {
  v: 1,
  r: [{ id: 900, t: { name: 'Ridge Route', route: 'hiking', sac_scale: 'mountain_hiking' }, n: 2, m: [[101, [-121.76, 47.49, -121.74, 47.5, -121.7, 47.51]]] }],
  w: [],
};

describe('hosted trail cells', () => {
  it('maps an area to grid cells', () => {
    expect(cellsFor({ west: -121.8, south: 47.49, east: -121.7, north: 47.51 }, 0.25).sort())
      .toEqual(['232_549', '232_550', '233_549', '233_550']);
  });

  it('checks coverage against the index bounds', () => {
    const idx = { bbox: [-124.9, 45.5, -116.9, 49.1] } as CellIndex;
    expect(covers(idx, { west: -121.8, south: 47.4, east: -121.7, north: 47.5 })).toBe(true);
    expect(covers(idx, { west: -100, south: 40, east: -99.9, north: 40.1 })).toBe(false);
  });

  it('stitches a route across cells without duplicating trails', () => {
    const trails = cellsToTrails([A, B, B]);
    expect(trails.map((t) => t.name).sort()).toEqual(['Creek Path', 'Ridge Route']);
    const ridge = trails.find((t) => t.name === 'Ridge Route')!;
    expect(ridge.partial).toBe(false);
    expect(ridge.coords).toHaveLength(4);
    expect(ridge.id).toBe('osm-r900');
    expect(trails.find((t) => t.name === 'Creek Path')!.tags.dog).toBe('leashed');
  });

  it('marks a route as a partial section when some members are in unloaded cells', () => {
    const ridge = cellsToTrails([B]).find((t) => t.name === 'Ridge Route')!;
    expect(ridge.partial).toBe(true);
  });
});
