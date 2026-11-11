import { describe, it, expect, vi } from 'vitest';

// These tests pin the phone wording; the web wording is pinned in its own test below.
vi.mock('../native/platform', () => ({ nativePlatform: () => 'ios', isNative: () => true }));
import { StaleEpochError, parkDelay, retryDelay, syncOnce, type Cursors, type Owner, type PushFailure, type Remote, type SyncOptions } from './engine';
import { syncGate } from './gate';
import { fitTrack, MAX_UPLOAD_POINTS } from './trim';
import { parkedText, noteParked, takeParkedNotes } from './fullNote';
import { FULL_NOTE_HIKES, FULL_NOTE_HIKES_WEB, FULL_NOTE_SAVED, FULL_NOTE_SAVED_WEB, FULL_NOTE_SHORTLIST, FULL_NOTE_SHORTLIST_WEB, fullKindOf, fullText, noteAccountFull, takeFullNotes } from './fullNote';
import type { LocalSource } from './local';
import { winner, type Kind, type SyncRec } from './merge';
import { activityToRow, fromRow, supabaseRemote, toRow } from './remote';
import type { Activity } from '../store';

// A fake server with the same rules as the SQL: synced_at set on every write, stale writes ignored, future clocks clamped,
// writes tagged with an old data epoch refused, and delete_user_data (wipe everything, epoch + 1).
class Server {
  rows = new Map<string, SyncRec>(); clock = 10_000_000; dataEpoch = 0;
  rejectIds = new Set<string>();          // rows the database refuses for good (a constraint violation)
  flakyIds = new Set<string>();           // rows that fail for a passing reason (a timeout)
  checkIds = new Set<string>();           // rows refused for their content (23514)
  fullIds = new Set<string>();            // rows refused because the account is full (54000)
  pushes: { kind: Kind; ids: string[] }[] = [];
  deleteUserData() { this.rows.clear(); this.dataEpoch++; }
  remote(): Remote {
    return {
      epoch: async () => this.dataEpoch,
      pull: async (kind, since) => [...this.rows.values()].filter((r) => r.kind === kind && r.syncedAt! > since).sort((a, b) => a.syncedAt! - b.syncedAt!),
      push: async (kind, recs, epoch) => {
        if (epoch < this.dataEpoch) throw new StaleEpochError();
        this.clock++;
        this.pushes.push({ kind, ids: recs.map((r) => r.id) });
        const failed: PushFailure[] = [];
        for (const r of recs) {
          if (this.rejectIds.has(r.id)) { failed.push({ id: r.id, permanent: true }); continue; }
          if (this.checkIds.has(r.id)) { failed.push({ id: r.id, permanent: true, check: true }); continue; }
          if (this.fullIds.has(r.id)) { failed.push({ id: r.id, permanent: true, full: true }); continue; }
          if (this.flakyIds.has(r.id)) { failed.push({ id: r.id, permanent: false }); continue; }
          const k = kind + '/' + r.id, old = this.rows.get(k);
          if (old && r.updatedAt < old.updatedAt) continue;
          this.rows.set(k, { ...r, updatedAt: Math.min(r.updatedAt, this.clock), syncedAt: this.clock });
        }
        return { failed };
      },
    };
  }
}
class Phone implements LocalSource {
  recs = new Map<string, SyncRec>(); cursors = new Map<string, number>(); json = new Map<string, unknown>(); ownerId: string | null = null;
  cur: Cursors = { get: async (k) => this.cursors.get(k) ?? 0, set: async (k, v) => { this.cursors.set(k, v); }, getJson: async <T,>(k: string) => this.json.get(k) as T | undefined, setJson: async (k, v) => { this.json.set(k, v); } };
  owner: Owner = { get: async () => this.ownerId, set: async (id) => { this.ownerId = id; } };
  inProgress = new Set<string>();           // ids of hikes recorded (not finished) when a wipe arrives
  seq = 0; // the local edit stamp: rises on edits made on this phone only
  put(kind: Kind, id: string, updatedAt: number, payload: unknown = { n: id }) { this.recs.set(kind + '/' + id, { kind, id, updatedAt, editedAt: ++this.seq, deleted: false, payload }); }
  del(kind: Kind, id: string, updatedAt: number) { this.recs.set(kind + '/' + id, { kind, id, updatedAt, editedAt: ++this.seq, deleted: true, payload: null }); }
  async readAll(kind: Kind) { return [...this.recs.values()].filter((r) => r.kind === kind); }
  async apply(r: SyncRec) { this.recs.set(r.kind + '/' + r.id, { ...r, editedAt: 0 }); } // a record taken from the server was not edited here
  async wipe(keep?: { keepActivitiesSince: number }) {
    for (const [k, r] of [...this.recs]) { if (keep && r.kind === 'activities' && (this.inProgress.has(r.id) || ((r.payload as { endedAt?: number } | null)?.endedAt ?? 0) >= keep.keepActivitiesSince)) continue; this.recs.delete(k); }
    this.cursors.clear(); this.json.clear();
  }
  live(kind: Kind) { return [...this.recs.values()].filter((r) => r.kind === kind && !r.deleted).map((r) => r.id).sort(); }
  syncFull(s: Server, user = 'u1', opts?: SyncOptions) { return syncOnce(user, this, s.remote(), this.cur, opts); }
  async sync(s: Server, user = 'u1') { const r = await this.syncFull(s, user); return { pulled: r.pulled, pushed: r.pushed }; }
  /** Like syncFull, but with the owner check and a clock the test controls. */
  syncAs(s: Server, user: string, now: number, extra: SyncOptions = {}) { return syncOnce(user, this, s.remote(), this.cur, { owner: this.owner, now: () => now, ...extra }); }
}

