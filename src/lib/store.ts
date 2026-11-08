// Local persistence (IndexedDB). Nothing leaves the device unless the person signs in (src/lib/sync).
import { get, set, del, keys, getMany } from 'idb-keyval';
import type { Trail } from './trails';
import { features } from './features';

export interface SavedTrail {
  trail: Trail;
  savedAt: number;
  tileKeys: string[];
  bytes: number;
  /** Last change, ms. Used by sync (last write wins); absent on records made before sync existed. */
  updatedAt?: number;
  /** Local edit stamp: rises on every change made ON THIS PHONE and is 0 on records that came from the server. Decides what still needs uploading. */
  editedAt?: number;
}

export interface TrackPoint { lon: number; lat: number; alt: number | null; acc: number; t: number }

/** What badges need to know about the trail, kept on the hike so they survive "Clear offline maps". */
export interface TrailSnapshot {
  name: string;
  ascentM?: number;
  highlights?: string[];
  /** Share (0..1) of the trail the recorded track covered. */
  coverage: number;
}

export interface Activity {
  id: string;
  name: string;
  trailId?: string;
  startedAt: number;
  endedAt?: number;
  points: TrackPoint[];
  /** Set by the hiker after the hike (badges: Trail Buddy, Rain or Shine). */
  withDog?: boolean;
  rain?: boolean;
  /** Written when the hike finishes (see snapshotForActivity in badges.ts). */
  snapshot?: TrailSnapshot;
  /** The hike was never finished; it was closed at its last point. See abandoned.ts. */
  unfinished?: boolean;
  /** Time spent paused (or with the app closed, on a resumed hike) so far, ms. Kept so a hike resumed twice still counts the first session's pauses. */
  pausedMs?: number;
  /** Last change, ms. Used by sync (last write wins). */
  updatedAt?: number;
  /** Totals kept with a hike whose route lives on another phone ("Keep hike tracks on this phone only"). Only read when there are no points. */
  summary?: { distanceM: number; durationMs: number; climbM: number };
  /** 'server' when `points` is the (already trimmed) route taken from the server. Such a route is never trimmed again or uploaded again. */
  trackOrigin?: 'server';
  /** Local edit stamp (see SavedTrail). */
  editedAt?: number;
}

const T = 'trail:', A = 'act:', S = 'sl:';

/** Deletions leave a tombstone so they can sync. Re-adding the same id removes it. Kind is 'saved' | 'activities' | 'shortlist'. */
export type TombKind = 'saved' | 'activities' | 'shortlist';
export interface Tombstone { kind: TombKind; id: string; deletedAt: number; editedAt?: number }
const tombKey = (kind: TombKind, id: string) => `tomb:${kind}:${id}`;
/**
 * The local edit stamp: strictly rising, saved so it keeps rising across restarts and a clock that jumps back.
 * Only edits made on this phone take one; sync decides what to upload from these, never from server times (so a skewed clock cannot hide an edit).
 */
const EDIT_SEQ = 'sync:editseq';
let editChain: Promise<number> = Promise.resolve(0);
export const nextEditStamp = (): Promise<number> => (editChain = editChain.catch(() => 0).then(async () => {
  const n = Math.max(Date.now(), ((await get<number>(EDIT_SEQ)) ?? 0) + 1);
  await set(EDIT_SEQ, n);
  return n;
}));
const tombstone = async (kind: TombKind, id: string) => features.accounts && set(tombKey(kind, id), { kind, id, deletedAt: Date.now(), editedAt: await nextEditStamp() } satisfies Tombstone);
const untomb = (kind: TombKind, id: string) => del(tombKey(kind, id));
export async function listTombstones(): Promise<Tombstone[]> {
  const ks = (await keys()).filter((k) => String(k).startsWith('tomb:'));
  return (await getMany<Tombstone | undefined>(ks)).filter((x): x is Tombstone => !!x);
}
/** Drop tombstones older than this: a phone that was offline for longer than that re-syncs from the server's copy anyway. */
export const TOMBSTONE_MAX_AGE_MS = 90 * 24 * 3600 * 1000;
export async function pruneTombstones(now = Date.now(), maxAge = TOMBSTONE_MAX_AGE_MS): Promise<void> {
  for (const t of await listTombstones()) if (now - t.deletedAt > maxAge) await del(tombKey(t.kind, t.id));
}
export const clearTombstone = (kind: TombKind, id: string) => untomb(kind, id);
export const clearTombstones = async () => { for (const k of (await keys()).filter((k) => String(k).startsWith('tomb:'))) await del(k); };

