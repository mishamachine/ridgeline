import { describe, it, expect } from 'vitest';
import { StaleEpochError, syncOnce, type Cursors, type Remote, type SyncOptions } from './engine';
import { syncGate } from './gate';
import { fitTrack, MAX_UPLOAD_POINTS } from './trim';
import type { LocalSource } from './local';
import { winner, type Kind, type SyncRec } from './merge';
import { activityToRow, fromRow, toRow } from './remote';
import type { Activity } from '../store';

// A fake server with the same rules as the SQL: synced_at set on every write, stale writes ignored, future clocks clamped,
// writes tagged with an old data epoch refused, and delete_user_data (wipe everything, epoch + 1).
class Server {
  rows = new Map<string, SyncRec>(); clock = 10_000_000; dataEpoch = 0;
  rejectIds = new Set<string>();          // rows the database refuses (a constraint violation)
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
        const failed: string[] = [];
        for (const r of recs) {
          if (this.rejectIds.has(r.id)) { failed.push(r.id); continue; }
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
  recs = new Map<string, SyncRec>(); cursors = new Map<string, number>();
  cur: Cursors = { get: async (k) => this.cursors.get(k) ?? 0, set: async (k, v) => { this.cursors.set(k, v); } };
  seq = 0; // the local edit stamp: rises on edits made on this phone only
  put(kind: Kind, id: string, updatedAt: number, payload: unknown = { n: id }) { this.recs.set(kind + '/' + id, { kind, id, updatedAt, editedAt: ++this.seq, deleted: false, payload }); }
  del(kind: Kind, id: string, updatedAt: number) { this.recs.set(kind + '/' + id, { kind, id, updatedAt, editedAt: ++this.seq, deleted: true, payload: null }); }
  async readAll(kind: Kind) { return [...this.recs.values()].filter((r) => r.kind === kind); }
  async apply(r: SyncRec) { this.recs.set(r.kind + '/' + r.id, { ...r, editedAt: 0 }); } // a record taken from the server was not edited here
  async wipe() { this.recs.clear(); this.cursors.clear(); }
  live(kind: Kind) { return [...this.recs.values()].filter((r) => r.kind === kind && !r.deleted).map((r) => r.id).sort(); }
  syncFull(s: Server, user = 'u1', opts?: SyncOptions) { return syncOnce(user, this, s.remote(), this.cur, opts); }
  async sync(s: Server, user = 'u1') { const r = await this.syncFull(s, user); return { pulled: r.pulled, pushed: r.pushed }; }
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
  it('the other rows go through, the bad one is retried next pass, and later edits still upload', async () => {
    const s = new Server(), a = new Phone();
    a.put('activities', 'ok1', 1); a.put('activities', 'bad', 2); a.put('activities', 'ok2', 3);
    s.rejectIds.add('bad');
    const first = await a.syncFull(s);
    expect(first).toMatchObject({ pushed: 2, failed: 1 });
    expect([...s.rows.keys()].sort()).toEqual(['activities/ok1', 'activities/ok2']);
    a.put('activities', 'ok3', 4);
    const second = await a.syncFull(s);
    expect(second.failed).toBe(1);                                  // still refused, still retried
    expect(s.rows.has('activities/ok3')).toBe(true);                // but the new edit went through
    s.rejectIds.clear();
    const third = await a.syncFull(s);
    expect(third.failed).toBe(0);
    expect(s.rows.has('activities/bad')).toBe(true);
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