describe('last write wins', () => {
  const r = (updatedAt: number, deleted = false): SyncRec => ({ kind: 'saved', id: 'x', updatedAt, editedAt: 0, deleted, payload: null });
  it('newer wins; a tie goes to the deletion, else stays local', () => {
    expect(winner(undefined, r(1))).toBe('remote');
    expect(winner(r(1), r(2))).toBe('remote');
    expect(winner(r(2), r(1))).toBe('local');
    expect(winner(r(5), r(5, true))).toBe('remote');
    expect(winner(r(5, true), r(5))).toBe('local');
    expect(winner(r(5), r(5))).toBe('local');
  });
});

describe('two-device sync', () => {
  it('a guest with 3 saved trails and 2 hikes signs in, and all of it appears on a second device', async () => {
    const s = new Server(), a = new Phone(), b = new Phone();
    for (const i of [1, 2, 3]) a.put('shortlist', 'way/' + i, 100 + i);
    for (const i of [1, 2]) a.put('activities', 'h' + i, 200 + i);
    await a.sync(s);
    await b.sync(s);
    expect(b.live('shortlist')).toEqual(['way/1', 'way/2', 'way/3']);
    expect(b.live('activities')).toEqual(['h1', 'h2']);
  });
  it('a hike deleted on device A disappears on device B', async () => {
    const s = new Server(), a = new Phone(), b = new Phone();
    a.put('activities', 'h1', 100); a.put('activities', 'h2', 101);
    await a.sync(s); await b.sync(s);
    a.del('activities', 'h1', 500);
    await a.sync(s); await b.sync(s);
    expect(b.live('activities')).toEqual(['h2']);
  });
  it('merging a guest into an account that already has data keeps both, and skips duplicates by id', async () => {
    const s = new Server(), a = new Phone(), b = new Phone();
    a.put('shortlist', 'way/1', 10); a.put('shortlist', 'way/2', 11);
    await a.sync(s);
    b.put('shortlist', 'way/2', 11); b.put('shortlist', 'way/3', 12); // the guest's data
    await b.sync(s); await a.sync(s);
    expect(a.live('shortlist')).toEqual(['way/1', 'way/2', 'way/3']);
    expect(b.live('shortlist')).toEqual(['way/1', 'way/2', 'way/3']);
    expect([...s.rows.keys()].filter((k) => k.startsWith('shortlist/'))).toHaveLength(3);
  });
  it('an offline device that syncs late still reaches the others, and a stale edit does not overwrite a newer one', async () => {
    const s = new Server(), a = new Phone(), b = new Phone(), c = new Phone();
    a.put('settings', 'settings', 100, { units: 'imperial' });
    await a.sync(s); await b.sync(s); await c.sync(s);
    b.put('settings', 'settings', 300, { units: 'metric' });   // B edits later but is offline
    a.put('settings', 'settings', 200, { units: 'imperial', voice: false });
    await a.sync(s);                                            // A syncs first (older edit)
    await b.sync(s);                                            // B syncs second: its newer edit wins
    await c.sync(s); await a.sync(s);
    for (const p of [a, b, c]) expect((p.recs.get('settings/settings')!.payload as { units: string }).units).toBe('metric');
  });
  it('does not echo what the server just sent, and a second pass moves nothing', async () => {
    const s = new Server(), a = new Phone(), b = new Phone();
    a.put('saved', 'way/1', 10);
    await a.sync(s);
    expect(await b.sync(s)).toEqual({ pulled: 1, pushed: 0 });
    expect(await b.sync(s)).toEqual({ pulled: 0, pushed: 0 });
    expect(await a.sync(s)).toEqual({ pulled: 0, pushed: 0 });
  });
  it('a second account on the same phone does not inherit the first one\'s cursors', async () => {
    const s = new Server(), a = new Phone();
    a.put('shortlist', 'way/1', 10);
    await a.sync(s, 'user-1');
    const other = new Server();
    await a.sync(other, 'user-2');
    expect([...other.rows.keys()]).toEqual(['shortlist/way/1']); // pushed in full to the new account (the "keep a copy" merge)
  });
});

