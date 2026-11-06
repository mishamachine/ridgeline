// Saved = one list. A trail is saved when it is bookmarked or downloaded; "Ready offline" is a state of it.
import { deleteShortlisted, listSaved, listShortlisted, putShortlisted } from './store';
import { removeTrailOffline } from './offline';
import type { Trail } from './trails';

export interface SavedItem { trail: Trail; offline: boolean; bytes: number; at: number }

export async function listAllSaved(): Promise<SavedItem[]> {
  const [marks, offline] = await Promise.all([listShortlisted(), listSaved()]);
  const out = new Map<string, SavedItem>();
  for (const m of marks) out.set(m.trail.id, { trail: m.trail, offline: false, bytes: 0, at: m.addedAt });
  for (const o of offline) {
    const prev = out.get(o.trail.id);
    out.set(o.trail.id, { trail: o.trail, offline: true, bytes: o.bytes, at: prev?.at ?? o.savedAt });
  }
  return [...out.values()].sort((a, b) => b.at - a.at);
}

export const bookmark = (t: Trail) => putShortlisted(t);

/** Take a trail off the list, and delete its offline map if it had one. */
export async function unsave(id: string) {
  await deleteShortlisted(id);
  await removeTrailOffline(id);
}

/** Ready-offline trails first, then the rest, newest first within each. */
export const forHike = (items: SavedItem[]) => [...items].sort((a, b) => Number(b.offline) - Number(a.offline) || b.at - a.at);
