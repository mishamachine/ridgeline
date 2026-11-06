// Hosted trail data: small grid-cell files built from OpenStreetMap (scripts/build_trails.py).
import type { BBox } from './geo';
import { cumulative, M_TO_FT, M_TO_MI, haversine, type LngLat } from './geo';
import { HIGHLIGHT_CLIMB_FT, HIGHLIGHT_LONG_MI, parseOverpass, profileFromVertices, withElevation, type Junction, type Trail } from './trails';

export interface CellIndex { v: number; built: string; source: string; elevation?: string; cell: number; bbox: [number, number, number, number] | null; cells: string[] }
/** z: elevation (m) per vertex, delta-encoded: [z0, z1 - z0, z2 - z1, ...]. */
/**
 * Optional, from newer builds (old apps ignore them):
 * h: highlights; th: trailhead [lon, lat, 1 if a car park]; j: [[vertex index, [[lon, lat, name?], ...]], ...].
 */
type CellJunctions = [number, ([number, number] | [number, number, string])[]][];
interface CellRoute { id: number; t: Record<string, string>; n: number; m: [number, number[], number[]?, CellJunctions?][]; h?: string[]; th?: number[] }
interface CellWay { id: number; t: Record<string, string>; g: number[]; z?: number[]; h?: string[]; th?: number[]; j?: CellJunctions }
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

type Branches = Junction['branches'];
/** Vertex key -> branches, from one way's junction list. */
function addJunctions(into: Map<string, Branches>, flat: number[], j?: CellJunctions) {
  for (const [i, bs] of j ?? []) {
    if (2 * i + 1 >= flat.length) continue;
    const key = `${flat[2 * i]},${flat[2 * i + 1]}`;
    const list = into.get(key) ?? [];
    for (const b of bs) {
      const point: LngLat = [b[0], b[1]];
      if (!list.some((x) => x.point[0] === point[0] && x.point[1] === point[1])) list.push(b.length > 2 ? { name: b[2] as string, point } : { point });
    }
    into.set(key, list);
  }
}

const KIND_ORDER = ['view', 'lake', 'falls', 'beach', 'bikes', 'horses', 'dogs', 'nodogs', 'climb', 'long'];
const PARKING_SLACK_M = 400; // a car park from the data counts if it is this close to a trail end of the stitched line

/** Union of highlight lists; a kind with solid evidence in any list beats a '?' one. */
export function mergeHighlights(lists: (string[] | undefined)[], t: Pick<Trail, 'lengthM' | 'ascentM'>): string[] | undefined {
  const sure = new Map<string, boolean>();
  const add = (h: string, certain: boolean) => sure.set(h, (sure.get(h) ?? false) || certain);
  for (const l of lists) for (const h of l ?? []) add(h.replace(/\?$/, ''), !h.endsWith('?'));
  if (t.ascentM != null && t.ascentM * M_TO_FT >= HIGHLIGHT_CLIMB_FT) add('climb', true);
  if (t.lengthM * M_TO_MI >= HIGHLIGHT_LONG_MI) add('long', true);
  const out = KIND_ORDER.filter((k) => sure.has(k)).map((k) => (sure.get(k) ? k : `${k}?`));
  return out.length ? out : undefined;
}

