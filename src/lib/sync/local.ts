// The phone side of sync: reads the IndexedDB records as SyncRecs and applies winning remote ones.
// Hikes still being recorded are never offered for upload.
import { cleanTrail } from '../backup';
import {
  Activity, SavedTrail, Shortlisted, clearTombstone, deleteActivityRaw, deleteSavedRaw, deleteShortlistedRaw, getActivity, getShortlisted,
  getSaved, listActivities, listSaved, listShortlisted, listTombstones, putActivityRaw, putShortlistedRaw,
} from '../store';
import { SETTINGS_EDIT_KEY, SETTINGS_STAMP_KEY, SYNCED_SETTING_KEYS, getSettings, updateSettings } from '../settings';
import type { Trail } from '../trails';
import type { Kind, SyncRec } from './merge';

export interface LocalSource {
  /** Forget this account's synced copies and all sync cursors on this phone (the server copy is untouched). */
  wipe(): Promise<void>;
  readAll(kind: Kind): Promise<SyncRec[]>;
  apply(rec: SyncRec): Promise<void>;
}

const rec = (kind: Kind, id: string, updatedAt: number, editedAt: number, payload: unknown): SyncRec => ({ kind, id, updatedAt, editedAt, deleted: false, payload });

export function readStamp(): number {
  try { return Number(localStorage.getItem(SETTINGS_STAMP_KEY)) || 0; } catch { return 0; }
}

export function readEdit(): number {
  try { return Number(localStorage.getItem(SETTINGS_EDIT_KEY)) || 0; } catch { return 0; }
}

/**
 * A hike that won from the server. The server holds a trimmed route (or none): a longer route kept on this phone is never replaced by it,
 * and a route that did come from the server is marked, so it is never trimmed or uploaded again.
 */
export function mergeRemoteActivity(local: Activity | undefined, remote: Activity, updatedAt: number): Activity {
  const keepLocal = !!local && local.points.length >= remote.points.length;
  const points = keepLocal ? local!.points : remote.points;
  const trackOrigin: Activity['trackOrigin'] = keepLocal ? local!.trackOrigin : remote.points.length ? 'server' : undefined;
  const out: Activity = { ...remote, points, updatedAt };
  if (trackOrigin) out.trackOrigin = trackOrigin; else delete out.trackOrigin;
  return out;
}

export const idbLocal: LocalSource = {
  wipe: () => wipeLocalAccountData(),
  async readAll(kind) {
    const tombs = kind === 'settings' ? [] : (await listTombstones()).filter((t) => t.kind === kind)
      .map((t): SyncRec => ({ kind, id: t.id, updatedAt: t.deletedAt, editedAt: t.editedAt ?? t.deletedAt, deleted: true, payload: null }));
    if (kind === 'shortlist') return [...(await listShortlisted()).map((s) => rec(kind, s.trail.id, s.updatedAt ?? s.addedAt, s.editedAt ?? s.updatedAt ?? s.addedAt, { trail: s.trail, addedAt: s.addedAt })), ...tombs];
    if (kind === 'saved') return [...(await listSaved()).map((s) => rec(kind, s.trail.id, s.updatedAt ?? s.savedAt, s.editedAt ?? s.updatedAt ?? s.savedAt, { trail: s.trail, addedAt: s.savedAt })), ...tombs];
    if (kind === 'activities') {
      const done = (await listActivities()).filter((a) => a.endedAt !== undefined || a.unfinished);
      return [...done.map((a) => rec(kind, a.id, a.updatedAt ?? a.endedAt ?? a.startedAt, a.editedAt ?? a.updatedAt ?? a.endedAt ?? a.startedAt, a)), ...tombs];
    }
    const s = getSettings();
    return [rec(kind, 'settings', readStamp(), readEdit(), Object.fromEntries(SYNCED_SETTING_KEYS.map((k) => [k, s[k]])))];
  },

  async apply(r) {
    if (r.kind === 'settings') {
      if (r.payload && typeof r.payload === 'object') updateSettings(r.payload as Record<string, never>, false);
      try { localStorage.setItem(SETTINGS_STAMP_KEY, String(r.updatedAt)); } catch { /* ignore */ }
      return;
    }
    const kind = r.kind;
    if (r.deleted) {
      if (kind === 'shortlist') await deleteShortlistedRaw(r.id);
      else if (kind === 'saved') await deleteSavedRaw(r.id);
      else await deleteActivityRaw(r.id);
      return;
    }
    await clearTombstone(kind, r.id);
    const p = r.payload as { trail?: unknown; addedAt?: number } | Activity | null;
    if (kind === 'activities') {
      const a = p as Activity | null;
      if (!a) return;
      await putActivityRaw(mergeRemoteActivity(await getActivity(r.id), a, r.updatedAt));
      return;
    }
    const trail = cleanTrail((p as { trail?: unknown } | null)?.trail) as Trail | null;
    if (!trail) return;
    const addedAt = typeof (p as { addedAt?: number }).addedAt === 'number' ? (p as { addedAt: number }).addedAt : r.updatedAt;
    if (kind === 'shortlist') await putShortlistedRaw({ trail, addedAt, updatedAt: r.updatedAt } satisfies Shortlisted);
    else {
      // "Saved offline" is a list of trails here. The map tiles stay on the other phone, so this phone gets a bookmark
      // (it shows "Download for offline") unless it already has the real thing.
      const have: SavedTrail | undefined = await getSaved(trail.id);
      if (!have && !(await getShortlisted(trail.id))) await putShortlistedRaw({ trail, addedAt, updatedAt: r.updatedAt });
    }
  },
};

/** "Remove from this phone" at sign-out: forget the synced records here (offline maps included). The server copy is untouched. */
export async function wipeLocalAccountData(): Promise<void> {
  const { removeTrailOffline } = await import('../offline');
  const { clearTombstones, deleteActivityRaw: delA, deleteShortlistedRaw: delS, listActivities: la, listSaved: ls, listShortlisted: lsh } = await import('../store');
  for (const s of await ls()) await removeTrailOffline(s.trail.id);
  for (const s of await lsh()) await delS(s.trail.id);
  for (const a of await la()) await delA(a.id);
  await clearTombstones();
  const { keys, del } = await import('idb-keyval');
  for (const k of (await keys()).filter((k) => String(k).startsWith('sync:'))) await del(k); // so signing in again pulls everything
  try { localStorage.removeItem(SETTINGS_STAMP_KEY); localStorage.removeItem(SETTINGS_EDIT_KEY); } catch { /* ignore */ }
}
