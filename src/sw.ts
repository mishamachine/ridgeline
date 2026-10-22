/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';
import { CacheExpiration } from 'workbox-expiration';
import { TILE_HOST, OFFLINE_CACHE, RUNTIME_TILE_CACHE, GLYPH_CACHE, tileCacheKey } from './lib/tiles';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

const tileExpiry = new CacheExpiration(RUNTIME_TILE_CACHE, { maxEntries: 3000, maxAgeSeconds: 14 * 24 * 3600 });
const emptyTile = () => new Response(new ArrayBuffer(0), { status: 200, headers: { 'Content-Type': 'application/x-protobuf' } });

// Map tiles: saved (offline) cache first, then recent-browsing cache, then network.
registerRoute(
  ({ url }) => url.hostname === TILE_HOST && url.pathname.endsWith('.pbf') && url.pathname.includes('/planet/'),
  async ({ request }) => {
    const key = tileCacheKey(request.url)!;
    const saved = await (await caches.open(OFFLINE_CACHE)).match(key);
    if (saved) return saved;
    const runtime = await caches.open(RUNTIME_TILE_CACHE);
    const recent = await runtime.match(key);
    try {
      const res = await fetch(request);
      if (res.ok) {
        await runtime.put(key, res.clone());
        tileExpiry.updateTimestamp(key).then(() => tileExpiry.expireEntries());
      }
      return res;
    } catch {
      return recent ?? emptyTile();
    }
  },
);

// Label fonts: any cache first, then network.
registerRoute(
  ({ url }) => url.hostname === TILE_HOST && url.pathname.startsWith('/fonts/'),
  async ({ request }) => {
    const hit = await caches.match(request.url);
    if (hit) return hit;
    try {
      const res = await fetch(request);
      if (res.ok) await (await caches.open(GLYPH_CACHE)).put(request.url, res.clone());
      return res;
    } catch {
      return new Response(new ArrayBuffer(0), { status: 200 });
    }
  },
);
