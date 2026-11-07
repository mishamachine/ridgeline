// Back up / restore everything Ridgeline keeps on this phone, as one JSON file. No server involved.
import type { LngLat } from './geo';
import type { Junction, Trail } from './trails';
import { Activity, SavedTrail, Shortlisted, TrackPoint, TrailSnapshot, getSaved, getShortlisted, listActivities, listSaved, listShortlisted, putActivity, putSaved, restoreShortlisted } from './store';
import { Settings, getSettings, sanitize, updateSettings } from './settings';

export const BACKUP_APP = 'ridgeline';
export const BACKUP_VERSION = 1;

export interface Backup {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: number;
  settings: Settings;
  /** Route data only. Offline map tiles are not included; saved trails need "Save offline" again. */
  saved: SavedTrail[];
  activities: Activity[];
  /** Trails bookmarked on the Saved tab (route data only). Absent in older backups. */
  shortlist: Shortlisted[];
}

export function makeBackup(saved: SavedTrail[], activities: Activity[], settings: Settings, now = Date.now(), shortlist: Shortlisted[] = []): Backup {
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now, settings, saved, activities, shortlist };
}

export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
export const MAX_HIKES = 5000;
export const MAX_POINTS = 50_000;
export const MAX_SAVED = 2000;
const OSM_PREFIX = 'https://www.openstreetmap.org/';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string';
const optNum = (v: unknown) => v === undefined || num(v);
const optBool = (v: unknown) => v === undefined || typeof v === 'boolean';

// Each clean* function rebuilds the object from known fields only (extra keys are dropped) and returns null if anything is the wrong type.

function cleanPoint(p: unknown): TrackPoint | null {
  if (!isObj(p) || !num(p.lon) || !num(p.lat) || !num(p.acc) || !num(p.t) || !(p.alt === null || num(p.alt))) return null;
  return { lon: p.lon, lat: p.lat, alt: p.alt, acc: p.acc, t: p.t };
}

function cleanSnapshot(s: unknown): TrailSnapshot | null {
  if (!isObj(s) || !str(s.name) || !num(s.coverage) || !optNum(s.ascentM)) return null;
  if (s.highlights !== undefined && !(Array.isArray(s.highlights) && s.highlights.length <= 30 && s.highlights.every(str))) return null;
  const out: TrailSnapshot = { name: s.name, coverage: Math.min(1, Math.max(0, s.coverage)) };
  if (s.ascentM !== undefined) out.ascentM = s.ascentM as number;
  if (s.highlights !== undefined) out.highlights = [...(s.highlights as string[])];
  return out;
}

export function cleanActivity(a: unknown): Activity | null {
  if (!isObj(a) || !str(a.id) || a.id === '' || !str(a.name) || !num(a.startedAt) || !optNum(a.endedAt)) return null;
  if (!(a.trailId === undefined || str(a.trailId)) || !optBool(a.withDog) || !optBool(a.rain) || !optBool(a.unfinished)) return null;
  if (!Array.isArray(a.points) || a.points.length > MAX_POINTS) return null;
  const points: TrackPoint[] = [];
  for (const p of a.points) { const c = cleanPoint(p); if (!c) return null; points.push(c); }
  const out: Activity = { id: a.id, name: a.name, startedAt: a.startedAt, points };
  if (a.endedAt !== undefined) out.endedAt = a.endedAt as number;
  if (a.trailId !== undefined) out.trailId = a.trailId as string;
  if (a.withDog !== undefined) out.withDog = a.withDog as boolean;
  if (a.rain !== undefined) out.rain = a.rain as boolean;
  if (a.unfinished !== undefined) out.unfinished = a.unfinished as boolean;
  if (a.snapshot !== undefined) { const sn = cleanSnapshot(a.snapshot); if (!sn) return null; out.snapshot = sn; }
  return out;
}

const inRange = (v: unknown): v is LngLat => Array.isArray(v) && v.length >= 2 && num(v[0]) && num(v[1]) && Math.abs(v[0]) <= 180 && Math.abs(v[1]) <= 90;

/** undefined when absent, null when the wrong shape. */
function cleanLL(v: unknown): LngLat | undefined | null {
  if (v === undefined) return undefined;
  return inRange(v) ? [v[0], v[1]] : null;
}

function cleanHighlights(v: unknown): string[] | undefined | null {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 20 || !v.every((h) => str(h) && h.length <= 24)) return null;
  return [...(v as string[])];
}

function cleanJunctions(v: unknown): Junction[] | undefined | null {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 1000) return null;
  const out: Junction[] = [];
  for (const j of v) {
    if (!isObj(j) || !num(j.along) || !Array.isArray(j.branches) || j.branches.length > 20) return null;
    const branches: Junction['branches'] = [];
    for (const b of j.branches) {
      if (!isObj(b) || !inRange(b.point) || !(b.name === undefined || (str(b.name) && b.name.length <= 200))) return null;
      branches.push(b.name === undefined ? { point: [b.point[0], b.point[1]] } : { name: b.name, point: [b.point[0], b.point[1]] });
    }
    out.push({ along: j.along, branches });
  }
  return out;
}

