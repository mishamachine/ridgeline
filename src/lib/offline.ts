// Saving trails for offline use: route data in IndexedDB, map tiles in Cache Storage.
import { bboxOf, tilesForBBox } from './geo';
import type { Trail } from './trails';
import { listSaved, putSaved, deleteSaved, getSaved, getSetting, putSetting, SavedTrail } from './store';
import { TILEJSON_URL, OFFLINE_CACHE, FONTSTACKS, GLYPH_RANGES, glyphUrl, tileCacheKey, TILE_HOST } from './tiles';

// OpenFreeMap allows offline area downloads up to 3,000 tiles or 50 MB, 4 parallel requests.
export const MAX_TILES = 3000;
export const MAX_BYTES = 50 * 1024 * 1024;
const PARALLEL = 4;
const ZOOMS: [number, number] = [10, 14]; // vector data stops at z14; the map scales it up beyond that
const PAD_M = 1500;

/** Current versioned tile URL template, remembered for offline starts. */
export async function getTileTemplate(): Promise<string> {
  try {
    const res = await fetch(TILEJSON_URL, { cache: 'no-cache' });
    const tj = await res.json();
    const tpl = tj.tiles[0] as string;
    await putSetting('tileTemplate', tpl);
    return tpl;
  } catch {
    return (await getSetting<string>('tileTemplate')) ?? `https://${TILE_HOST}/planet/latest/{z}/{x}/{y}.pbf`;
  }
}

export function tilesForTrail(t: Trail) {
  let tiles = tilesForBBox(bboxOf(t.coords, PAD_M), ZOOMS[0], ZOOMS[1]);
  // Very long trails: drop the closest zoom rather than exceed the provider's limit.
  if (tiles.length > MAX_TILES) tiles = tilesForBBox(bboxOf(t.coords, PAD_M), ZOOMS[0], ZOOMS[1] - 1);
  return tiles;
}

export async function saveTrailOffline(
  trail: Trail,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<SavedTrail> {
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  const template = await getTileTemplate();
  const tiles = tilesForTrail(trail);
  if (tiles.length > MAX_TILES) throw new Error('This trail is too long to save in one piece.');

  const cache = await caches.open(OFFLINE_CACHE);
  const glyphs = FONTSTACKS.flatMap((f) => GLYPH_RANGES.map((r) => glyphUrl(f, r)));
  const jobs: { url: string; key: string }[] = [
    ...tiles.map(([z, x, y]) => {
      const url = template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
      return { url, key: tileCacheKey(url) ?? url };
    }),
    ...glyphs.map((u) => ({ url: u, key: u })),
  ];

  let done = 0, bytes = 0, next = 0;
  const keys: string[] = [];
  const worker = async () => {
    while (next < jobs.length) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const job = jobs[next++];
      if (!(await cache.match(job.key))) {
        const res = await fetch(job.url, { signal });
        if (!res.ok && res.status !== 404 && res.status !== 204) throw new Error(`Map download failed (${res.status}).`);
        const buf = await res.arrayBuffer();
        bytes += buf.byteLength;
        if (bytes > MAX_BYTES) throw new Error('This area is over the 50 MB offline limit.');
        await cache.put(job.key, new Response(buf, { headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream' } }));
      }
      if (!job.key.includes('/fonts/')) keys.push(job.key);
      onProgress(++done, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  const saved: SavedTrail = { trail, savedAt: Date.now(), tileKeys: keys, bytes };
  await putSaved(saved);
  return saved;
}

/** Remove a saved trail and any tiles no other saved trail uses. */
export async function removeTrailOffline(id: string) {
  const target = await getSaved(id);
  if (!target) return;
  const others = (await listSaved()).filter((s) => s.trail.id !== id);
  const stillUsed = new Set(others.flatMap((s) => s.tileKeys));
  const cache = await caches.open(OFFLINE_CACHE);
  await Promise.all(target.tileKeys.filter((k) => !stillUsed.has(k)).map((k) => cache.delete(k)));
  await deleteSaved(id);
}

export async function storageEstimate(): Promise<{ used: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return { used: e.usage ?? 0, quota: e.quota ?? 0 };
}
