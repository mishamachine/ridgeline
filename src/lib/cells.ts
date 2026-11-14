// Hosted trail data: small grid-cell files built from OpenStreetMap (scripts/build_trails.py).
import type { BBox } from './geo';
import { trailBase } from './native/trailBase';
import type { CoverageRegion } from './coverage';
import { cumulative, M_TO_FT, M_TO_MI, haversine, type LngLat } from './geo';
import { HIGHLIGHT_CLIMB_FT, HIGHLIGHT_LONG_MI, parseOverpass, profileFromVertices, withElevation, type Junction, type Trail } from './trails';

export interface CellIndex { v: number; built: string; source: string; elevation?: string; cell: number; bbox: [number, number, number, number] | null; cells: string[]; /** Covered regions, from builds that list them. */ regions?: CoverageRegion[]; /** Where this index was read from (set by the app): trails/v2/ or, for older deploys, trails/. */ base?: string }
/** z: elevation (m) per vertex, delta-encoded: [z0, z1 - z0, z2 - z1, ...]. */
/**
 * Optional, from newer builds (old apps ignore them):
 * h: highlights; th: trailhead [lon, lat, 1 if a car park]; j: [[vertex index, [[lon, lat, name?], ...]], ...].
 */
type CellBranch = [number, number] | [number, number, string] | [number, number, string, number[]]; // [lon, lat, name?, routes?]
type CellJunctions = [number, CellBranch[]][];
interface CellRoute { id: number; t: Record<string, string>; n: number; m: [number, number[], number[]?, CellJunctions?][]; h?: string[]; th?: number[] }
interface CellWay { id: number; t: Record<string, string>; g: number[]; z?: number[]; h?: string[]; th?: number[]; j?: CellJunctions }
/** s (v2, from scripts/trail-stats.mjs): each trail's [length m, ascent m, descent m] measured on the full-resolution line. Key: "r<relation id>", or "w<lon,lat>|<lon,lat>" (its two ends, sorted) for a named path. */
export interface CellFile { v: number; r: CellRoute[]; w: CellWay[]; s?: Record<string, number[]> }

// Format v2 (scripts/cell_format.py): coordinates are integers at 1e-5 degrees, delta-encoded (first point absolute);
// z is per kept vertex; `th` and junction branch points are offsets in the same units. decodeCell turns it back into v1.
const SCALE = 1e5;
const decodeG = (g: number[]): number[] => {
  const out: number[] = [];
  let x = 0, y = 0;
  for (let i = 0; i < g.length; i += 2) { x += g[i]; y += g[i + 1]; out.push(x / SCALE, y / SCALE); }
  return out;
};
const decodeJ = (j: unknown, flat: number[]): CellJunctions | undefined => {
  if (!j) return undefined;
  return (j as [number, (number | string | number[])[][]][]).map(([vi, bs]) => {
    const vx = Math.round(flat[2 * vi] * SCALE), vy = Math.round(flat[2 * vi + 1] * SCALE);
    return [vi, bs.map((b) => [(vx + (b[0] as number)) / SCALE, (vy + (b[1] as number)) / SCALE, ...b.slice(2)] as CellBranch)];
  });
};
const decodeTh = (th: number[] | undefined, first: number[]): number[] | undefined =>
  th && [(Math.round(first[0] * SCALE) + th[0]) / SCALE, (Math.round(first[1] * SCALE) + th[1]) / SCALE, th[2]];

export function decodeCell(f: CellFile): CellFile {
  if (f.v !== 2) return f;
  return {
    v: 1,
    s: f.s,
    r: f.r.map((r) => {
      const m = r.m.map(([wid, g, z, j]) => {
        const flat = decodeG(g);
        const dj = decodeJ(j, flat);
        return (dj ? [wid, flat, z, dj] : [wid, flat, z]) as CellRoute['m'][number];
      });
      return { ...r, m, th: decodeTh(r.th, m[0][1]) };
    }),
    w: f.w.map((w) => {
      const g = decodeG(w.g);
      return { ...w, g, th: decodeTh(w.th, g), j: decodeJ(w.j, g) };
    }),
  };
}


let indexPromise: Promise<CellIndex | null> | null = null;

