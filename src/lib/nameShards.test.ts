import { afterEach, describe, expect, it, vi } from 'vitest';

const index = { v: 1, built: '', source: '', cell: 0.25, bbox: null, cells: [], regions: [
  { id: 'washington', name: 'Washington', bbox: [-124.75, 45.5, -116.75, 49], names: 'names/washington.json' },
  { id: 'oregon', name: 'Oregon', bbox: [-124.75, 41.75, -116.25, 46.25], names: 'names/oregon.json' },
  { id: 'california', name: 'California', bbox: [-124.5, 32.5, -114, 42], names: 'names/california.json' },
] };
const shardBody = (id: string) => ({ v: 1, e: [[`osm-r-${id}`, `${id} Trail`, 0, 0, 1000]] });

async function setup() {
  vi.resetModules();
  const urls: string[] = [];
  vi.stubGlobal('fetch', async (u: string) => {
    urls.push(u);
    const m = /names\/(\w+)\.json/.exec(u);
    return new Response(JSON.stringify(m ? shardBody(m[1]) : index));
  });
  return { urls, mod: await import('./nameIndex') };
}
afterEach(() => vi.unstubAllGlobals());

describe('name shards', () => {
  it('loads only the nearest region and those close by', async () => {
    const { urls, mod } = await setup();
    const e = await mod.loadNameIndex([-122.3, 47.6]); // Seattle: Washington, and Oregon is 1.3 deg away; California is far
    expect(e.map((x) => x[0]).sort()).toEqual(['osm-r-oregon', 'osm-r-washington']);
    expect(urls.some((u) => u.includes('california'))).toBe(false);
  });
  it('loads every shard with no position, and fetches each once', async () => {
    const { urls, mod } = await setup();
    expect((await mod.loadNameIndex()).length).toBe(3);
    await mod.loadNameIndex([-122.3, 47.6]);
    expect(urls.filter((u) => u.includes('names/washington')).length).toBe(1);
  });
});