export const getSaved = (id: string) => get<SavedTrail>(T + id);
export const putSaved = async (s: SavedTrail) => { await set(T + s.trail.id, { ...s, updatedAt: Date.now(), editedAt: await nextEditStamp() }); await untomb('saved', s.trail.id); };
export const deleteSaved = async (id: string) => { await del(T + id); await tombstone('saved', id); };
/** For sync only: store exactly what came from the server (no new timestamp, no tombstone). */
/** Restore from a backup: keeps the record's own updatedAt (so an old backup never beats newer synced data), but counts as an edit made here so it uploads. */
export const restoreSaved = async (s: SavedTrail) => { await set(T + s.trail.id, { ...s, updatedAt: s.updatedAt ?? s.savedAt, editedAt: await nextEditStamp() }); await untomb('saved', s.trail.id); };
export const restoreActivity = async (a: Activity) => { await set(A + a.id, { ...a, updatedAt: a.updatedAt ?? a.endedAt ?? a.startedAt, editedAt: await nextEditStamp() }); await untomb('activities', a.id); };
export const putSavedRaw = (s: SavedTrail) => set(T + s.trail.id, { ...s, editedAt: 0 });
export const deleteSavedRaw = (id: string) => del(T + id);

export async function listSaved(): Promise<SavedTrail[]> {
  const ks = (await keys()).filter((k) => String(k).startsWith(T));
  const all = (await getMany<SavedTrail | undefined>(ks)).filter((x): x is SavedTrail => !!x);
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

export const putActivity = async (a: Activity) => { await set(A + a.id, { ...a, updatedAt: Date.now(), editedAt: await nextEditStamp() }); await untomb('activities', a.id); };
export const patchActivity = async (id: string, patch: Partial<Pick<Activity, 'withDog' | 'rain'>>) => {
  const a = await get<Activity>(A + id);
  if (a) await set(A + id, { ...a, ...patch, updatedAt: Date.now(), editedAt: await nextEditStamp() });
};
export const deleteActivity = async (id: string) => { await del(A + id); await tombstone('activities', id); };
export const getActivity = (id: string) => get<Activity>(A + id);
export const putActivityRaw = (a: Activity) => set(A + a.id, { ...a, editedAt: 0 });
export const deleteActivityRaw = (id: string) => del(A + id);

export async function listActivities(): Promise<Activity[]> {
  const ks = (await keys()).filter((k) => String(k).startsWith(A));
  const all = (await getMany<Activity | undefined>(ks)).filter((x): x is Activity => !!x);
  return all.sort((a, b) => b.startedAt - a.startedAt);
}

export const getSetting = <V>(k: string) => get<V>('set:' + k);
export const putSetting = (k: string, v: unknown) => set('set:' + k, v);

// Shortlist: trails the user bookmarked. A trail saved for offline use is also kept here.
export interface Shortlisted { trail: Trail; addedAt: number; updatedAt?: number; editedAt?: number }
export const getShortlisted = (id: string) => get<Shortlisted>(S + id);
export const putShortlisted = async (trail: Trail) => { const now = Date.now(); await set(S + trail.id, { trail, addedAt: now, updatedAt: now, editedAt: await nextEditStamp() } satisfies Shortlisted); await untomb('shortlist', trail.id); };
/** Used by restore, to keep the original date. */
export const restoreShortlisted = async (s: Shortlisted) => { await set(S + s.trail.id, { ...s, updatedAt: s.updatedAt ?? s.addedAt, editedAt: await nextEditStamp() }); await untomb('shortlist', s.trail.id); };
export const deleteShortlisted = async (id: string) => { await del(S + id); await tombstone('shortlist', id); };
export const putShortlistedRaw = (s: Shortlisted) => set(S + s.trail.id, { ...s, editedAt: 0 });
export const deleteShortlistedRaw = (id: string) => del(S + id);

export async function listShortlisted(): Promise<Shortlisted[]> {
  const ks = (await keys()).filter((k) => String(k).startsWith(S));
  const all = (await getMany<Shortlisted | undefined>(ks)).filter((x): x is Shortlisted => !!x);
  return all.sort((a, b) => b.addedAt - a.addedAt);
}
