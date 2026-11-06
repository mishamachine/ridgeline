// Back up / restore everything Ridgeline keeps on this phone, as one JSON file. No server involved.
import { Activity, SavedTrail, getSaved, listActivities, listSaved, putActivity, putSaved } from './store';
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
}

export function makeBackup(saved: SavedTrail[], activities: Activity[], settings: Settings, now = Date.now()): Backup {
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now, settings, saved, activities };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

function validPoint(p: unknown) {
  return isObj(p) && num(p.lon) && num(p.lat) && num(p.acc) && num(p.t) && (p.alt === null || num(p.alt));
}

export function validActivity(a: unknown): a is Activity {
  return isObj(a) && typeof a.id === 'string' && a.id !== '' && typeof a.name === 'string' && num(a.startedAt)
    && (a.endedAt === undefined || num(a.endedAt)) && (a.trailId === undefined || typeof a.trailId === 'string')
    && Array.isArray(a.points) && a.points.every(validPoint);
}

export function validSaved(s: unknown): s is SavedTrail {
  if (!isObj(s) || !isObj(s.trail) || !num(s.savedAt)) return false;
  const t = s.trail;
  return typeof t.id === 'string' && t.id !== '' && typeof t.name === 'string' && num(t.lengthM)
    && Array.isArray(t.coords) && t.coords.every((c) => Array.isArray(c) && c.length >= 2 && num(c[0]) && num(c[1]));
}

export type ParseResult = { ok: true; backup: Backup } | { ok: false; error: string };

/** Checks a file's text before anything is written. */
export function parseBackup(text: string): ParseResult {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: 'This file is not a Ridgeline backup (not valid JSON).' }; }
  if (!isObj(raw) || raw.app !== BACKUP_APP) return { ok: false, error: 'This file is not a Ridgeline backup.' };
  if (!num(raw.version) || (raw.version as number) > BACKUP_VERSION) return { ok: false, error: 'This backup is from a newer version of Ridgeline. Update the app and try again.' };
  if (!Array.isArray(raw.saved) || !Array.isArray(raw.activities)) return { ok: false, error: 'This backup is missing its hikes or saved trails.' };
  if (!raw.saved.every(validSaved) || !raw.activities.every(validActivity)) return { ok: false, error: 'This backup has damaged entries, so nothing was restored.' };
  return {
    ok: true,
    backup: {
      app: BACKUP_APP,
      version: raw.version as number,
      exportedAt: num(raw.exportedAt) ? (raw.exportedAt as number) : 0,
      settings: sanitize(raw.settings),
      saved: raw.saved as SavedTrail[],
      activities: raw.activities as Activity[],
    },
  };
}

export async function exportBackup(): Promise<Backup> {
  return makeBackup(await listSaved(), await listActivities(), getSettings());
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
 * Saved trails come back as route data only (no map tiles); a trail already saved here keeps its offline maps.
 */
export async function restoreBackup(b: Backup) {
  for (const s of b.saved) if (!(await getSaved(s.trail.id))) await putSaved({ ...s, tileKeys: [], bytes: 0 });
  for (const a of b.activities) await putActivity(a);
  updateSettings(b.settings);
}