describe('delete on one device, the other stays signed in', () => {
  it('B uploads nothing, clears its copy, the server has zero rows, and B syncs normally afterwards', async () => {
    const s = new Server(), a = new Phone(), b = new Phone();
    for (const i of [1, 2, 3]) a.put('shortlist', 'way/' + i, 100 + i);
    a.put('activities', 'h1', 200);
    await a.sync(s); await b.sync(s);
    expect(b.live('shortlist')).toHaveLength(3);
    // A runs "Delete my Ridgeline data": the server is emptied and the epoch goes up; A wipes itself.
    s.deleteUserData(); await a.wipe();
    // B is still signed in and has local edits it has not uploaded yet.
    b.put('shortlist', 'way/9', 500);
    s.pushes.length = 0;
    const r = await b.syncFull(s);
    expect(r.deletedElsewhere).toBe(true);
    expect(r).toMatchObject({ pulled: 0, pushed: 0 });
    expect(s.pushes).toEqual([]);                       // nothing uploaded
    expect(s.rows.size).toBe(0);                        // the server has zero rows
    expect(b.recs.size).toBe(0);                        // B cleared its account copy (including the edit it had not uploaded)
    // B carries on normally: new items upload and reach another device.
    b.put('shortlist', 'new-after', 900);
    expect(await b.sync(s)).toEqual({ pulled: 0, pushed: 1 });
    const c = new Phone(); await c.sync(s);
    expect(c.live('shortlist')).toEqual(['new-after']);
  });
  it('a push that crosses the delete is refused by the server, and the next pass clears the phone', async () => {
    const s = new Server(), a = new Phone(), b = new Phone();
    a.put('shortlist', 'way/1', 1); await a.sync(s); await b.sync(s);
    b.put('shortlist', 'late', 2);
    // B has read epoch 0; A deletes; B's push arrives with epoch 0.
    const remote = s.remote();
    const racing: Remote = { ...remote, epoch: async () => { const e = s.dataEpoch; s.deleteUserData(); return e; } };
    await expect(syncOnce('u1', b, racing, b.cur)).rejects.toBeInstanceOf(StaleEpochError);
    expect(s.rows.size).toBe(0);
    const next = await b.syncFull(s);
    expect(next.deletedElsewhere).toBe(true);
    expect(b.recs.size).toBe(0);
  });
  it('the first sign-in on a phone adopts the epoch and keeps its guest data (no wipe)', async () => {
    const s = new Server(); s.dataEpoch = 3;
    const a = new Phone(); a.put('shortlist', 'guest-trail', 5);
    const r = await a.syncFull(s);
    expect(r.deletedElsewhere).toBe(false);
    expect(a.live('shortlist')).toEqual(['guest-trail']);
    expect(s.rows.has('shortlist/guest-trail')).toBe(true);
  });
});

describe('one bad row does not wedge sync', () => {
  it('a row the database refuses for good is parked: the cursor moves past it, the others go through, it is retried only after a growing delay or an edit', async () => {
    const s = new Server(), a = new Phone();
    a.put('activities', 'ok1', 1); a.put('activities', 'bad', 2); a.put('activities', 'ok2', 3);
    s.rejectIds.add('bad');
    const T0 = 1_000_000;
    const first = await a.syncAs(s, 'u1', T0);
    expect(first).toMatchObject({ pushed: 2, failed: 1 });
    expect([...s.rows.keys()].sort()).toEqual(['activities/ok1', 'activities/ok2']);
    const parked = a.json.get('sync:u1:activities:parked') as Record<string, { until: number; tries: number }>;
    expect(parked.bad.until).toBe(T0 + parkDelay(1));
    // The cursor passed the bad row: new edits upload at once and the bad row is NOT sent again yet.
    s.pushes.length = 0;
    a.put('activities', 'ok3', 4);
    const second = await a.syncAs(s, 'u1', T0 + 60_000);
    expect(second).toMatchObject({ pushed: 1, failed: 0 });
    expect(s.pushes.flatMap((p) => p.ids)).toEqual(['ok3']);
    // Still refused when its time comes: parked again with a longer delay.
    const third = await a.syncAs(s, 'u1', T0 + parkDelay(1) + 1);
    expect(third.failed).toBe(1);
    expect((a.json.get('sync:u1:activities:parked') as Record<string, { until: number }>).bad.until).toBe(T0 + parkDelay(1) + 1 + parkDelay(2));
    expect(parkDelay(2)).toBe(2 * parkDelay(1));
    // Fixed (or edited) later: it goes through and is un-parked.
    s.rejectIds.clear();
    const fourth = await a.syncAs(s, 'u1', T0 + parkDelay(1) + 1 + parkDelay(2) + 1);
    expect(fourth.failed).toBe(0);
    expect(s.rows.has('activities/bad')).toBe(true);
    expect((a.json.get('sync:u1:activities:parked') as Record<string, unknown>).bad).toBeUndefined();
  });
  it('editing a parked row tries it again at once', async () => {
    const s = new Server(), a = new Phone();
    a.put('activities', 'bad', 1);
    s.rejectIds.add('bad');
    await a.syncAs(s, 'u1', 1_000_000);
    s.rejectIds.clear();
    a.put('activities', 'bad', 2, { n: 'smaller' });                 // the person trimmed it
    const r = await a.syncAs(s, 'u1', 1_000_001);
    expect(r).toMatchObject({ pushed: 1, failed: 0 });
    expect(s.rows.has('activities/bad')).toBe(true);
  });
  it('a passing failure holds the cursor and backs the kind off (1 min, 2, 4 ... up to 15), then recovers', async () => {
    const s = new Server(), a = new Phone();
    a.put('activities', 'flaky', 1); a.put('activities', 'ok', 2);
    s.flakyIds.add('flaky');
    const T0 = 5_000_000;
    expect(await a.syncAs(s, 'u1', T0)).toMatchObject({ pushed: 1, failed: 1 });
    s.pushes.length = 0;
    expect(await a.syncAs(s, 'u1', T0 + 1000)).toMatchObject({ pushed: 0, failed: 0 });   // backing off: nothing sent
    expect(s.pushes).toEqual([]);
    expect(await a.syncAs(s, 'u1', T0 + retryDelay(1) + 1)).toMatchObject({ failed: 1 }); // tried again after the delay
    expect(retryDelay(2)).toBe(2 * retryDelay(1));
    expect(retryDelay(20)).toBe(15 * 60_000);
    s.flakyIds.clear();
    const later = await a.syncAs(s, 'u1', T0 + retryDelay(1) + 1 + retryDelay(2) + 1);
    expect(later.failed).toBe(0);
    expect(s.rows.has('activities/flaky')).toBe(true);
  });
});

