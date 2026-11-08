// Local-first sync: IndexedDB stays the source the app reads. A pass pulls what changed on the server, applies the
// records that win (last write wins), then pushes what changed here. Nothing in a hike waits on this.
import { Kind, SyncRec, winner } from './merge';
import type { LocalSource } from './local';

/** Re-read this far behind the cursor: a row committed late (its synced_at older than a row we already saw) is still caught. Merging is idempotent. */
export const PULL_OVERLAP_MS = 60_000;

export const KINDS: Kind[] = ['shortlist', 'saved', 'activities', 'settings'];

export interface Remote {
  /** Rows the server wrote after `since` (its own clock), tombstones included, oldest first. */
  pull(kind: Kind, since: number): Promise<SyncRec[]>;
  push(kind: Kind, recs: SyncRec[]): Promise<void>;
}
export interface Cursors { get(key: string): Promise<number>; set(key: string, v: number): Promise<void> }

export interface SyncResult { pulled: number; pushed: number }

/** Cursor keys include the user, so a second account on the same phone never inherits the first one's progress. */
const key = (userId: string, kind: Kind, dir: 'pull' | 'push') => `sync:${userId}:${kind}:${dir}`;

export async function syncOnce(userId: string, local: LocalSource, remote: Remote, cursors: Cursors, kinds: Kind[] = KINDS): Promise<SyncResult> {
  let pulled = 0, pushed = 0;
  for (const kind of kinds) {
    // 1. Pull and merge.
    const since = await cursors.get(key(userId, kind, 'pull'));
    const incoming = await remote.pull(kind, Math.max(0, since - PULL_OVERLAP_MS));
    if (incoming.length) {
      const here = new Map((await local.readAll(kind)).map((r) => [r.id, r]));
      for (const r of incoming) {
        if (winner(here.get(r.id), r) === 'remote') { await local.apply(r); pulled++; }
      }
      await cursors.set(key(userId, kind, 'pull'), Math.max(since, ...incoming.map((r) => r.syncedAt ?? 0)));
    }
    // 2. Push what was edited on this phone since the last push. The first pass after signing in pushes everything (the guest merge).
    // "Edited here" is the local edit stamp, never a server time: a record taken from the server has editedAt 0, so a server clock that
    // runs ahead can neither echo records back nor push the cursor past edits made here later.
    const mark = await cursors.get(key(userId, kind, 'push'));
    const changed = (await local.readAll(kind)).filter((r) => r.editedAt > mark);
    if (changed.length) {
      await remote.push(kind, changed);
      await cursors.set(key(userId, kind, 'push'), Math.max(mark, ...changed.map((r) => r.editedAt)));
      pushed += changed.length;
    }
  }
  return { pulled, pushed };
}
