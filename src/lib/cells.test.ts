import { describe, it, expect } from 'vitest';
import { cellsFor, covers, cellsToTrails, type CellFile, type CellIndex } from './cells';
import { profileFromVertices } from './trails';

// Output of scripts/build_trails.py on scripts/sample.osm (two of its cells).
const A: CellFile = {
  v: 1,
  r: [{ id: 900, t: { name: 'Ridge Route', route: 'hiking', sac_scale: 'mountain_hiking' }, n: 2, m: [[100, [-121.8, 47.49, -121.76, 47.49], [150, 19]], [101, [-121.76, 47.49, -121.74, 47.5, -121.7, 47.51], [169, 812, 367]]] }],
  w: [{ id: 200, t: { name: 'Creek Path', surface: 'dirt', dog: 'leashed' }, g: [-121.9, 47.4, -121.88, 47.41, -121.87, 47.42], z: [285, 58, 104] }],
};
const B: CellFile = {
  v: 1,
  r: [{ id: 900, t: { name: 'Ridge Route', route: 'hiking', sac_scale: 'mountain_hiking' }, n: 2, m: [[101, [-121.76, 47.49, -121.74, 47.5, -121.7, 47.51], [169, 812, 367]]] }],
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

  it('builds the elevation profile from per-vertex heights', () => {
    const ridge = cellsToTrails([A, B]).find((t) => t.name === 'Ridge Route')!;
    // Vertices are 150, 169, 981, 1348 m: the profile starts and ends on those and never leaves their range.
    expect(ridge.elevation).toHaveLength(100);
    expect(ridge.elevation![0]).toBe(150);
    expect(ridge.elevation!.at(-1)).toBe(1348);
    expect(Math.max(...ridge.elevation!)).toBe(1348);
    expect(ridge.ascentM).toBeGreaterThan(1100);
    expect(ridge.descentM).toBe(0);
    const creek = cellsToTrails([A]).find((t) => t.name === 'Creek Path')!;
    expect(creek.elevation![0]).toBe(285);
    expect(creek.elevation!.at(-1)).toBe(447);
  });

  it('leaves elevation off, without failing, for cell files that have none', () => {
    const old: CellFile = { v: 1, r: [], w: [{ id: 5, t: { name: 'Old Path' }, g: [-121.9, 47.4, -121.88, 47.41, -121.87, 47.42] }] };
    const [t] = cellsToTrails([old]);
    expect(t.elevation).toBeUndefined();
    expect(t.ascentM).toBeUndefined();
  });

  it('keeps the start-to-end orientation of the chain when ways are joined backwards', () => {
    // Second way is stored end-first, so the chain reverses it; heights must follow the vertices.
    const f: CellFile = { v: 1, r: [], w: [
      { id: 1, t: { name: 'Flip' }, g: [-121.9, 47.4, -121.89, 47.4], z: [100, 100] },
      { id: 2, t: { name: 'Flip' }, g: [-121.85, 47.4, -121.89, 47.4], z: [400, -300] },
    ] };
    const [t] = cellsToTrails([f]);
    const ends = [t.elevation![0], t.elevation!.at(-1)];
    expect(ends.sort()).toEqual([100, 400]);
  });
});

describe('profileFromVertices', () => {
  it('interpolates linearly by distance and returns n points', () => {
    const p = profileFromVertices([[0, 0], [0, 0.01], [0, 0.02]], [0, 100, 300], 5);
    expect(p).toEqual([0, 50, 100, 200, 300]);
  });
  it('returns nothing for degenerate input', () => {
    expect(profileFromVertices([[0, 0], [0, 0]], [1, 2])).toEqual([]);
    expect(profileFromVertices([[0, 0], [0, 1]], [1])).toEqual([]);
  });
});
