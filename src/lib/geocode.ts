// Place search (Nominatim), leaning on the covered regions so "Rainier" means the mountain, not a town elsewhere.
// The public Nominatim fallback is removed in a separate change; this only stops it being tied to one state.
export interface Place { name: string; detail: string; lon: number; lat: number; bbox: [number, number, number, number] }

const URL_BASE = 'https://nominatim.openstreetmap.org/search';

/** One request. `bias` (from the covered regions) adds a preferred viewbox (not bounded) and country codes; without it the search is worldwide. */
export function placeQueryUrl(q: string, bias: { viewbox?: string; countrycodes?: string } = {}): string {
  const p = new URLSearchParams({ format: 'jsonv2', limit: '5', q });
  if (bias.countrycodes) p.set('countrycodes', bias.countrycodes);
  if (bias.viewbox) { p.set('viewbox', bias.viewbox); p.set('bounded', '0'); }
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

/** One request per search, only when the user submits (never while typing); repeats come from memory. */
export async function searchPlaces(q: string, signal?: AbortSignal, bias: { viewbox?: string; countrycodes?: string } = {}): Promise<Place[]> {
  const key = `${q.trim().toLowerCase()}|${bias.viewbox ?? ''}|${bias.countrycodes ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const res = await fetch(placeQueryUrl(q, bias), { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Place search failed (${res.status}).`);
  const places = toPlaces(await res.json());
  cache.set(key, places);
  return places;
}