/** Data versions, newest first: v2 lives at trails/v2/, the frozen old format (Washington only) at trails/. */
const DATA_PATHS = ['v2/', ''];

async function loadIndex(): Promise<CellIndex | null> {
  for (const sub of DATA_PATHS) {
    try {
      const r = await fetch(`${trailBase()}${sub}index.json`);
      if (!r.ok) continue;
      const idx = (await r.json()) as CellIndex;
      if (Array.isArray(idx?.cells)) return { ...idx, base: `${trailBase()}${sub}` };
    } catch { /* offline, or not JSON: try the next path */ }
  }
  return null;
}

/** Coverage index, read from trails/v2/ first and from trails/ when that is missing. Null when no hosted data is deployed (e.g. local dev). */
export function getIndex(): Promise<CellIndex | null> {
  indexPromise ??= loadIndex().then((idx) => { if (!idx) indexPromise = null; return idx; }); // retry next time if it failed
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

type Branches = (Junction['branches'][number] & { routes?: number[] })[];
/** Vertex key -> branches, from one way's junction list. */
function addJunctions(into: Map<string, Branches>, flat: number[], j?: CellJunctions) {
  for (const [i, bs] of j ?? []) {
    if (2 * i + 1 >= flat.length) continue;
    const key = `${flat[2 * i]},${flat[2 * i + 1]}`;
    const list = into.get(key) ?? [];
    for (const b of bs) {
      const point: LngLat = [b[0], b[1]];
      if (list.some((x) => x.point[0] === point[0] && x.point[1] === point[1])) continue;
      const name = b[2] || undefined;
      list.push({ ...(name ? { name } : {}), point, ...(b.length > 3 ? { routes: b[3] } : {}) });
    }
    into.set(key, list);
  }
}

const KIND_ORDER = ['view', 'lake', 'falls', 'beach', 'bikes', 'horses', 'dogs', 'nodogs', 'climb', 'long'];
const PARKING_SLACK_M = 400; // a car park from the data counts if it is this close to a trail end of the stitched line

/** Union of highlight lists; a kind with solid evidence in any list beats a '?' one. */
export function mergeHighlights(lists: (string[] | undefined)[], t: Pick<Trail, 'lengthM' | 'ascentM'> & Partial<Pick<Trail, 'descentM' | 'loop'>>): string[] | undefined {
  const sure = new Map<string, boolean>();
  const add = (h: string, certain: boolean) => sure.set(h, (sure.get(h) ?? false) || certain);
  for (const l of lists) for (const h of l ?? []) add(h.replace(/\?$/, ''), !h.endsWith('?'));
  // The way up: the whole ascent for a loop, else the bigger of the two ways (the mapped line can run either direction).
  const up = t.ascentM == null ? null : t.loop ? t.ascentM : Math.max(t.ascentM, t.descentM ?? 0);
  if (up != null && up * M_TO_FT >= HIGHLIGHT_CLIMB_FT) add('climb', true);
  if (t.lengthM * M_TO_MI >= HIGHLIGHT_LONG_MI) add('long', true);
  const out = KIND_ORDER.filter((k) => sure.has(k)).map((k) => (sure.get(k) ? k : `${k}?`));
  return out.length ? out : undefined;
}

/** The same trail walked the other way: coordinates and profile reversed, ascent and descent swapped. */
function reversed(t: Trail): Trail {
  return { ...t, coords: [...t.coords].reverse(), elevation: t.elevation && [...t.elevation].reverse(), ascentM: t.descentM, descentM: t.ascentM };
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
export function cellsToTrails(raw: CellFile[]): Trail[] {
  const files = raw.map(decodeCell);
  const stored = new Map<string, number[]>();
  for (const f of files) for (const [k, v] of Object.entries(f.s ?? {})) stored.set(k, v);
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
  return parseOverpass(elements as any, stored).map((t0) => {
    // Build the profile only if every vertex has a height (older files have none).
    const z = t0.coords.map((c) => zAt.get(`${c[0]},${c[1]}`));
    const profile = z.some((v) => v === undefined) ? [] : profileFromVertices(t0.coords, z as number[]);
    return withStored(withHighlightsAndJunctions(profile.length ? withElevation(t0, profile) : t0));
  });

  /**
   * The drawn line of a v2 trail is simplified (5 m), so its measured length and climb differ a little. For a complete trail
   * (every member loaded) use the numbers measured at build time on the full line, when the file has them: always for a route, and for
   * a named path when they agree with the drawn line (within 8% of its length: a different stitching, e.g. from other loaded ways, is ignored).
   */
  function withStored(t: Trail): Trail {
    if (t.partial || !stored.size || t.ascentM == null) return t;
    const r = /^osm-r(\d+)$/.exec(t.id);
    const ends = [t.coords[0], t.coords.at(-1)!].map((c) => `${c[0].toFixed(5)},${c[1].toFixed(5)}`).sort();
    const s = stored.get(r ? `r${r[1]}` : `w${ends.join('|')}`);
    // A route (relation) is identified by its id, so complete means its numbers are the right ones whatever line was drawn (a branching
    // relation can stitch to a different chain on the simplified geometry). A named path is matched by its two ends, so keep the length guard there.
    if (!s) return t;
    if (!r && Math.abs(t.lengthM / s[0] - 1) > 0.08) {
      // Not used: the drawn numbers stay. Flag the trail when they are over 10% from the stored ones (length, or headline gain with 30 m or more).
      const shown = t.loop ? t.ascentM : Math.max(t.ascentM, t.descentM ?? 0), full = t.loop ? s[1] : Math.max(s[1], s[2]);
      const off = Math.abs(t.lengthM / s[0] - 1) > 0.1 || (full >= 30 && Math.abs(shown / full - 1) > 0.1);
      return off ? { ...t, statsMismatch: true } : t;
    }
    return { ...t, lengthM: s[0], ascentM: s[1], descentM: s[2] };
  }

  function withHighlightsAndJunctions(t: Trail): Trail {
    let hs: (string[] | undefined)[] = [];
    let ths: (number[] | undefined)[] = [];
    let maps: Map<string, Branches>[] = [];
    const r = /^osm-r(\d+)$/.exec(t.id), w = /^osm-w(\d+)-/.exec(t.id);
    if (r && routeInfo.has(+r[1])) {
      const info = routeInfo.get(+r[1])!;
      hs = info.h; ths = info.th; maps = [info.j];
    } else if (w && groupOf.has(+w[1])) {
      // Same-named trails far apart share an id prefix: use only the ways that lie on this trail.
      const onTrail = new Set(t.coords.map((c) => `${c[0]},${c[1]}`));
      for (const id of groupOf.get(+w[1])!) {
        const way = ways.get(id)!;
        if (!pairs(way.g).some((c) => onTrail.has(`${c.lon},${c.lat}`))) continue;
        hs.push(way.h); ths.push(way.th);
        if (wayJ.has(id)) maps.push(wayJ.get(id)!);
      }
    } else return t;
    const hosted = hs.some((h) => h) || ths.some((th) => th) || maps.length > 0;
    const picked = hosted ? pickTrailhead(t.coords, ths) : null;
    // The mapped line can run either way. Make an out-and-back start at its car park, so ascent is the climb on the way out
    // (a line that ran downhill from the top would otherwise report almost no ascent).
    if (picked?.trailheadIsParking && !t.loop && haversine(picked.trailhead, t.coords.at(-1)!) < haversine(picked.trailhead, t.coords[0])) t = reversed(t);
    const out: Trail = { ...t, ...(picked ?? {}) };
    const highlights = mergeHighlights(hs, t);
    if (highlights) out.highlights = highlights;
    if (maps.length) {
      const cum = cumulative(t.coords);
      const junctions: Junction[] = [];
      for (let i = 1; i < t.coords.length - 1; i++) {
        const key = `${t.coords[i][0]},${t.coords[i][1]}`;
        // Drop branches that are this trail itself (its own route, or a way with its name).
        const branches = maps.flatMap((m) => m.get(key) ?? [])
          .filter((b) => !(r && b.routes?.includes(+r[1])) && b.name !== t.name)
          .map(({ name, point }) => (name ? { name, point } : { point }));
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
    const res = await fetch(`${index.base ?? trailBase()}${c}.json`, { signal });
    if (!res.ok) throw new Error(`Couldn't load trails (${res.status}).`);
    return (await res.json()) as CellFile;
  }));
  return cellsToTrails(files);
}
