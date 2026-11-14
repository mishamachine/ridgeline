// Trail data for the browser specs, built from the real cell slices checked in at src/lib/fixtures/wa-cells.json
// (real relations from the hosted WA v1 cells around Snoqualmie, with their elevation). Nothing is fetched from a live host.
import { readFileSync } from 'node:fs';
import type { CellFile, CellIndex } from '../src/lib/cells';

type Slice = CellFile;
const slices = JSON.parse(readFileSync(new URL('../src/lib/fixtures/wa-cells.json', import.meta.url), 'utf8')) as Record<string, Slice[]>;

export const LEDGE_CELL = slices.ledge[0];
/** One-cell index, as the e2e prepare script writes it. */
export const LEDGE_INDEX: CellIndex = { v: 1, built: '2026-11-06T00:00:00Z', source: 'e2e fixture', elevation: 'Copernicus DEM GLO-90', cell: 0.25, bbox: [-122, 47.25, -121.5, 47.5], cells: ['232_549'] };

const metres = (a: number, b: number, c: number, d: number) => { // lon/lat pairs, flat-earth is fine at this scale
  const k = Math.cos((b * Math.PI) / 180);
  return Math.hypot((c - a) * k * 111320, (d - b) * 110540);
};

/** The first `minM` metres of a real way, with its real heights re-encoded as deltas (the cell file format). */
function shortPath(flat: number[], z: number[] | undefined, minM: number) {
  let len = 0, i = 1;
  while (i < flat.length / 2 && len < minM) { len += metres(flat[2 * i - 2], flat[2 * i - 1], flat[2 * i], flat[2 * i + 1]); i++; }
  const g = flat.slice(0, 2 * i);
  let abs = 0;
  const zs = z?.slice(0, i).map((d) => (abs += d));
  return { g, z: zs?.map((v, k) => (k ? v - zs[k - 1] : v)) };
}

/**
 * A merged cell file with every Home row filled. The geometry and elevation are real. The real slices have no view or
 * waterfall tags and no trail under 3 miles round trip, so: (1) tags (`h`) are ADDED here to fill the rows (at least three trails
 * in each, the least a row needs), and (2) six short
 * named paths are cut from the first 1.1 km of real ways. Names and tags in the screenshots are therefore test data.
 */
export function richCell(): Slice {
  const all = Object.values(slices).flat();
  const r = all.flatMap((s) => s.r).map((x) => ({ ...x }));
  const tag = (id: number, h: string[]) => { const rel = r.find((x) => x.id === id); if (rel) rel.h = h; };
  tag(5588030, ['view', 'falls']);   // Rattlesnake Ledge
  tag(4794619, ['falls', 'lake']);   // Annette Lake
  tag(5519228, ['dogs']);            // Chirico
  const ways: Slice['w'] = [];
  const sources: [string, number, string[]][] = [['Mount Si', 0, ['view', 'dogs']], ['Granite Mountain', 1, ['view']], ['Annette Lake', 2, ['view', 'falls']], ['Little Si', 3, ['dogs', 'view']], ['Chirico', 4, ['view', 'falls']], ['Rattlesnake', 5, ['dogs', 'falls']]];
  const members = r.flatMap((x) => x.m);
  sources.forEach(([name, k, h], n) => {
    const long = members.filter((mm) => mm[1].length > 60);
    const m = long[k % long.length];
    const { g, z } = shortPath(m[1], m[2], 1100);
    ways.push({ id: 9000000 + n, t: { name: `${name} Spur Path`, highway: 'path' }, g, ...(z ? { z } : {}), h });
  });
  return { v: 1, r, w: ways };
}

/** Index with a block of cells around Seattle and Snoqualmie; every cell answers with the same merged file. */
export const RICH_INDEX: CellIndex = (() => {
  const keys: string[] = [];
  for (let x = 228; x <= 234; x++) for (let y = 547; y <= 552; y++) keys.push(`${x}_${y}`);
  return { v: 1, built: '2026-11-06T00:00:00Z', source: 'e2e fixture', elevation: 'Copernicus DEM GLO-90', cell: 0.25, bbox: [-123, 46.75, -121.25, 48], cells: keys };
})();