describe('a delete from another device does not wipe the hike being recorded', () => {
  it('the wipe waits while a hike is active, then clears everything except what was recorded in the meantime', async () => {
    const s = new Server(), a = new Phone(), b = new Phone();
    a.put('activities', 'old', 100, { n: 'old', endedAt: 1_000 }); await a.sync(s); await b.sync(s);
    s.deleteUserData();                                              // the other phone deletes
    b.put('activities', 'now', 2_000_000, { n: 'now' });             // B is recording a hike
    b.inProgress.add('now');
    const T = 9_000_000;
    const deferred = await b.syncAs(s, 'u1', T, { canWipe: () => false });
    expect(deferred).toMatchObject({ deferredWipe: true, deletedElsewhere: false });
    expect(b.recs.has('activities/old')).toBe(true);                 // nothing wiped yet, nothing uploaded
    expect(b.recs.has('activities/now')).toBe(true);
    expect(s.rows.size).toBe(0);
    // The hike ends; the next pass wipes the account copy but keeps the hike that was being recorded.
    b.inProgress.clear();
    b.recs.set('activities/now', { ...b.recs.get('activities/now')!, payload: { n: 'now', endedAt: T + 60_000 } });
    const done = await b.syncAs(s, 'u1', T + 120_000, { canWipe: () => true });
    expect(done.deletedElsewhere).toBe(true);
    expect(b.recs.has('activities/old')).toBe(false);
    expect(b.recs.has('activities/now')).toBe(true);
    // And it uploads under the new epoch on the next pass.
    b.recs.set('activities/now', { ...b.recs.get('activities/now')!, editedAt: ++b.seq });
    expect(await b.syncAs(s, 'u1', T + 180_000)).toMatchObject({ pushed: 1 });
  });
});

describe('another account signing in on a phone that kept the first account\'s copy', () => {
  it('uploads nothing until the person chooses; "add" hands it over, "remove" clears it', async () => {
    const s1 = new Server(), s2 = new Server(), a = new Phone();
    a.put('shortlist', 'mine', 1);
    await a.syncAs(s1, 'user-A', 10);                                // account A syncs; the phone now belongs to A
    expect(a.ownerId).toBe('user-A');
    // A signs out keeping a copy; B signs in.
    const blocked = await a.syncAs(s2, 'user-B', 20);
    expect(blocked.ownerMismatch).toBe(true);
    expect(s2.rows.size).toBe(0);
    expect(s2.pushes).toEqual([]);
    // 'add': B takes the copy.
    a.ownerId = 'user-B';
    expect((await a.syncAs(s2, 'user-B', 30)).pushed).toBe(1);
    // 'remove' path: clear, then sync as B with nothing to upload.
    const c = new Phone(); c.put('shortlist', 'theirs', 1);
    await c.syncAs(s1, 'user-A', 10);
    expect((await c.syncAs(new Server(), 'user-B', 20)).ownerMismatch).toBe(true);
    await c.wipe(); c.ownerId = 'user-B';
    const after = await c.syncAs(new Server(), 'user-B', 30);
    expect(after).toMatchObject({ ownerMismatch: false, pushed: 0 });
  });
  it('guest data (never synced) goes to the first account that signs in; the same account signing in again is not asked', async () => {
    const s = new Server(), a = new Phone();
    a.put('shortlist', 'guest-trail', 1);
    expect((await a.syncAs(s, 'user-A', 10)).ownerMismatch).toBe(false);
    expect(a.ownerId).toBe('user-A');
    expect((await a.syncAs(s, 'user-A', 20)).ownerMismatch).toBe(false);
  });
  it('an empty phone just becomes the new account\'s', async () => {
    const s = new Server(), a = new Phone();
    a.ownerId = 'user-A';
    expect((await a.syncAs(s, 'user-B', 10)).ownerMismatch).toBe(false);
    expect(a.ownerId).toBe('user-B');
  });
});

describe('a delete cannot race a sync', () => {
  it('pause() waits for the pass in flight; nothing is pushed after the delete begins; passes stay blocked until resume()', async () => {
    const s = new Server(), a = new Phone();
    a.put('shortlist', 'w1', 1);
    const events: string[] = [];
    const slow: Remote = { ...s.remote(), push: async (k, r, e) => { await new Promise((res) => setTimeout(res, 30)); events.push('push-done'); return s.remote().push(k, r, e); } };
    const pass = syncGate.run(() => syncOnce('u1', a, slow, a.cur, { canPush: () => !syncGate.paused }));
    await new Promise((res) => setTimeout(res, 5));                 // the pass is mid-push
    await syncGate.pause();                                         // what the delete flow does first
    events.push('delete-starts');
    await pass;
    a.put('shortlist', 'w2', 2);                                    // an edit made while the delete runs
    expect(await syncGate.run(() => syncOnce('u1', a, slow, a.cur))).toBeUndefined();   // a new pass does not even start
    s.deleteUserData(); await a.wipe(); events.push('wiped');
    syncGate.resume();
    expect(events).toEqual(['push-done', 'delete-starts', 'wiped']);
    expect(s.rows.size).toBe(0);                                    // the racing pass pushed nothing after the delete
  });
  it('a pass that is told to stop pushing uploads nothing', async () => {
    const s = new Server(), a = new Phone();
    a.put('shortlist', 'w1', 1);
    const r = await a.syncFull(s, 'u1', { canPush: () => false });
    expect(r.pushed).toBe(0);
    expect(s.rows.size).toBe(0);
  });
});

