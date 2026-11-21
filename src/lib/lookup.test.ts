import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Trail } from './trails';

// The name index lists a named path as "osm-w<lowest way id>" (scripts/name_index.py); the cells build it as "osm-w<lowest way id>-<n>".
const trailAt = (id: string, lon: number, lat: number, extra: Partial<Trail> = {}): Trail => ({
  id, name: 'Cedar River Trail', coords: [[lon, lat], [lon + 0.001, lat]], lengthM: 90, loop: false, partial: false,
  osmUrl: 'https://www.openstreetmap.org/way/6338704', tags: {}, highlights: [], ...extra,
});
const south = trailAt('osm-w6338704-0', -122.2, 47.4);
const north = trailAt('osm-w6338704-1', -122.2, 47.5);
const other = trailAt('osm-w99-0', -122.2, 47.4, { name: 'Elsewhere' });

const fetchCellTrails = vi.fn(async () => [south, north, other] as Trail[]);
let saved: Record<string, Trail> = {};
vi.mock('./cells', () => ({ fetchCellTrails: (...a: unknown[]) => (fetchCellTrails as (...x: unknown[]) => unknown)(...a) }));
vi.mock('./store', () => ({
  getSaved: async (id: string) => (saved[id] ? { trail: saved[id] } : undefined),
  getShortlisted: async () => undefined,
}));
vi.mock('./nameIndex', () => ({ loadNameIndex: async () => [['osm-w6338704', 'Cedar River Trail', -122.2, 47.4, 4000]] }));

async function load() { vi.resetModules(); return import('./lookup'); }
beforeEach(() => { saved = {}; fetchCellTrails.mockClear(); });

describe('pickChained', () => {
  it('takes the trail nearest the hint, and the first with no hint', async () => {
    const { pickChained } = await load();
    expect(pickChained([north, south, other], 'osm-w6338704', [-122.2, 47.499])?.id).toBe('osm-w6338704-1');
    expect(pickChained([north, south, other], 'osm-w6338704', [-122.2, 47.401])?.id).toBe('osm-w6338704-0');
    expect(pickChained([north, south, other], 'osm-w6338704')?.id).toBe('osm-w6338704-0');
  });
  it('does not match another way whose id only starts with the same digits', async () => {
    const { pickChained } = await load();
    expect(pickChained([trailAt('osm-w63387041-0', 0, 0)], 'osm-w6338704')).toBeNull();
    expect(pickChained([], 'osm-w6338704')).toBeNull();
  });
});

describe('resolveTrail with a bare way id', () => {
  it('opens the chained trail nearest the link hint', async () => {
    const { resolveTrail } = await load();
    expect((await resolveTrail('osm-w6338704', [-122.2, 47.5]))?.id).toBe('osm-w6338704-1');
  });
  it('with no hint, finds the place in the name index and takes the first', async () => {
    const { resolveTrail } = await load();
    expect((await resolveTrail('osm-w6338704'))?.id).toBe('osm-w6338704-0');
  });
  it('still resolves an exact id, and a full id with no hint via its bare index entry', async () => {
    const { resolveTrail } = await load();
    expect((await resolveTrail('osm-w6338704-1', [-122.2, 47.5]))?.id).toBe('osm-w6338704-1');
    expect((await resolveTrail('osm-w6338704-0'))?.id).toBe('osm-w6338704-0');
  });
  it('a saved copy under the full id wins over the network', async () => {
    saved['osm-w6338704-1'] = north;
    const { resolveTrail } = await load();
    expect((await resolveTrail('osm-w6338704-1'))?.id).toBe('osm-w6338704-1');
    expect(fetchCellTrails).not.toHaveBeenCalled();
  });
  it('returns null when nothing matches, and never matches a relation id by prefix', async () => {
    const { resolveTrail } = await load();
    expect(await resolveTrail('osm-w5', [-122.2, 47.4])).toBeNull();
    expect(await resolveTrail('osm-r6338704', [-122.2, 47.4])).toBeNull();
  });
});
