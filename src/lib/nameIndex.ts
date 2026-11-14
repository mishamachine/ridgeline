// Trail-name search over the hosted index (trails/names.json, built by scripts/name_index.py).
import { haversine, type LngLat } from './geo';
import { trailBase } from './native/trailBase';
import { getIndex } from './cells';
import { byDistance, distanceDeg, regionsOf, type CoverageRegion } from './coverage';

/** [id, name, lon, lat, length in metres] */
export type NameEntry = [string, string, number, number, number];
interface NameFile { v: number; e: NameEntry[] }


const NEAR_DEG = 1.5;   // regions within this many degrees of the map (about 150 km) load with the nearest one
const shards = new Map<string, Promise<NameEntry[]>>();
let legacy: Promise<NameEntry[]> | null = null;

const fetchNames = (file: string): Promise<NameEntry[]> =>
  fetch(`${trailBase()}${file}`).then((r) => (r.ok ? (r.json() as Promise<NameFile>) : null)).then((f) => f?.e ?? []).catch(() => []);

function shard(r: CoverageRegion): Promise<NameEntry[]> {
  let p = shards.get(r.id);
  if (!p) {
    p = fetchNames(r.names ?? `names/${r.id}.json`).then((e) => { if (!e.length) shards.delete(r.id); return e; });
    shards.set(r.id, p);
  }
  return p;
}

const dedupe = (lists: NameEntry[][]): NameEntry[] => {
  const seen = new Set<string>();
  return lists.flat().filter((e) => !seen.has(e[0]) && !!seen.add(e[0]));
};

/**
 * Trail names for search, one shard per covered region (names/<region>.json), fetched only when someone starts searching.
 * With `near` (the map centre) only the nearest region and those within ~150 km load; without it, every region.
 * Empty when none is deployed. Builds with no region list fall back to the single names.json.
 */
export async function loadNameIndex(near?: LngLat): Promise<NameEntry[]> {
  const regions = regionsOf(await getIndex().catch(() => null)).filter((r) => r.names);
  if (!regions.length) {
    legacy ??= fetchNames('names.json').then((e) => { if (!e.length) legacy = null; return e; });
    return legacy;
  }
  let pick = regions;
  if (near) {
    const sorted = byDistance(regions, near);
    pick = sorted.filter((r, i) => i === 0 || distanceDeg(r, near) <= NEAR_DEG);
  }
  return dedupe(await Promise.all(pick.map(shard)));
}

export const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Best matches for typed text: exact, then starts-with, then word-starts, then contains. Same-name twins close together are merged. */
export function searchNames(entries: NameEntry[], query: string, limit = 6, near?: LngLat): NameEntry[] {
  const q = norm(query);
  if (q.length < 2) return [];
  const words = q.split(' ');
  const scored: { e: NameEntry; s: number }[] = [];
  for (const e of entries) {
    const n = norm(e[1]);
    let s = 0;
    if (n === q) s = 100;
    else if (n.startsWith(q)) s = 80;
    else if (n.split(' ').some((w) => w.startsWith(q))) s = 60;
    else if (n.includes(q)) s = 45;
    else if (words.length > 1 && words.every((w) => n.includes(w))) s = 35;
    if (!s) continue;
    if (e[0].startsWith('osm-r')) s += 10;
    s += Math.min(8, e[4] / 1000) / 2; // longer named trails beat tiny stubs
    if (near) s -= Math.min(6, haversine(near, [e[2], e[3]]) / 40000);
    scored.push({ e, s });
  }
  scored.sort((a, b) => b.s - a.s);
  const out: NameEntry[] = [];
  for (const { e } of scored) {
    if (out.some((o) => o[1].toLowerCase() === e[1].toLowerCase() && haversine([o[2], o[3]], [e[2], e[3]]) < 5000)) continue;
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}
