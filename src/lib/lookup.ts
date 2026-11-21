// Find one trail by id when the app only has a link: saved copy, the link's location hint, then the name index.
import { fetchCellTrails } from './cells';
import { getSaved, getShortlisted } from './store';
import { loadNameIndex } from './nameIndex';
import { haversine, type LngLat } from './geo';
import type { Trail } from './trails';

const memory = new Map<string, Trail>();
export const remember = (ts: Trail[]) => ts.forEach((t) => memory.set(t.id, t));

/** The name index lists a named path as "osm-w<lowest way id>"; the cells build the same trail as "osm-w<lowest way id>-<n>". */
const BARE_WAY = /^osm-w(\d+)$/;
const CHAINED_WAY = /^osm-w(\d+)-\d+$/;

/** Of the trails built from one way id, the one passing nearest the hint; with no hint, the first. */
export function pickChained(found: Trail[], bare: string, hint?: LngLat | null): Trail | null {
  const mine = found.filter((t) => t.id.startsWith(`${bare}-`));
  const order = (t: Trail) => +t.id.slice(bare.length + 1);
  mine.sort((a, b) => order(a) - order(b));
  if (!hint || mine.length < 2) return mine[0] ?? null;
  const gap = (t: Trail) => Math.min(...t.coords.map((c) => haversine(hint, c)));
  return mine.reduce((best, t) => (gap(t) < gap(best) ? t : best));
}

const normName = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const SAME_NAME_M = 1000;

/** The index groups same-named ways by their lowest way id; the cells can group them under a lower one. If no id matches, take the trail with the same name nearest the hint, within about 1 km. */
export function pickByName(found: Trail[], name: string, hint: LngLat): Trail | null {
  const want = normName(name);
  let best: Trail | null = null, bestGap = SAME_NAME_M;
  for (const t of found) {
    if (normName(t.name) !== want) continue;
    const gap = Math.min(...t.coords.map((c) => haversine(hint, c)));
    if (gap <= bestGap) { best = t; bestGap = gap; }
  }
  return best;
}

async function near(ll: LngLat, id: string, r: number, signal?: AbortSignal, hint?: LngLat | null): Promise<Trail | null> {
  const box = { west: ll[0] - r, east: ll[0] + r, south: ll[1] - r, north: ll[1] + r };
  const found = (await fetchCellTrails(box, signal)) ?? [];
  const exact = found.find((t) => t.id === id);
  if (exact || !BARE_WAY.test(id)) return exact ?? null;
  const chained = pickChained(found, id, hint);
  if (chained) return chained;
  const entry = (await loadNameIndex(ll)).find((x) => x[0] === id);
  return entry ? pickByName(found, entry[1], ll) : null;
}

export async function resolveTrail(id: string, hint?: LngLat | null, signal?: AbortSignal): Promise<Trail | null> {
  const local = memory.get(id) ?? (await getSaved(id))?.trail ?? (await getShortlisted(id))?.trail;
  if (local) return local;
  let ll = hint ?? null;
  if (!ll) {
    // The index holds the bare form, so a full id looks up its bare form too.
    const bare = CHAINED_WAY.exec(id);
    const e = (await loadNameIndex()).find((x) => x[0] === id || (bare && x[0] === `osm-w${bare[1]}`));
    if (e) ll = [e[2], e[3]];
  }
  if (!ll) return null;
  // A route can run past the cells next to its start; if it comes back as a section, look wider.
  let t = await near(ll, id, 0.02, signal, hint);
  if (t?.partial) t = (await near(ll, id, 0.3, signal, hint)) ?? t;
  if (t) { memory.set(id, t); memory.set(t.id, t); }
  return t;
}
