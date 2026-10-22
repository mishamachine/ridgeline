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

export interface Activity {
  id: string;
  name: string;
  trailId?: string;
  startedAt: number;
  endedAt?: number;
  points: TrackPoint[];
}

const T = 'trail:', A = 'act:';

export const getSaved = (id: string) => get<SavedTrail>(T + id);
export const putSaved = (s: SavedTrail) => set(T + s.trail.id, s);
export const deleteSaved = (id: string) => del(T + id);

export async function listSaved(): Promise<SavedTrail[]> {
  const ks = (await keys()).filter((k) => String(k).startsWith(T));
  const all = (await getMany<SavedTrail | undefined>(ks)).filter((x): x is SavedTrail => !!x);
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

export const putActivity = (a: Activity) => set(A + a.id, a);
export const deleteActivity = (id: string) => del(A + id);

export async function listActivities(): Promise<Activity[]> {
  const ks = (await keys()).filter((k) => String(k).startsWith(A));
  const all = (await getMany<Activity | undefined>(ks)).filter((x): x is Activity => !!x);
  return all.sort((a, b) => b.startedAt - a.startedAt);
}

/** Elevation profiles, cached so repeat views don't re-fetch. */
export const getElevation = (id: string) => get<number[]>('elev:' + id);
export const putElevation = (id: string, e: number[]) => set('elev:' + id, e);

export const getSetting = <V>(k: string) => get<V>('set:' + k);
export const putSetting = (k: string, v: unknown) => set('set:' + k, v);
