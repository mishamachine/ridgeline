// Place search (Nominatim), leaning on Washington so "Rainier" means the mountain, not a town in Oregon.
export interface Place { name: string; detail: string; lon: number; lat: number; bbox: [number, number, number, number] }

// west, north, east, south
export const WA_VIEWBOX = '-124.9,49.1,-116.9,45.5';
const URL_BASE = 'https://nominatim.openstreetmap.org/search';

export function placeQueryUrl(q: string, bounded: boolean): string {
  const p = new URLSearchParams({ format: 'jsonv2', limit: '5', countrycodes: 'us', viewbox: WA_VIEWBOX, bounded: bounded ? '1' : '0', q });
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

/** Washington first; anywhere in the US only if nothing matches there. */
export async function searchPlaces(q: string, signal?: AbortSignal): Promise<Place[]> {
  for (const bounded of [true, false]) {
    const res = await fetch(placeQueryUrl(q, bounded), { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Place search failed (${res.status}).`);
    const places = toPlaces(await res.json());
    if (places.length) return places;
  }
  return [];
}