describe('long routes fit the server cap', () => {
  const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ lon: -121.8 + i * 1e-5, lat: 47.4 + i * 1e-5, alt: 300, acc: 5, t: i * 1000 }));
  it('a 40,000-point track is thinned to the upload limit, keeping its first and last points', () => {
    const long = pts(40_000), out = fitTrack(long)!;
    expect(out).toHaveLength(MAX_UPLOAD_POINTS);
    expect(out[0]).toBe(long[0]);
    expect(out[out.length - 1]).toBe(long[long.length - 1]);
  });
  it('a track under the limit is untouched', () => {
    const t = pts(100);
    expect(fitTrack(t)).toBe(t);
    expect(fitTrack(null)).toBeNull();
  });
  it('5,000 points stay well under the 1 MB server cap (measured about 124 bytes a point in Postgres)', () => {
    expect(MAX_UPLOAD_POINTS * 124).toBeLessThan(1_048_576 * 0.7);
  });
});

describe('the push cursor follows local edits, not server times', () => {
  it('a server clock running ahead cannot hide edits made here afterwards', async () => {
    const s = new Server(), a = new Phone(), b = new Phone();
    // Device B's clock is a day ahead: its record arrives with an updatedAt far in the future.
    const FUTURE = 5_000_000_000;
    s.rows.set('shortlist/from-b', { kind: 'shortlist', id: 'from-b', updatedAt: FUTURE, editedAt: 0, deleted: false, payload: { n: 'b' }, syncedAt: s.clock });
    await a.sync(s);                                   // A applies it
    a.put('shortlist', 'mine', 1_000);                 // A's own clock is behind the future record; the edit is real
    expect(await a.sync(s)).toEqual({ pulled: 0, pushed: 1 });
    expect(s.rows.has('shortlist/mine')).toBe(true);
    await b.sync(s);
    expect(b.live('shortlist')).toEqual(['from-b', 'mine']);
  });
  it('records taken from the server are never uploaded back', async () => {
    const s = new Server(), a = new Phone(), b = new Phone();
    a.put('activities', 'h1', 100);
    await a.sync(s);
    expect(await b.sync(s)).toEqual({ pulled: 1, pushed: 0 });
    expect(b.recs.get('activities/h1')!.editedAt).toBe(0);
  });
  it('an edit made here after a pull is pushed once, then not again', async () => {
    const s = new Server(), a = new Phone(), b = new Phone();
    a.put('activities', 'h1', 100);
    await a.sync(s); await b.sync(s);
    b.put('activities', 'h1', 300, { n: 'edited' });
    expect(await b.sync(s)).toEqual({ pulled: 0, pushed: 1 });
    expect(await b.sync(s)).toEqual({ pulled: 0, pushed: 0 });
    await a.sync(s);
    expect((a.recs.get('activities/h1')!.payload as { n: string }).n).toBe('edited');
  });
});

describe('pull overlap', () => {
  it('catches a row that was committed late, with a synced_at older than one the phone already saw', async () => {
    const s = new Server(), a = new Phone(), b = new Phone();
    a.put('shortlist', 'way/1', 10);
    await a.sync(s); await b.sync(s);                       // B's cursor is now at the first row's synced_at
    const cursorBefore = b.cursors.get('sync:u1:shortlist:pull')!;
    // A row from another device shows up with a synced_at slightly BEHIND B's cursor (commit order differs from clock order).
    s.rows.set('shortlist/way/2', { kind: 'shortlist', id: 'way/2', updatedAt: 20, editedAt: 0, deleted: false, payload: { n: 'way/2' }, syncedAt: cursorBefore - 5 });
    s.rows.set('shortlist/way/3', { kind: 'shortlist', id: 'way/3', updatedAt: 21, editedAt: 0, deleted: false, payload: { n: 'way/3' }, syncedAt: cursorBefore + 5 });
    await b.sync(s);
    expect(b.live('shortlist')).toEqual(['way/1', 'way/2', 'way/3']);
  });
  it('the overlap is harmless: re-read rows are not applied again or echoed back', async () => {
    const s = new Server(), a = new Phone(), b = new Phone();
    a.put('shortlist', 'way/1', 10);
    await a.sync(s); await b.sync(s);
    expect(await b.sync(s)).toEqual({ pulled: 0, pushed: 0 });
    expect(await b.sync(s)).toEqual({ pulled: 0, pushed: 0 });
  });
});

