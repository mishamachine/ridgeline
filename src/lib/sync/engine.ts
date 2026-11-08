// Local-first sync: IndexedDB stays the source the app reads. A pass pulls what changed on the server, applies the
// records that win (last write wins), then pushes what changed here. Nothing in a hike waits on this.
import { Kind, SyncRec, winner } from './merge';
import type { LocalSource } from './local';

/** Re-read this far behind the cursor: a row committed late (its synced_at older than a row we already saw) is still caught. Merging is idempotent. */
export const PULL_OVERLAP_MS = 60_000;

export const KINDS: Kind[] = ['shortlist', 'saved', 'activities', 'settings'];

/** The server refused a write because the data was deleted from another device after this one last looked. */
export class StaleEpochError extends Error { constructor() { super('stale data epoch'); } }

/** The server refuses writes while sign-in is paused (the pause switch). Not an error to show: sync simply waits. */
export class PausedError extends Error { constructor() { super('sign-in is paused'); } }

export interface Remote {
  /** The person's data epoch (goes up when "Delete my Ridgeline data" runs). 0 when they have no profile yet. */
  epoch(): Promise<number>;
  /** Rows the server wrote after `since` (its own clock), tombstones included, oldest first. */
  pull(kind: Kind, since: number): Promise<SyncRec[]>;
  /** Writes the records, tagged with `epoch`. A bad row must not stop the rest: its id comes back in `failed`. Throws StaleEpochError if the epoch is old. */
  push(kind: Kind, recs: SyncRec[], epoch: number): Promise<{ failed: string[] }>;
}
export interface Cursors { get(key: string): Promise<number>; set(key: string, v: number): Promise<void> }

export interface SyncResult { pulled: number; pushed: number; failed: number; deletedElsewhere: boolean }
export interface SyncOptions { kinds?: Kind[]; canPush?: () => boolean }

/** Cursor keys include the user, so a second account on the same phone never inherits the first one's progress. */
const key = (userId: string, kind: Kind, dir: 'pull' | 'push') => `sync:${userId}:${kind}:${dir}`;
/** The epoch this phone last saw, stored +1 so that 0 means "never seen" (first sign-in: adopt, do not wipe). */
const epochKey = (userId: string) => `sync:${userId}:epoch`;

export async function syncOnce(userId: string, local: LocalSource, remote: Remote, cursors: Cursors, opts: SyncOptions = {}): Promise<SyncResult> {
  const kinds = opts.kinds ?? KINDS;
  let pulled = 0, pushed = 0, failed = 0;

  // 0. Was the data deleted from another device since this one last looked? Then drop the account copy here and upload nothing.
  const serverEpoch = await remote.epoch();
  const seen = await cursors.get(epochKey(userId));
  if (seen && serverEpoch > seen - 1) {
    await local.wipe();                                  // clears the synced copies and every cursor, including this one
    await cursors.set(epochKey(userId), serverEpoch + 1);
    return { pulled: 0, pushed: 0, failed: 0, deletedElsewhere: true };
  }
  if (!seen) await cursors.set(epochKey(userId), serverEpoch + 1);

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
    if (opts.canPush && !opts.canPush()) continue;       // a delete is starting: upload nothing more
    const mark = await cursors.get(key(userId, kind, 'push'));
    const changed = (await local.readAll(kind)).filter((r) => r.editedAt > mark);
    if (changed.length) {
      const res = await remote.push(kind, changed, serverEpoch);
      const bad = new Set(res.failed);
      const badStamps = changed.filter((r) => bad.has(r.id)).map((r) => r.editedAt);
      // One bad row must not wedge the rest: the cursor stops just below the oldest failed row, so it is retried next pass while the others are done.
      const next = badStamps.length ? Math.min(...badStamps) - 1 : Math.max(...changed.map((r) => r.editedAt));
      await cursors.set(key(userId, kind, 'push'), Math.max(mark, next));
      pushed += changed.length - bad.size;
      failed += bad.size;
    }
  }
  return { pulled, pushed, failed, deletedElsewhere: false };
}
