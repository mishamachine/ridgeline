// Place search (Nominatim): one request per Enter, US and Canada (BC), no regional bias.
export interface Place { name: string; detail: string; lon: number; lat: number; bbox: [number, number, number, number] }

const URL_BASE = 'https://nominatim.openstreetmap.org/search';

/** One request: US and Canada. */
export function placeQueryUrl(q: string): string {
  const p = new URLSearchParams({ format: 'jsonv2', limit: '5', countrycodes: 'us,ca', q });
  return `${URL_BASE}?${p}`;
}

interface Hit { display_name: string; name?: string; lon: string; lat: string; boundingbox: string[] }

export function toPlaces(hits: Hit[]): Place[] {
  return hits.map((h) => {
    const [s, n, w, e] = h.boundingbox.map(Number);
    const parts = h.display_name.split(', ');
    return { name: h.name || parts[0], detail: parts.slice(1, 3).join(', '), lon: Number(h.lon), lat: Number(h.lat), bbox: [w, s, e, n] };
  });
}

const cache = new Map<string, Place[]>();

/** Answer already in memory for this query, if any. */
export const cachedPlaces = (q: string) => cache.get(q.trim().toLowerCase());

/** One request per search, only when the user submits (never while typing); repeats come from memory. */
export async function searchPlaces(q: string, signal?: AbortSignal): Promise<Place[]> {
  const key = q.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const res = await fetch(placeQueryUrl(q), { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Place search failed (${res.status}).`);
  const places = toPlaces(await res.json());
  cache.set(key, places);
  return places;
}
