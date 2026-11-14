import { describe, expect, it } from 'vitest';
import { LEDGE_CELL, RICH_INDEX, richCell } from '../../e2e/fixtures';
import { cellsToTrails } from './cells';
import { buildCollections, coverageRegions } from './home';

// The fixture the browser screenshots use: real geometry, with tags added so every row has trails.
describe('screenshot fixture', () => {
  const trails = cellsToTrails([richCell()]);
  it('fills all four rows', () => {
    const rows = buildCollections(trails, [-122.03, 47.53]);
    expect(rows.map((r) => r.id)).toEqual(['top', 'view', 'dogs', 'falls']);
    expect(rows.every((r) => r.trails.length >= 2)).toBe(true);
  });
  it('covers Washington around Seattle and Snoqualmie', () => {
    expect(coverageRegions(RICH_INDEX).map((r) => r.code)).toEqual(['WA']);
  });
  it('the single-cell fixture is still the real Ledge cell', () => {
    expect(cellsToTrails([LEDGE_CELL])[0].name).toBe('Rattlesnake Ledge Trail');
  });
});
