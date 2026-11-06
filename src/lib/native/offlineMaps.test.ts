import { describe, it, expect, vi } from 'vitest';
import { loadMapResource, loadTile, transformRequest, PROTOCOL, type Deps } from './offlineMaps';
import { OFFLINE_CACHE, RUNTIME_TILE_CACHE, GLYPH_CACHE } from '../tiles';

// A tiny in-memory CacheStorage (keyed by URL string).
function fakeCaches(): CacheStorage & { stores: Map<string, Map<string, ArrayBuffer>> } {
  const stores = new Map<string, Map<string, ArrayBuffer>>();
  const open = async (name: string) => {
    const m = stores.get(name) ?? new Map<string, ArrayBuffer>();
    stores.set(name, m);
    return {
      match: async (k: string) => (m.has(k) ? new Response(m.get(k)!.slice(0)) : undefined),
      put: async (k: string, r: Response) => { m.set(k, await r.arrayBuffer()); },
      keys: async () => [...m.keys()].map((k) => new Request(k)),
      delete: async (k: string | Request) => m.delete(typeof k === 'string' ? k : k.url),
    } as unknown as Cache;
  };
  return {
    stores, open,
    match: async (k: string) => { for (const m of stores.values()) if (m.has(k)) return new Response(m.get(k)!.slice(0)); return undefined; },
  } as unknown as CacheStorage & { stores: Map<string, Map<string, ArrayBuffer>> };
}
const bytes = (...n: number[]) => new Uint8Array(n).buffer;
const arr = (b: ArrayBuffer) => [...new Uint8Array(b)];

// The versioned URL MapLibre asks for; saved tiles are cached under the version-free key (tiles.ts).
const TILE = 'https://tiles.openfreemap.org/planet/20261018_080001_pt/12/655/1427.pbf';
const KEY = 'https://tiles.openfreemap.org/planet/12/655/1427.pbf';
const GLYPH = 'https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf';

describe('offline maps in the apps', () => {
  it('serves a saved tile without touching the network', async () => {
    const c = fakeCaches();
    await (await c.open(OFFLINE_CACHE)).put(KEY, new Response(bytes(1, 2, 3)));
    const fetchFn = vi.fn();
    const d: Deps = { caches: c, fetch: fetchFn as unknown as typeof fetch };
    expect(arr(await loadMapResource(`${PROTOCOL}://${TILE}`, d))).toEqual([1, 2, 3]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('falls back to the network, remembers the tile, and serves it when offline', async () => {
    const c = fakeCaches();
    const online: Deps = { caches: c, fetch: (async () => new Response(bytes(9, 9))) as unknown as typeof fetch };
    expect(arr(await loadTile(TILE, online))).toEqual([9, 9]);
    expect(c.stores.get(RUNTIME_TILE_CACHE)!.has(KEY)).toBe(true);
    const offline: Deps = { caches: c, fetch: (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch };
    expect(arr(await loadTile(TILE, offline))).toEqual([9, 9]);
  });

  it('answers an empty tile when offline and never seen', async () => {
    const d: Deps = { caches: fakeCaches(), fetch: (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch };
    expect((await loadTile(TILE, d)).byteLength).toBe(0);
  });

  it('serves fonts from any cache, else fetches and keeps them', async () => {
    const c = fakeCaches();
    await (await c.open(GLYPH_CACHE)).put(GLYPH, new Response(bytes(7)));
    const off: Deps = { caches: c, fetch: (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch };
    expect(arr(await loadMapResource(`${PROTOCOL}://${GLYPH}`, off))).toEqual([7]);
    const c2 = fakeCaches();
    const on: Deps = { caches: c2, fetch: (async () => new Response(bytes(5))) as unknown as typeof fetch };
    expect(arr(await loadMapResource(GLYPH, on))).toEqual([5]);
    expect(c2.stores.get(GLYPH_CACHE)!.has(GLYPH)).toBe(true);
  });

  it('still loads from the network when Cache Storage is missing', async () => {
    const d: Deps = { caches: undefined, fetch: (async () => new Response(bytes(4))) as unknown as typeof fetch };
    expect(arr(await loadTile(TILE, d))).toEqual([4]);
  });

  it('does not rewrite requests in a browser', () => {
    expect(transformRequest(TILE)).toBeUndefined();
  });
});