describe('what goes to the server', () => {
  const act: Activity = { id: 'h1', name: 'Rattlesnake Ledge', trailId: 'way/1', startedAt: 1_700_000_000_000, endedAt: 1_700_003_600_000, withDog: true, rain: false, pausedMs: 5000, updatedAt: 1_700_003_700_000,
    points: Array.from({ length: 41 }, (_, i) => ({ lon: -121.8, lat: 47.4 + i * 0.00045, alt: 300, acc: 5, t: i * 1000 })) };
  const rec = (a: Activity): SyncRec => ({ kind: 'activities', id: a.id, updatedAt: a.updatedAt!, editedAt: a.updatedAt!, deleted: false, payload: a });

  it('the route is trimmed before upload', () => {
    const row = activityToRow('u1', rec(act), false) as { track: unknown[] };
    expect(row.track.length).toBeGreaterThan(0);
    expect(row.track.length).toBeLessThan(act.points.length);
  });
  it('"keep tracks on this phone only" uploads no route at all, but still the hike summary', () => {
    const row = activityToRow('u1', rec(act), true) as { track: unknown; stats: Record<string, unknown>; trail_id: string };
    expect(row.track).toBeNull();
    expect(row.stats).toMatchObject({ name: 'Rattlesnake Ledge', withDog: true, pausedMs: 5000 });
    expect(row.trail_id).toBe('way/1');
  });
  it('carries no name, email or user fields besides user_id, and the server never sees the raw points object', () => {
    const row = activityToRow('u1', rec(act), false);
    expect(Object.keys(row).sort()).toEqual(['id', 'started_at', 'stats', 'track', 'trail_id', 'updated_at', 'deleted', 'user_id', 'epoch'].sort());
    expect(JSON.stringify(row.stats)).not.toContain('points');
  });
  it('round-trips a hike through a server row, and a trimmed route does not replace nothing', () => {
    const row = { ...activityToRow('u1', rec(act), false), synced_at: '2026-11-07T10:00:00.000Z' };
    const back = fromRow('activities', row)!;
    expect(back.syncedAt).toBe(Date.parse('2026-11-07T10:00:00.000Z'));
    const a = back.payload as Activity;
    expect(a).toMatchObject({ id: 'h1', name: 'Rattlesnake Ledge', trailId: 'way/1', withDog: true, pausedMs: 5000, startedAt: act.startedAt });
    expect(a.points.length).toBeLessThan(act.points.length);
  });
  it('a tombstone is a row with deleted = true and no data; a bad row is skipped', () => {
    const t = toRow('u1', { kind: 'shortlist', id: 'way/9', updatedAt: 5, editedAt: 5, deleted: true, payload: null }, false);
    expect(t).toMatchObject({ trail_id: 'way/9', trail: null, deleted: true });
    expect(fromRow('activities', { id: 'x', updated_at: 'nonsense', synced_at: 'nonsense' })).toBeNull();
    expect(fromRow('activities', { id: 'x', updated_at: '2026-01-01T00:00:00Z', synced_at: '2026-01-01T00:00:00Z', stats: {}, started_at: '2026-01-01T00:00:00Z', track: [{ lon: 'bad' }] })).toBeNull();
  });
});

