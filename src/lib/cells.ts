// Hosted trail data: small grid-cell files built from OpenStreetMap (scripts/build_trails.py).
import type { BBox } from './geo';
import { parseOverpass, profileFromVertices, withElevation, type Trail } from './trails';

export interface CellIndex { v: number; built: string; source: string; elevation?: string; cell: number; bbox: [number, number, number, number] | null; cells: string[] }
/** z: elevation (m) per vertex, delta-encoded: [z0, z1 - z0, z2 - z1, ...]. */
interface CellRoute { id: number; t: Record<string, string>; n: number; m: [number, number[], number[]?][] }
interface CellWay { id: number; t: Record<string, string>; g: number[]; z?: number[] }
export interface CellFile { v: number; r: CellRoute[]; w: CellWay[] }

const base = () => `${import.meta.env.BASE_URL ?? '/'}trails/`;

let indexPromise: Promise<CellIndex | null> | null = null;

/** Coverage index. Null when no hosted data is deployed (e.g. local dev). */
export function getIndex(): Promise<CellIndex | null> {
  indexPromise ??= fetch(`${base()}index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<CellIndex>) : null))
    .catch(() => null)
    .then((idx) => { if (!idx) indexPromise = null; return idx; }); // retry next time if it failed
  return indexPromise;
}

export function cellsFor(b: BBox, size: number): string[] {
  const x0 = Math.floor((b.west + 180) / size), x1 = Math.floor((b.east + 180) / size);
  const y0 = Math.floor((b.south + 90) / size), y1 = Math.floor((b.north + 90) / size);
  const out: string[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(`${x}_${y}`);
  return out;
}

export function covers(index: CellIndex, b: BBox): boolean {
  if (!index.bbox) return false;
  const [w, s, e, n] = index.bbox;
  return b.east > w && b.west < e && b.north > s && b.south < n;
}

const pairs = (flat: number[]) => {
  const out: { lon: number; lat: number }[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ lon: flat[i], lat: flat[i + 1] });
  return out;
};

/** Vertex key -> elevation (m), from the delta-encoded `z` arrays. Vertices shared by ways have one value. */
function addElevations(into: Map<string, number>, flat: number[], z?: number[]) {
  if (!z || z.length * 2 !== flat.length) return;
  let acc = 0;
  for (let i = 0; i < z.length; i++) {
    acc += z[i];
    into.set(`${flat[2 * i]},${flat[2 * i + 1]}`, acc);
  }
}

/**
 * Merge cell files into Overpass-style elements, then reuse the same parser.
 * A route that crosses cells is stitched back together from the members each cell holds;
 * if some members are in cells not loaded, it is marked as a partial section.
 */
export function cellsToTrails(files: CellFile[]): Trail[] {
  const routes = new Map<number, { t: Record<string, string>; n: number; members: Map<number, number[]> }>();
  const ways = new Map<number, CellWay>();
  const zAt = new Map<string, number>();
  for (const f of files) {
    for (const r of f.r) {
      const e = routes.get(r.id) ?? { t: r.t, n: r.n, members: new Map() };
      for (const [wid, g, z] of r.m) { e.members.set(wid, g); addElevations(zAt, g, z); }
      routes.set(r.id, e);
    }
    for (const w of f.w) { ways.set(w.id, w); addElevations(zAt, w.g, w.z); }
  }
  const elements: unknown[] = [];
  for (const [id, r] of routes) {
    const members = [...r.members].map(([ref, g]) => ({ type: 'way', ref, role: '', geometry: pairs(g) }));
    if (members.length < r.n) members.push({ type: 'way', ref: -1, role: '', geometry: [] as { lon: number; lat: number }[] });
    elements.push({ type: 'relation', id, tags: r.t, members });
  }
  for (const [id, w] of ways) elements.push({ type: 'way', id, tags: w.t, geometry: pairs(w.g) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return parseOverpass(elements as any).map((t) => {
    // Build the profile only if every vertex has a height (older files have none).
    const z = t.coords.map((c) => zAt.get(`${c[0]},${c[1]}`));
    if (z.some((v) => v === undefined)) return t;
    const profile = profileFromVertices(t.coords, z as number[]);
    return profile.length ? withElevation(t, profile) : t;
  });
}

/** Trails for an area from hosted cells. Returns null if the area isn't covered. */
export async function fetchCellTrails(b: BBox, signal?: AbortSignal): Promise<Trail[] | null> {
  const index = await getIndex();
  if (!index || !covers(index, b)) return null;
  const available = new Set(index.cells);
  const wanted = cellsFor(b, index.cell).filter((c) => available.has(c));
  const files = await Promise.all(wanted.map(async (c) => {
    const res = await fetch(`${base()}${c}.json`, { signal });
    if (!res.ok) throw new Error(`Couldn't load trails (${res.status}).`);
    return (await res.json()) as CellFile;
  }));
  return cellsToTrails(files);
}
