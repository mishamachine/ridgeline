import { describe, expect, it } from 'vitest';
import { LEDGE_CELL, RICH_INDEX, richCell } from '../../e2e/fixtures';
import { cellsToTrails } from './cells';
import { NO_FILTERS, ROW_MIN, applyFilters, buildCollections, coverageRegions } from './home';
import { searchNames, type NameEntry } from './nameIndex';

// The fixture the browser screenshots use: real geometry, with tags added so every row has trails.
describe('screenshot fixture', () => {
  const trails = cellsToTrails([richCell()]);
  it('fills all four rows', () => {
    const rows = buildCollections(trails, [-122.03, 47.53]);
    expect(rows.map((r) => r.id)).toEqual(['top', 'view', 'dogs', 'falls']);
    expect(rows.every((r) => r.trails.length >= ROW_MIN)).toBe(true);
  });
  it('hides a row with 2 matching trails and shows it with 3', () => {
    const [a, b, c] = trails.slice(0, 3);
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

describe('stats mismatch', () => {
  const trails = cellsToTrails([richCell()]);
  const pool = trails.slice(0, 5).map((t, i) => ({ ...t, id: `${t.id}-${i}`, name: `${t.name} ${i}`, highlights: ['falls', 'view'], coords: t.coords.map(([x, y]) => [x + i * 0.3, y] as [number, number]) }));

  it('keeps a mismatched trail out of every collection row, but in All trails (and on the map)', () => {
    const bad = { ...pool[0], statsMismatch: true };
    const all = [bad, ...pool.slice(1)];
    const ids = buildCollections(all).flatMap((r) => r.trails.map((t) => t.id));
    expect(ids).not.toContain(bad.id);
    expect(ids).toContain(pool[1].id);
    expect(applyFilters(all, NO_FILTERS).map((t) => t.id)).toContain(bad.id);   // All trails / filters
  });
  it('the row-size rule still holds: a row that falls under ROW_MIN once the trail is out is hidden', () => {
    const three = [{ ...pool[0], statsMismatch: true }, pool[1], pool[2]];
    expect(buildCollections(three).find((r) => r.id === 'falls')).toBeUndefined();
    expect(buildCollections(pool.slice(0, 3)).find((r) => r.id === 'falls')?.trails).toHaveLength(3);
  });
  it('search by name does not look at the flag', () => {
    const names = [['osm-w1-0', 'Woodpecker', -120.27, 48.44, 7719]] as NameEntry[];
    expect(searchNames(names, 'woodp').map((e) => e[1])).toEqual(['Woodpecker']);
  });
});