describe('a full account never blocks or loses a hike', () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
  it('at the cap a new hike still records and is kept on the phone; only the upload stops (parked, no retry storm); the note shows once', async () => {
    const s = new Server(), a = new Phone(), store = mem();
    a.put('activities', 'old-hike', 1); await a.syncAs(s, 'u1', 1_000_000);
    s.fullIds.add('new-hike');                                       // the account is at its cap: the server refuses the next hike
    a.put('activities', 'new-hike', 2, { n: 'recorded after the cap' });
    const r = await a.syncAs(s, 'u1', 2_000_000);
    expect(r).toMatchObject({ pushed: 0, failed: 1, full: true });
    expect(a.recs.get('activities/new-hike')!.payload).toEqual({ n: 'recorded after the cap' });   // the hike is on the phone, untouched
    expect(s.rows.has('activities/new-hike')).toBe(false);                                         // and not uploaded
    expect(r.fullKinds).toEqual(['activities']);
    for (const k of r.fullKinds) noteAccountFull('u1', fullKindOf(k)!, store);
    // Parked, so passes in the next hour do not send it again (no retry storm).
    s.pushes.length = 0;
    await a.syncAs(s, 'u1', 2_000_000 + 60_000); await a.syncAs(s, 'u1', 2_000_000 + 120_000);
    expect(s.pushes.flatMap((p) => p.ids)).not.toContain('new-hike');
    // More hikes while full: they record locally; more full signals do not bring the note back.
    s.fullIds.add('another'); a.put('activities', 'another', 3);
    const r2 = await a.syncAs(s, 'u1', 2_000_000 + 180_000);
    for (const k of r2.fullKinds) noteAccountFull('u1', fullKindOf(k)!, store);
    expect(a.recs.has('activities/another')).toBe(true);
    expect(takeFullNotes('u1', store)).toEqual([FULL_NOTE_HIKES]);      // shown once...
    expect(takeFullNotes('u1', store)).toEqual([]);
    noteAccountFull('u1', 'hikes', store);                           // ...and never comes back
    expect(takeFullNotes('u1', store)).toEqual([]);
  });
  it('rows the database refuses for their content (23514) stay on the phone, are parked, and the person is told once, with a count (round 9)', async () => {
    const s = new Server(), a = new Phone(), store = mem();
    s.checkIds.add('bad-1'); s.checkIds.add('bad-2');
    a.put('activities', 'bad-1', 1); a.put('activities', 'bad-2', 2); a.put('activities', 'fine', 3);
    const r = await a.syncAs(s, 'u1', 1_000_000);
    expect(r.checkParked).toEqual({ activities: 2 });
    expect(r.full).toBe(false);                                         // not the "no room" note
    expect(a.recs.has('activities/bad-1') && a.recs.has('activities/bad-2')).toBe(true);
    expect(s.rows.has('activities/fine')).toBe(true);
    noteParked('u1', 'hikes', r.checkParked.activities!, store);
    noteParked('u1', 'hikes', 5, store);                                // a later count does not bring the note back
    expect(takeParkedNotes('u1', store)).toEqual(["2 hikes couldn't be saved to your account and are on this phone only."]);
    expect(takeParkedNotes('u1', store)).toEqual([]);
    expect(takeParkedNotes('u2', store)).toEqual([]);                   // per account
    s.pushes.length = 0;
    await a.syncAs(s, 'u1', 1_000_000 + 60_000);
    expect(s.pushes.flatMap((p) => p.ids)).not.toContain('bad-1');     // parked, no retry storm
  });
  it('every note exists in BOTH variants, "this phone" in the apps and "this device" on the web: full and parked, hikes, saved trails and shortlist', () => {
    for (const k of ['hikes', 'saved', 'shortlist'] as const) {
      const fullPhone = fullText(k, false), fullWeb = fullText(k, true);
      expect(fullPhone, k).toContain('this phone only'); expect(fullPhone).not.toContain('device');
      expect(fullWeb, k).toContain('this device only'); expect(fullWeb).not.toContain('phone');
      expect(fullWeb).toBe(fullPhone.replace('this phone', 'this device'));
      for (const n of [1, 2, 7]) {
        const phone = parkedText(k, n, false), web = parkedText(k, n, true);
        expect(phone, `${k} ${n}`).toMatch(/on this phone only\.$/); expect(phone).not.toContain('device');
        expect(web, `${k} ${n}`).toMatch(/on this device only\.$/); expect(web).not.toContain('phone');
        expect(web).toBe(phone.replace('this phone', 'this device'));
        expect(phone).toContain(n === 1 ? ' is on ' : ' are on ');
      }
    }
  });
  it('the stored notes pick the variant for where they run: the apps say phone, the web says device', async () => {
    const mem2 = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
    const platform = await import('../native/platform');
    const run = (name: 'ios' | 'android' | 'web') => {
      const spy = vi.spyOn(platform, 'nativePlatform').mockReturnValue(name);
      try {
        const st = mem2();
        noteAccountFull('u', 'hikes', st); noteAccountFull('u', 'saved', st); noteAccountFull('u', 'shortlist', st);
        noteParked('u', 'hikes', 2, st); noteParked('u', 'saved', 1, st); noteParked('u', 'shortlist', 3, st);
        return [...takeFullNotes('u', st), ...takeParkedNotes('u', st)];
      } finally { spy.mockRestore(); }
    };
    for (const p of ['ios', 'android'] as const) { const n = run(p); expect(n).toHaveLength(6); expect(n.every((x) => x.includes('this phone only') && !x.includes('device'))).toBe(true); }
    const web = run('web'); expect(web).toHaveLength(6); expect(web.every((x) => x.includes('this device only') && !x.includes('phone'))).toBe(true);
  });
  it('the parked-row lines, verbatim, with plural forms, "this device" on the web and "this phone" in the apps', () => {
    expect(parkedText('hikes', 1, true)).toBe("1 hike couldn't be saved to your account and is on this device only.");
    expect(parkedText('hikes', 3, true)).toBe("3 hikes couldn't be saved to your account and are on this device only.");
    expect(parkedText('hikes', 1, false)).toBe("1 hike couldn't be saved to your account and is on this phone only.");
    expect(parkedText('hikes', 3, false)).toBe("3 hikes couldn't be saved to your account and are on this phone only.");
    expect(parkedText('saved', 1, true)).toBe("1 saved trail couldn't be saved to your account and is on this device only.");
    expect(parkedText('saved', 2, false)).toBe("2 saved trails couldn't be saved to your account and are on this phone only.");
    expect(parkedText('shortlist', 1, true)).toBe("1 shortlisted trail couldn't be saved to your account and is on this device only.");
    expect(parkedText('shortlist', 4, false)).toBe("4 shortlisted trails couldn't be saved to your account and are on this phone only.");
  });
  it('the three final lines, verbatim, one per type', () => {
    expect(FULL_NOTE_HIKES).toBe('Your account has no room for more hikes. New hikes are saved on this phone only.');
    expect(FULL_NOTE_SAVED).toBe('Your account has no room for more saved trails. New saved trails stay on this phone only.');
    expect(FULL_NOTE_SHORTLIST).toBe('Your account has no room for more shortlisted trails. New ones stay on this phone only.');
    // On the web the same three lines say "this device" (round 8; wording pending sign-off).
    expect(FULL_NOTE_HIKES_WEB).toBe('Your account has no room for more hikes. New hikes are saved on this device only.');
    expect(FULL_NOTE_SAVED_WEB).toBe('Your account has no room for more saved trails. New saved trails stay on this device only.');
    expect(FULL_NOTE_SHORTLIST_WEB).toBe('Your account has no room for more shortlisted trails. New ones stay on this device only.');
    expect(fullText('hikes', true)).toBe(FULL_NOTE_HIKES_WEB);
    expect(fullText('saved', true)).toBe(FULL_NOTE_SAVED_WEB);
    expect(fullText('shortlist', true)).toBe(FULL_NOTE_SHORTLIST_WEB);
    expect([FULL_NOTE_HIKES_WEB, FULL_NOTE_SAVED_WEB, FULL_NOTE_SHORTLIST_WEB].some((l) => l.includes('phone'))).toBe(false);
    expect(fullText(fullKindOf('activities')!)).toBe(FULL_NOTE_HIKES);
    expect(fullText(fullKindOf('saved')!)).toBe(FULL_NOTE_SAVED);
    expect(fullText(fullKindOf('shortlist')!)).toBe(FULL_NOTE_SHORTLIST);
    expect(fullKindOf('settings')).toBeNull();
  });
  it('only the full types show, each its own line, stacked, never combined, each once', () => {
    const store = mem();
    noteAccountFull('u1', 'shortlist', store);
    expect(takeFullNotes('u1', store)).toEqual([FULL_NOTE_SHORTLIST]);                 // only the full type
    noteAccountFull('u1', 'saved', store); noteAccountFull('u1', 'hikes', store);
    expect(takeFullNotes('u1', store)).toEqual([FULL_NOTE_HIKES, FULL_NOTE_SAVED]);    // two full types: two lines, stacked
    expect(takeFullNotes('u1', store)).toEqual([]);
    const all = mem();
    for (const k of ['shortlist', 'saved', 'hikes'] as const) noteAccountFull('u2', k, all);
    expect(takeFullNotes('u2', all)).toEqual([FULL_NOTE_HIKES, FULL_NOTE_SAVED, FULL_NOTE_SHORTLIST]);
    expect([FULL_NOTE_HIKES, FULL_NOTE_SAVED, FULL_NOTE_SHORTLIST].every((l) => !l.includes('Your account is full'))).toBe(true);   // the old wording is gone
  });
  it('a full shortlist is reported for its own kind and says "shortlisted trails"', async () => {
    const s = new Server(), a = new Phone();
    s.fullIds.add('way/9'); a.put('shortlist', 'way/9', 1);
    const r = await a.syncAs(s, 'u1', 1_000_000);
    expect(r.fullKinds).toEqual(['shortlist']);
    const store = mem(); noteAccountFull('u1', fullKindOf('shortlist')!, store);
    expect(takeFullNotes('u1', store)).toEqual([FULL_NOTE_SHORTLIST]);
  });
  it('the note is kept per account: it shown for one account is still due for another on the same phone', () => {
    const store = mem();
    noteAccountFull('A', 'hikes', store); expect(takeFullNotes('A', store)).toEqual([FULL_NOTE_HIKES]);
    noteAccountFull('B', 'hikes', store); expect(takeFullNotes('B', store)).toEqual([FULL_NOTE_HIKES]);
    expect(takeFullNotes('A', store)).toEqual([]);
    expect(takeFullNotes(null, store)).toEqual([]);
  });
  it('a phone with only unedited settings does not count as holding another account\'s data', async () => {
    const s = new Server(), a = new Phone();
    a.ownerId = 'user-A';
    a.recs.set('settings/settings', { kind: 'settings', id: 'settings', updatedAt: 0, editedAt: 0, deleted: false, payload: {} });   // the default settings record every phone has
    expect((await a.syncAs(s, 'user-B', 10)).ownerMismatch).toBe(false);
    const b = new Phone(); b.ownerId = 'user-A';
    b.recs.set('settings/settings', { kind: 'settings', id: 'settings', updatedAt: 5, editedAt: 5, deleted: false, payload: { units: 'metric' } });   // edited here
    expect((await b.syncAs(s, 'user-B', 10)).ownerMismatch).toBe(true);
  });
});

