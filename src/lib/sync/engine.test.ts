import { describe, it, expect } from 'vitest';
import { syncOnce, type Cursors, type Remote } from './engine';
import type { LocalSource } from './local';
import { winner, type Kind, type SyncRec } from './merge';
import { activityToRow, fromRow, supabaseRemote, toRow } from './remote';
import type { Activity } from '../store';

// A fake server with the same rules as the SQL: synced_at set on every write, stale writes ignored, future clocks clamped.
class Server {
  rows = new Map<string, SyncRec>(); clock = 10_000_000;
  remote(): Remote {
    return {
      pull: async (kind, since) => [...this.rows.values()].filter((r) => r.kind === kind && r.syncedAt! > since).sort((a, b) => a.syncedAt! - b.syncedAt!),
      push: async (kind, recs) => {
        this.clock++;
        for (const r of recs) {
          const k = kind + '/' + r.id, old = this.rows.get(k);
          if (old && r.updatedAt < old.updatedAt) continue;
          this.rows.set(k, { ...r, updatedAt: Math.min(r.updatedAt, this.clock), syncedAt: this.clock });
        }
      },
    };
  }
}
class Phone implements LocalSource {
  recs = new Map<string, SyncRec>(); cursors = new Map<string, number>();
  cur: Cursors = { get: async (k) => this.cursors.get(k) ?? 0, set: async (k, v) => { this.cursors.set(k, v); } };
  put(kind: Kind, id: string, updatedAt: number, payload: unknown = { n: id }) { this.recs.set(kind + '/' + id, { kind, id, updatedAt, deleted: false, payload }); }
  del(kind: Kind, id: string, updatedAt: number) { this.recs.set(kind + '/' + id, { kind, id, updatedAt, deleted: true, payload: null }); }
  async readAll(kind: Kind) { return [...this.recs.values()].filter((r) => r.kind === kind); }
  async apply(r: SyncRec) { this.recs.set(r.kind + '/' + r.id, { ...r }); }
  live(kind: Kind) { return [...this.recs.values()].filter((r) => r.kind === kind && !r.deleted).map((r) => r.id).sort(); }
  sync(s: Server, user = 'u1') { return syncOnce(user, this, s.remote(), this.cur); }
}

describe('last write wins', () => {
  const r = (updatedAt: number, deleted = false): SyncRec => ({ kind: 'saved', id: 'x', updatedAt, deleted, payload: null });
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

describe('phone only never blanks a route that is already uploaded', () => {
  const act: Activity = { id: 'h1', name: 'Ledge', startedAt: 1_700_000_000_000, endedAt: 1_700_003_600_000, updatedAt: 1_700_003_700_000,
    points: Array.from({ length: 41 }, (_, i) => ({ lon: -121.8, lat: 47.4 + i * 0.00045, alt: 300, acc: 5, t: i * 1000 })) };
  const stub: Activity = { ...act, id: 'h2', points: [], summary: { distanceM: 2000, durationMs: 3_600_000, climbM: 100 } };
  const rec = (a: Activity): SyncRec => ({ kind: 'activities', id: a.id, updatedAt: a.updatedAt!, deleted: false, payload: a });
  it('a phone that holds only the summary leaves the route column alone, and keeps the summary', () => {
    const row = activityToRow('u1', rec(stub), false) as { track?: unknown; stats: { summary: unknown } };
    expect('track' in row).toBe(false);
    expect(row.stats.summary).toEqual(stub.summary);
  });
  it('rows with and without a route are sent in separate requests', async () => {
    const sent: Record<string, unknown>[][] = [];
    const c = { schema: () => ({ from: () => ({ upsert: async (rows: Record<string, unknown>[]) => { sent.push(rows); return { error: null }; } }) }) };
    await supabaseRemote(c as never, 'u1', () => false).push('activities', [rec(act), rec(stub)]);
    expect(sent).toHaveLength(2);
    expect(sent.find((g) => 'track' in g[0])!.map((r) => r.id)).toEqual(['h1']);
    expect(sent.find((g) => !('track' in g[0]))!.map((r) => r.id)).toEqual(['h2']);
  });
  it('turning the setting on changes no hike (nothing is re-stamped, so nothing is re-pushed)', async () => {
    const { updateSettings, SETTINGS_STAMP_KEY } = await import('../settings');
    const mem = new Map<string, string>();
    const real = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } }, configurable: true });
    try { updateSettings({ keepTracksLocal: true }); expect(mem.has(SETTINGS_STAMP_KEY)).toBe(false); }
    finally { Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true }); }
  });
  it('a summary-only hike round-trips through a server row', () => {
    const row = { ...activityToRow('u1', rec(act), true), synced_at: '2026-11-07T10:00:00.000Z' };
    const a = fromRow('activities', row)!.payload as Activity;
    expect(a.points).toEqual([]);
    expect(a.summary).toMatchObject({ durationMs: 3_600_000 });
  });
});

