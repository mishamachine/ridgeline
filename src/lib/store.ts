// Local persistence (IndexedDB). Nothing leaves the device.
import { get, set, del, keys, getMany } from 'idb-keyval';
import type { Trail } from './trails';

export interface SavedTrail {
  trail: Trail;
  savedAt: number;
  tileKeys: string[];
  bytes: number;
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
}

const T = 'trail:', A = 'act:', S = 'sl:';

export const getSaved = (id: string) => get<SavedTrail>(T + id);
export const putSaved = (s: SavedTrail) => set(T + s.trail.id, s);
export const deleteSaved = (id: string) => del(T + id);

export async function listSaved(): Promise<SavedTrail[]> {
  const ks = (await keys()).filter((k) => String(k).startsWith(T));
  const all = (await getMany<SavedTrail | undefined>(ks)).filter((x): x is SavedTrail => !!x);
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

export const putActivity = (a: Activity) => set(A + a.id, a);
export const patchActivity = async (id: string, patch: Partial<Pick<Activity, 'withDog' | 'rain'>>) => {
  const a = await get<Activity>(A + id);
  if (a) await set(A + id, { ...a, ...patch });
};
export const deleteActivity = (id: string) => del(A + id);

export async function listActivities(): Promise<Activity[]> {
  const ks = (await keys()).filter((k) => String(k).startsWith(A));
  const all = (await getMany<Activity | undefined>(ks)).filter((x): x is Activity => !!x);
  return all.sort((a, b) => b.startedAt - a.startedAt);
}

export const getSetting = <V>(k: string) => get<V>('set:' + k);
export const putSetting = (k: string, v: unknown) => set('set:' + k, v);

// Shortlist: trails the user bookmarked. A trail saved for offline use is also kept here.
export interface Shortlisted { trail: Trail; addedAt: number }
export const getShortlisted = (id: string) => get<Shortlisted>(S + id);
export const putShortlisted = (trail: Trail) => set(S + trail.id, { trail, addedAt: Date.now() } satisfies Shortlisted);
/** Used by restore, to keep the original date. */
export const restoreShortlisted = (s: Shortlisted) => set(S + s.trail.id, s);
export const deleteShortlisted = (id: string) => del(S + id);

export async function listShortlisted(): Promise<Shortlisted[]> {
  const ks = (await keys()).filter((k) => String(k).startsWith(S));
  const all = (await getMany<Shortlisted | undefined>(ks)).filter((x): x is Shortlisted => !!x);
  return all.sort((a, b) => b.addedAt - a.addedAt);
}