function cleanTrail(t: unknown): Trail | null {
  if (!isObj(t) || !str(t.id) || t.id === '' || !str(t.name) || !num(t.lengthM) || typeof t.loop !== 'boolean' || typeof t.partial !== 'boolean') return null;
  if (!str(t.osmUrl) || !t.osmUrl.startsWith(OSM_PREFIX)) return null;
  if (!Array.isArray(t.coords) || t.coords.length > MAX_POINTS) return null;
  const coords: LngLat[] = [];
  for (const c of t.coords) { if (!Array.isArray(c) || c.length < 2 || !num(c[0]) || !num(c[1])) return null; coords.push([c[0], c[1]]); }
  if (!isObj(t.tags)) return null;
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(t.tags)) {
    if (!str(v)) return null;
    if (k !== '__proto__') tags[k] = v;
  }
  if (!optNum(t.ascentM) || !optNum(t.descentM)) return null;
  const hl = cleanHighlights(t.highlights);
  const head = cleanLL(t.trailhead);
  const junctions = cleanJunctions(t.junctions);
  if (hl === null || head === null || junctions === null || !optBool(t.trailheadIsParking)) return null;
  if (t.elevation !== undefined && !(Array.isArray(t.elevation) && t.elevation.length <= 1000 && t.elevation.every(num))) return null;
  const out: Trail = { id: t.id, name: t.name, coords, lengthM: t.lengthM, loop: t.loop, partial: t.partial, osmUrl: t.osmUrl, tags };
  if (t.elevation !== undefined) out.elevation = [...(t.elevation as number[])];
  if (t.ascentM !== undefined) out.ascentM = t.ascentM as number;
  if (t.descentM !== undefined) out.descentM = t.descentM as number;
  if (hl) out.highlights = hl;
  if (head) out.trailhead = head;
  if (t.trailheadIsParking !== undefined) out.trailheadIsParking = t.trailheadIsParking as boolean;
  if (junctions) out.junctions = junctions;
  return out;
}

function cleanSaved(s: unknown): SavedTrail | null {
  if (!isObj(s) || !num(s.savedAt)) return null;
  const trail = cleanTrail(s.trail);
  return trail ? { trail, savedAt: s.savedAt, tileKeys: [], bytes: 0 } : null;
}

function cleanShortlisted(s: unknown): Shortlisted | null {
  if (!isObj(s) || !num(s.addedAt)) return null;
  const trail = cleanTrail(s.trail);
  return trail ? { trail, addedAt: s.addedAt } : null;
}

export type ParseResult = { ok: true; backup: Backup } | { ok: false; error: string };

/** Checks a file's text before anything is written. */
export function parseBackup(text: string): ParseResult {
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, error: 'This file is too large to be a Ridgeline backup (over 20 MB).' };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: 'This file is not a Ridgeline backup (not valid JSON).' }; }
  if (!isObj(raw) || raw.app !== BACKUP_APP) return { ok: false, error: 'This file is not a Ridgeline backup.' };
  if (!num(raw.version) || raw.version > BACKUP_VERSION) return { ok: false, error: 'This backup is from a newer version of Ridgeline. Update the app and try again.' };
  if (!Array.isArray(raw.saved) || !Array.isArray(raw.activities)) return { ok: false, error: 'This backup is missing its hikes or saved trails.' };
  const rawList = raw.shortlist === undefined ? [] : raw.shortlist;
  if (!Array.isArray(rawList)) return { ok: false, error: 'This backup is missing its hikes or saved trails.' };
  if (raw.activities.length > MAX_HIKES || raw.saved.length > MAX_SAVED || rawList.length > MAX_SAVED) return { ok: false, error: `This backup is too big (more than ${MAX_HIKES.toLocaleString('en-US')} hikes or ${MAX_SAVED.toLocaleString('en-US')} saved trails).` };
  const saved = raw.saved.map(cleanSaved);
  const activities = raw.activities.map(cleanActivity);
  const shortlist = rawList.map(cleanShortlisted);
  if (saved.includes(null) || activities.includes(null) || shortlist.includes(null)) return { ok: false, error: 'This backup has damaged entries, so nothing was restored.' };
  return {
    ok: true,
    backup: { app: BACKUP_APP, version: raw.version, exportedAt: num(raw.exportedAt) ? raw.exportedAt : 0, settings: sanitize(raw.settings), saved: saved as SavedTrail[], activities: activities as Activity[], shortlist: shortlist as Shortlisted[] },
  };
}

export async function exportBackup(): Promise<Backup> {
  return makeBackup(await listSaved(), await listActivities(), getSettings(), Date.now(), await listShortlisted());
}

export function downloadBackup(b: Backup) {
  const blob = new Blob([JSON.stringify(b)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `ridgeline-backup-${new Date(b.exportedAt).toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Writes the backup. Hikes with the same id are replaced; everything else on the phone stays.
 * Saved trails and bookmarks come back as route data only (no map tiles); one already on this phone is kept as it is.
 */
export async function restoreBackup(b: Backup, progress: { done: number; total: number } = { done: 0, total: 0 }) {
  progress.total = b.saved.length + b.shortlist.length + b.activities.length + 1;
  for (const s of b.saved) { if (!(await getSaved(s.trail.id))) await putSaved({ ...s, tileKeys: [], bytes: 0 }); progress.done++; }
  for (const m of b.shortlist) { if (!(await getShortlisted(m.trail.id))) await restoreShortlisted(m); progress.done++; }
  for (const a of b.activities) { await putActivity(a); progress.done++; }
  updateSettings(b.settings);
  progress.done++;
}
