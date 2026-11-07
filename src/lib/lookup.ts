// Find one trail by id when the app only has a link: saved copy, the link's location hint, then the name index.
import { fetchCellTrails } from './cells';
import { getSaved, getShortlisted } from './store';
import { loadNameIndex } from './nameIndex';
import type { LngLat } from './geo';
import type { Trail } from './trails';

const memory = new Map<string, Trail>();
export const remember = (ts: Trail[]) => ts.forEach((t) => memory.set(t.id, t));

async function near(ll: LngLat, id: string, r: number, signal?: AbortSignal): Promise<Trail | null> {
  const box = { west: ll[0] - r, east: ll[0] + r, south: ll[1] - r, north: ll[1] + r };
  const found = (await fetchCellTrails(box, signal)) ?? [];
  return found.find((t) => t.id === id) ?? null;
}

export async function resolveTrail(id: string, hint?: LngLat | null, signal?: AbortSignal): Promise<Trail | null> {
  const local = memory.get(id) ?? (await getSaved(id))?.trail ?? (await getShortlisted(id))?.trail;
  if (local) return local;
  let ll = hint ?? null;
  if (!ll) {
    const e = (await loadNameIndex()).find((x) => x[0] === id);
    if (e) ll = [e[2], e[3]];
  }
  if (!ll) return null;
  // A route can run past the cells next to its start; if it comes back as a section, look wider.
  let t = await near(ll, id, 0.02, signal);
  if (t?.partial) t = (await near(ll, id, 0.3, signal)) ?? t;
  if (t) memory.set(id, t);
  return t;
}