describe('how the server\'s refusals are read, and how much a pull fetches', () => {
  const failing = (code: string) => ({ schema: () => ({ from: () => ({ upsert: async () => ({ error: { code, message: 'x' } }) }) }) });
  const rec = (id: string): SyncRec => ({ kind: 'shortlist', id, updatedAt: 1, editedAt: 1, deleted: false, payload: { trail: { id }, addedAt: 1 } });
  it('RL003 (account full) and the check/size errors are permanent; RL003 is flagged as "full"; anything else is a passing failure', async () => {
    for (const [code, permanent, full] of [['RL003', true, true], ['23514', true, false], ['22001', true, false], ['57014', false, false], ['40P01', false, false]] as const) {
      const out = await supabaseRemote(failing(code) as never, 'u1', () => false).push('shortlist', [rec('w1')], 0);
      expect(out.failed, code).toEqual([{ id: 'w1', permanent, full, check: code === '23514' }]);   // 23514 (a failed check) is the one that tells the person
    }
  });
  it('hikes are pulled 25 at a time (each can carry up to 1 MB of route), the rest 500', async () => {
    const { pageSize } = await import('./remote');
    expect(pageSize('activities')).toBe(25);
    expect(pageSize('shortlist')).toBe(500);
    expect(pageSize('saved')).toBe(500);
  });
});