describe('pull overlap', () => {
  it('catches a row that was committed late, with a synced_at older than one the phone already saw', async () => {
    const s = new Server(), a = new Phone(), b = new Phone();
    a.put('shortlist', 'way/1', 10);
    await a.sync(s); await b.sync(s);                       // B's cursor is now at the first row's synced_at
    const cursorBefore = [...b.cursors.values()].find((v) => v > 0)!;
    // A row from another device shows up with a synced_at slightly BEHIND B's cursor (commit order differs from clock order).
    s.rows.set('shortlist/way/2', { kind: 'shortlist', id: 'way/2', updatedAt: 20, deleted: false, payload: { n: 'way/2' }, syncedAt: cursorBefore - 5 });
    s.rows.set('shortlist/way/3', { kind: 'shortlist', id: 'way/3', updatedAt: 21, deleted: false, payload: { n: 'way/3' }, syncedAt: cursorBefore + 5 });
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
  const rec = (a: Activity): SyncRec => ({ kind: 'activities', id: a.id, updatedAt: a.updatedAt!, deleted: false, payload: a });

  it('the route is trimmed before upload', () => {
    const row = activityToRow('u1', rec(act), false) as { track: unknown[] };
    expect(row.track.length).toBeGreaterThan(0);
    expect(row.track.length).toBeLessThan(act.points.length);
  });
  it('"keep tracks on this phone only" sends no route column at all (so a route already on the server is not blanked), but still the hike summary', () => {
    const row = activityToRow('u1', rec(act), true) as { track?: unknown; stats: Record<string, unknown>; trail_id: string };
    expect('track' in row).toBe(false);
    expect(row.stats).toMatchObject({ name: 'Rattlesnake Ledge', withDog: true, pausedMs: 5000 });
    expect(row.stats.summary).toMatchObject({ distanceM: expect.any(Number), durationMs: 3_600_000, climbM: expect.any(Number) });
    expect(row.trail_id).toBe('way/1');
  });
  it('carries no name, email or user fields besides user_id, and the server never sees the raw points object', () => {
    const row = activityToRow('u1', rec(act), false);
    expect(Object.keys(row).sort()).toEqual(['id', 'started_at', 'stats', 'track', 'trail_id', 'updated_at', 'deleted', 'user_id'].sort());
    expect(Object.keys(row.stats as object)).not.toEqual(expect.arrayContaining(['calories', 'heartRate']));
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
    const t = toRow('u1', { kind: 'shortlist', id: 'way/9', updatedAt: 5, deleted: true, payload: null }, false);
    expect(t).toMatchObject({ trail_id: 'way/9', trail: null, deleted: true });
    expect(fromRow('activities', { id: 'x', updated_at: 'nonsense', synced_at: 'nonsense' })).toBeNull();
    expect(fromRow('activities', { id: 'x', updated_at: '2026-01-01T00:00:00Z', synced_at: '2026-01-01T00:00:00Z', stats: {}, started_at: '2026-01-01T00:00:00Z', track: [{ lon: 'bad' }] })).toBeNull();
  });
});
