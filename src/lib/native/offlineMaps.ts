// Offline maps inside the apps. The web app serves saved map tiles and fonts from Cache Storage through a service
// worker (src/sw.ts); the apps have no service worker, so MapLibre asks this loader instead, which reads the same
// caches ("Save offline" writes them) and falls back to the network.
import { TILE_HOST, OFFLINE_CACHE, RUNTIME_TILE_CACHE, GLYPH_CACHE, tileCacheKey } from '../tiles';
import { isNative } from './platform';

export const PROTOCOL = 'rlcache';
const MAX_RUNTIME_TILES = 3000; // same cap as the service worker's recent-browsing cache

export interface Deps {
  caches: CacheStorage | undefined;
  fetch: typeof fetch;
}
const defaults = (): Deps => ({ caches: typeof caches === 'undefined' ? undefined : caches, fetch: (...a) => fetch(...a) });

const isTile = (u: URL) => u.hostname === TILE_HOST && u.pathname.endsWith('.pbf') && u.pathname.includes('/planet/');
const isGlyph = (u: URL) => u.hostname === TILE_HOST && u.pathname.startsWith('/fonts/');

/** MapLibre transformRequest: send map tile and font requests through the cache loader (native only). */
export function transformRequest(url: string): { url: string } | undefined {
  if (!isNative()) return undefined;
  try {
    const u = new URL(url);
    return isTile(u) || isGlyph(u) ? { url: `${PROTOCOL}://${url}` } : undefined;
  } catch { return undefined; }
}

const read = async (r: Response | undefined) => (r ? r.arrayBuffer() : undefined);
let puts = 0;

async function trim(cache: Cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_RUNTIME_TILES))) await cache.delete(k);
}

/** Saved tile, then recent tile, then network; an empty tile when offline and unseen (like the service worker). */
export async function loadTile(url: string, d: Deps = defaults()): Promise<ArrayBuffer> {
  const key = tileCacheKey(url) ?? url;
  const store = d.caches;
  const saved = store ? await read(await (await store.open(OFFLINE_CACHE)).match(key)) : undefined;
  if (saved) return saved;
  const runtime = store ? await store.open(RUNTIME_TILE_CACHE) : undefined;
  const recent = runtime ? await read(await runtime.match(key)) : undefined;
  try {
    const res = await d.fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const buf = await res.arrayBuffer();
    if (runtime) {
      await runtime.put(key, new Response(buf.slice(0), { headers: { 'Content-Type': 'application/x-protobuf' } }));
      if (++puts % 100 === 0) void trim(runtime);
    }
    return buf;
  } catch {
    return recent ?? new ArrayBuffer(0);
  }
}

/** Fonts: any cache first, then network (kept for next time). */
export async function loadGlyph(url: string, d: Deps = defaults()): Promise<ArrayBuffer> {
  const hit = d.caches ? await read(await d.caches.match(url)) : undefined;
  if (hit) return hit;
  try {
    const res = await d.fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const buf = await res.arrayBuffer();
    if (d.caches) await (await d.caches.open(GLYPH_CACHE)).put(url, new Response(buf.slice(0)));
    return buf;
  } catch {
    return new ArrayBuffer(0);
  }
}

export async function loadMapResource(requestUrl: string, d?: Deps): Promise<ArrayBuffer> {
  const url = requestUrl.startsWith(`${PROTOCOL}://`) ? requestUrl.slice(PROTOCOL.length + 3) : requestUrl;
  return isGlyph(new URL(url)) ? loadGlyph(url, d) : loadTile(url, d);
}

/** Round-trips one entry through Cache Storage; logged once at start-up so a simulator or device log shows whether it works. */
export async function probeCacheStorage(): Promise<string> {
  try {
    if (typeof caches === 'undefined') return 'no-cache-storage';
    const c = await caches.open('rl-probe');
    await c.put('/probe', new Response('ok'));
    const ok = (await (await c.match('/probe'))?.text()) === 'ok';
    await caches.delete('rl-probe');
    return ok ? 'ok' : 'roundtrip-failed';
  } catch (e) { return `error:${e instanceof Error ? e.message : e}`; }
}
