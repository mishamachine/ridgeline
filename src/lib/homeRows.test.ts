import { describe, expect, it } from 'vitest';
import { LEDGE_CELL, RICH_INDEX, richCell } from '../../e2e/fixtures';
import { cellsToTrails } from './cells';
import { ROW_MIN, buildCollections, coverageRegions } from './home';

// The fixture the browser screenshots use: real geometry, with tags added so every row has trails.
describe('screenshot fixture', () => {
  const trails = cellsToTrails([richCell()]);
  it('fills all four rows', () => {
    const rows = buildCollections(trails, [-122.03, 47.53]);
    expect(rows.map((r) => r.id)).toEqual(['top', 'view', 'dogs', 'falls']);
    expect(rows.every((r) => r.trails.length >= ROW_MIN)).toBe(true);
  });
  it('hides a row with 2 matching trails and shows it with 3', () => {
    const [a, b, c] = trails.filter((t) => t.highlights?.includes('falls') || true).slice(0, 3);
    const tagged = (t: typeof a, i: number) => ({ ...t, id: `${t.id}-${i}`, name: `${t.name} ${i}`, highlights: ['falls'], coords: t.coords.map(([x, y]) => [x + i * 0.3, y] as [number, number]) });
    expect(ROW_MIN).toBe(3);
    expect(buildCollections([a, b, c].slice(0, 2).map(tagged)).find((r) => r.id === 'falls')).toBeUndefined();
    expect(buildCollections([a, b, c].map(tagged)).find((r) => r.id === 'falls')?.trails).toHaveLength(3);
  });
  it('has no spur duplicated at one place (names differ, geometry from different real ways)', () => {
    expect(new Set(trails.map((t) => t.name)).size).toBe(trails.length);
  });
  it('covers Washington around Seattle and Snoqualmie', () => {
    expect(coverageRegions(RICH_INDEX).map((r) => r.code)).toEqual(['WA']);
  });
  it('the single-cell fixture is still the real Ledge cell', () => {
    expect(cellsToTrails([LEDGE_CELL])[0].name).toBe('Rattlesnake Ledge Trail');
  });
});