function pickTrailhead(coords: LngLat[], candidates: (number[] | undefined)[]): { trailhead: LngLat; trailheadIsParking: boolean } {
  const ends = [coords[0], coords.at(-1)!];
  let best: { p: LngLat; d: number } | null = null;
  for (const c of candidates) {
    if (!c || c[2] !== 1) continue;
    const p: LngLat = [c[0], c[1]];
    const d = Math.min(haversine(p, ends[0]), haversine(p, ends[1]));
    if (d <= PARKING_SLACK_M && (!best || d < best.d)) best = { p, d };
  }
  return best ? { trailhead: best.p, trailheadIsParking: true } : { trailhead: coords[0], trailheadIsParking: false };
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
  const routeInfo = new Map<number, { h: (string[] | undefined)[]; th: (number[] | undefined)[]; j: Map<string, Branches> }>();
  const wayJ = new Map<number, Map<string, Branches>>();
  for (const f of files) {
    for (const r of f.r) {
      const e = routes.get(r.id) ?? { t: r.t, n: r.n, members: new Map() };
      const info = routeInfo.get(r.id) ?? { h: [] as (string[] | undefined)[], th: [] as (number[] | undefined)[], j: new Map<string, Branches>() };
      info.h.push(r.h); info.th.push(r.th);
      for (const [wid, g, z, j] of r.m) { e.members.set(wid, g); addElevations(zAt, g, z); addJunctions(info.j, g, j); }
      routes.set(r.id, e);
      routeInfo.set(r.id, info);
    }
    for (const w of f.w) {
      ways.set(w.id, w); addElevations(zAt, w.g, w.z);
      if (w.j) { const m = wayJ.get(w.id) ?? new Map(); addJunctions(m, w.g, w.j); wayJ.set(w.id, m); }
    }
  }
  // Named paths are stitched by name (see parseOverpass): which ways make up each path trail id.
  const memberIds = new Set([...routes.values()].flatMap((r) => [...r.members.keys()]));
  const byName = new Map<string, number[]>();
  for (const [id, w] of ways) if (!memberIds.has(id) && w.t.name) byName.set(w.t.name, [...(byName.get(w.t.name) ?? []), id]);
  const groupOf = new Map<number, number[]>();
  for (const ids of byName.values()) groupOf.set(Math.min(...ids), ids);
  const elements: unknown[] = [];
  for (const [id, r] of routes) {
    const members = [...r.members].map(([ref, g]) => ({ type: 'way', ref, role: '', geometry: pairs(g) }));
    if (members.length < r.n) members.push({ type: 'way', ref: -1, role: '', geometry: [] as { lon: number; lat: number }[] });
    elements.push({ type: 'relation', id, tags: r.t, members });
  }
  for (const [id, w] of ways) elements.push({ type: 'way', id, tags: w.t, geometry: pairs(w.g) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return parseOverpass(elements as any).map((t0) => {
    // Build the profile only if every vertex has a height (older files have none).
    const z = t0.coords.map((c) => zAt.get(`${c[0]},${c[1]}`));
    const profile = z.some((v) => v === undefined) ? [] : profileFromVertices(t0.coords, z as number[]);
    return withHighlightsAndJunctions(profile.length ? withElevation(t0, profile) : t0);
  });

  function withHighlightsAndJunctions(t: Trail): Trail {
    let hs: (string[] | undefined)[] = [];
    let ths: (number[] | undefined)[] = [];
    let maps: Map<string, Branches>[] = [];
    const r = /^osm-r(\d+)$/.exec(t.id), w = /^osm-w(\d+)-/.exec(t.id);
    if (r && routeInfo.has(+r[1])) {
      const info = routeInfo.get(+r[1])!;
      hs = info.h; ths = info.th; maps = [info.j];
    } else if (w && groupOf.has(+w[1])) {
      for (const id of groupOf.get(+w[1])!) {
        const way = ways.get(id)!;
        hs.push(way.h); ths.push(way.th);
        if (wayJ.has(id)) maps.push(wayJ.get(id)!);
      }
    } else return t;
    const hosted = hs.some((h) => h) || ths.some((th) => th) || maps.length > 0;
    const out: Trail = { ...t, ...(hosted ? pickTrailhead(t.coords, ths) : {}) };
    const highlights = mergeHighlights(hs, t);
    if (highlights) out.highlights = highlights;
    if (maps.length) {
      const cum = cumulative(t.coords);
      const junctions: Junction[] = [];
      for (let i = 1; i < t.coords.length - 1; i++) {
        const key = `${t.coords[i][0]},${t.coords[i][1]}`;
        const branches = maps.flatMap((m) => m.get(key) ?? []);
        if (branches.length) junctions.push({ along: cum[i], branches });
      }
      out.junctions = junctions;
    }
    return out;
  }
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
