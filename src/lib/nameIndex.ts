// Trail-name search over the hosted index (trails/names.json, built by scripts/name_index.py).
import { haversine, type LngLat } from './geo';
import { trailBase } from './native/trailBase';

/** [id, name, lon, lat, length in metres] */
export type NameEntry = [string, string, number, number, number];
interface NameFile { v: number; e: NameEntry[] }


let promise: Promise<NameEntry[]> | null = null;

/** The whole index, fetched once, only when someone starts searching. Empty when none is deployed. */
export function loadNameIndex(): Promise<NameEntry[]> {
  promise ??= fetch(`${trailBase()}names.json`)
    .then((r) => (r.ok ? (r.json() as Promise<NameFile>) : null))
    .then((f) => f?.e ?? [])
    .catch(() => [] as NameEntry[])
    .then((e) => { if (!e.length) promise = null; return e; });
  return promise;
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
