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

/** A row the server refused. `permanent` means retrying the same row will never work (a size or constraint refusal: RL003, 23514, 22001). */
export interface PushFailure { id: string; kind?: Kind; permanent: boolean; /** The account is over a storage or row limit (RL003). */ full?: boolean; /** The database refused the row's content (a failed check, 23514): it stays on this device and the person is told once. */ check?: boolean }

export interface Remote {
  /** The person's data epoch (goes up when "Delete my Ridgeline data" runs). 0 when they have no profile yet. */
  epoch(): Promise<number>;
  /** Rows the server wrote after `since` (its own clock), tombstones included, oldest first. */
  pull(kind: Kind, since: number): Promise<SyncRec[]>;
  /** Writes the records, tagged with `epoch`. A bad row must not stop the rest: its id comes back in `failed`. Throws StaleEpochError if the epoch is old. */
  push(kind: Kind, recs: SyncRec[], epoch: number): Promise<{ failed: PushFailure[] }>;
}
export interface Cursors {
  get(key: string): Promise<number>; set(key: string, v: number): Promise<void>;
  /** Small structured values (parked rows). Optional so simple stores still work. */
  getJson?<T>(key: string): Promise<T | undefined>; setJson?(key: string, v: unknown): Promise<void>;
}
/** Who the synced copy on this phone belongs to. */
export interface Owner { get(): Promise<string | null>; set(userId: string): Promise<void> }

export interface Parked { until: number; tries: number; editedAt: number; check?: boolean }
const HOUR = 3600_000;
/** How long a permanently refused row waits before it is tried again: 1 h, 2 h, 4 h ... up to 7 days. */
export const parkDelay = (tries: number) => Math.min(HOUR * 2 ** Math.max(0, tries - 1), 7 * 24 * HOUR);
/** How long a kind waits after a transient failure: 1 min, 2, 4 ... up to 15 min. */
export const retryDelay = (tries: number) => Math.min(60_000 * 2 ** Math.max(0, tries - 1), 15 * 60_000);

export interface SyncResult { pulled: number; pushed: number; failed: number; parked: number; deletedElsewhere: boolean; deferredWipe: boolean; ownerMismatch: boolean; /** The server refused something because the account is full. Nothing local is affected: it just is not uploaded. */ full: boolean; /** Which kinds of record were refused for that reason. */ fullKinds: Kind[]; /** How many rows are parked because the database refused their content (23514), per kind. */ checkParked: Partial<Record<Kind, number>> }
export interface SyncOptions {
  kinds?: Kind[]; canPush?: () => boolean;
  /** False while a hike is being recorded: an incoming "deleted on another device" waits until it is finished. */
  canWipe?: () => boolean;
  owner?: Owner;
  now?: () => number;
}

/** Cursor keys include the user, so a second account on the same phone never inherits the first one's progress. */
const key = (userId: string, kind: Kind, dir: 'pull' | 'push') => `sync:${userId}:${kind}:${dir}`;
/** The epoch this phone last saw, stored +1 so that 0 means "never seen" (first sign-in: adopt, do not wipe). */
const epochKey = (userId: string) => `sync:${userId}:epoch`;

const parkedKey = (u: string, k: Kind) => `sync:${u}:${k}:parked`;
const retryKey = (u: string, k: Kind) => `sync:${u}:${k}:retry`;
const triesKey = (u: string, k: Kind) => `sync:${u}:${k}:tries`;
const deferKey = (u: string) => `sync:${u}:wipeDeferredAt`;

export async function syncOnce(userId: string, local: LocalSource, remote: Remote, cursors: Cursors, opts: SyncOptions = {}): Promise<SyncResult> {
  const kinds = opts.kinds ?? KINDS;
  const now = (opts.now ?? Date.now)();
  const res: SyncResult = { pulled: 0, pushed: 0, failed: 0, parked: 0, deletedElsewhere: false, deferredWipe: false, ownerMismatch: false, full: false, fullKinds: [], checkParked: {} };

  // -1. Whose copy is on this phone? Signing out with "Keep a copy" leaves the first account's data here. A DIFFERENT account must not receive it
  // silently: nothing syncs until the person chooses (add it to this account, or remove it).
  if (opts.owner) {
    const owner = await opts.owner.get();
    let hasLocal = false;
    // Anything made on this phone counts: trails, hikes, deletions, and settings that were actually edited here (a settings record always exists).
    for (const k of KINDS) if ((await local.readAll(k)).some((r) => k !== 'settings' || r.editedAt > 0)) { hasLocal = true; break; }
    if (owner && owner !== userId && hasLocal) return { ...res, ownerMismatch: true };
    if (owner !== userId) await opts.owner.set(userId);
  }

  // 0. Was the data deleted from another device since this one last looked? Then drop the account copy here and upload nothing.
  const serverEpoch = await remote.epoch();
  const seen = await cursors.get(epochKey(userId));
  if (seen && serverEpoch > seen - 1) {
    // A hike being recorded is never wiped from under the person: wait until it is finished. What was recorded after the delete arrived is kept.
    if (opts.canWipe && !opts.canWipe()) {
      if (!(await cursors.get(deferKey(userId)))) await cursors.set(deferKey(userId), now);
      return { ...res, deferredWipe: true };
    }
    const since = (await cursors.get(deferKey(userId))) || now;
    await local.wipe({ keepActivitiesSince: since });     // clears the synced copies and every cursor, including this one
    await cursors.set(epochKey(userId), serverEpoch + 1);
    if (opts.owner) await opts.owner.set(userId);
    return { ...res, deletedElsewhere: true };
  }
  if (!seen) await cursors.set(epochKey(userId), serverEpoch + 1);

  for (const kind of kinds) {
    // 1. Pull and merge.
    const since = await cursors.get(key(userId, kind, 'pull'));
    const incoming = await remote.pull(kind, Math.max(0, since - PULL_OVERLAP_MS));
    if (incoming.length) {
      const here = new Map((await local.readAll(kind)).map((r) => [r.id, r]));
      for (const r of incoming) {
        if (winner(here.get(r.id), r) === 'remote') { await local.apply(r); res.pulled++; }
      }
      await cursors.set(key(userId, kind, 'pull'), Math.max(since, ...incoming.map((r) => r.syncedAt ?? 0)));
    }
    // 2. Push what was edited on this phone since the last push. The first pass after signing in pushes everything (the guest merge).
    // "Edited here" is the local edit stamp, never a server time: a record taken from the server has editedAt 0, so a server clock that
    // runs ahead can neither echo records back nor push the cursor past edits made here later.
    if (opts.canPush && !opts.canPush()) continue;       // a delete is starting: upload nothing more
    if (now < (await cursors.get(retryKey(userId, kind)))) continue;   // backing off after a transient failure
    const mark = await cursors.get(key(userId, kind, 'push'));
    const parked = (await cursors.getJson?.<Record<string, Parked>>(parkedKey(userId, kind))) ?? {};
    const all = await local.readAll(kind);
    const changed = all.filter((r) => r.editedAt > mark);
    // A refused-for-good row is parked: skipped until its backoff is over, or until the person edits it again.
    const ready = (r: SyncRec) => { const p = parked[r.id]; return !p || r.editedAt > p.editedAt || p.until <= now; };
    const dueAgain = all.filter((r) => r.editedAt <= mark && parked[r.id] && parked[r.id].until <= now);
    const candidates = [...changed.filter(ready), ...dueAgain];
    if (candidates.length) {
      const out = await remote.push(kind, candidates, serverEpoch);
      const bad = new Map(out.failed.map((f) => [f.id, f.permanent]));
      const checkIds = new Set(out.failed.filter((f) => f.check).map((f) => f.id));
      const byId = new Map(candidates.map((r) => [r.id, r]));
      // Permanent refusals are parked with a growing delay and the cursor moves past them; transient ones hold the cursor and back the kind off.
      for (const [id, permanent] of bad) {
        if (!permanent) continue;
        const tries = (parked[id]?.tries ?? 0) + 1;
        parked[id] = { until: now + parkDelay(tries), tries, editedAt: byId.get(id)!.editedAt, ...(checkIds.has(id) || parked[id]?.check ? { check: true } : {}) };
      }
      for (const r of candidates) if (!bad.has(r.id)) delete parked[r.id];
      const transient = candidates.filter((r) => bad.get(r.id) === false);
      const doneStamps = changed.filter((r) => !transient.includes(r)).map((r) => r.editedAt);
      const next = transient.length ? Math.min(...transient.map((r) => r.editedAt)) - 1 : Math.max(mark, ...doneStamps);
      await cursors.set(key(userId, kind, 'push'), Math.max(mark, next));
      await cursors.setJson?.(parkedKey(userId, kind), parked);
      const tries = transient.length ? (await cursors.get(triesKey(userId, kind))) + 1 : 0;
      await cursors.set(triesKey(userId, kind), tries);
      await cursors.set(retryKey(userId, kind), transient.length ? now + retryDelay(tries) : 0);
      res.pushed += candidates.length - bad.size;
      res.failed += bad.size;
      if (out.failed.some((f) => f.full)) { res.full = true; if (!res.fullKinds.includes(kind)) res.fullKinds.push(kind); }
      res.parked += Object.keys(parked).length;
      const nCheck = Object.values(parked).filter((p) => p.check).length;
      if (nCheck > 0) res.checkParked[kind] = nCheck;
    } else if (changed.length) {
      await cursors.set(key(userId, kind, 'push'), Math.max(mark, ...changed.map((r) => r.editedAt)));   // everything new was parked: move past it
    }
  }
  return res;
}
