import { describe, it, expect, vi, beforeEach } from 'vitest';

const mem = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: async (k: string) => mem.get(k),
  set: async (k: string, v: unknown) => { mem.set(k, v); },
  del: async (k: string) => { mem.delete(k); },
  keys: async () => [...mem.keys()],
  getMany: async (ks: string[]) => ks.map((k) => mem.get(k)),
}));
const flags = vi.hoisted(() => ({ accounts: false }));
vi.mock('./features', () => ({ features: flags }));

import { Activity, SavedTrail, deleteActivity, deleteSaved, deleteShortlisted, listTombstones, nextEditStamp, pruneTombstones, putActivity, putShortlisted, restoreActivity, restoreSaved, restoreShortlisted, clearTombstones, TOMBSTONE_MAX_AGE_MS } from './store';
import { cleanActivity } from './backup';
import type { Trail } from './trails';

const trail = { id: 'way/1', name: 'Ledge', coords: [], lengthM: 1, loop: false, partial: false, osmUrl: '', tags: {} } as unknown as Trail;
const act = (over: Partial<Activity> = {}): Activity => ({ id: 'h1', name: 'Hike', startedAt: 1_000, endedAt: 2_000, points: [], ...over });

beforeEach(() => { mem.clear(); flags.accounts = false; });

describe('restoring a backup keeps the original time', () => {
  it('a hike keeps its updatedAt, but counts as an edit made here (so it uploads)', async () => {
    await putActivity(act({ id: 'other' }));
    const before = (mem.get('act:other') as Activity).editedAt!;
    await restoreActivity(act({ updatedAt: 1_700_000_000_000 }));
    const r = mem.get('act:h1') as Activity;
    expect(r.updatedAt).toBe(1_700_000_000_000);
    expect(r.editedAt!).toBeGreaterThan(before);
  });
  it('a saved trail and a bookmark keep theirs too', async () => {
    await restoreSaved({ trail, savedAt: 5, tileKeys: [], bytes: 0, updatedAt: 99 } as SavedTrail);
    expect((mem.get('trail:way/1') as SavedTrail).updatedAt).toBe(99);
    await restoreShortlisted({ trail, addedAt: 7, updatedAt: 55 });
    expect((mem.get('sl:way/1') as { updatedAt: number }).updatedAt).toBe(55);
    await restoreShortlisted({ trail: { ...trail, id: 'way/2' }, addedAt: 7 });
    expect((mem.get('sl:way/2') as { updatedAt: number }).updatedAt).toBe(7);   // no updatedAt in an old backup: the add date
  });
  it('a normal save still stamps now', async () => {
    const t0 = Date.now();
    await putActivity(act());
    expect((mem.get('act:h1') as Activity).updatedAt!).toBeGreaterThanOrEqual(t0);
  });
  it('the backup file round-trips updatedAt', () => {
    expect(cleanActivity({ id: 'h1', name: 'x', startedAt: 1, points: [], updatedAt: 1234 })!.updatedAt).toBe(1234);
  });
});

describe('local edit stamps', () => {
  it('rise on every call, even within one millisecond', async () => {
    const a = await nextEditStamp(), b = await nextEditStamp(), c = await nextEditStamp();
    expect(b).toBeGreaterThan(a); expect(c).toBeGreaterThan(b);
  });
});

describe('tombstones', () => {
  it('are not kept at all while accounts are off', async () => {
    await putShortlisted(trail);
    await deleteShortlisted('way/1'); await deleteActivity('h1'); await deleteSaved('way/1');
    expect(await listTombstones()).toEqual([]);
  });
  it('are kept when accounts are on, and old ones are pruned', async () => {
    flags.accounts = true;
    await deleteShortlisted('way/1');
    expect(await listTombstones()).toHaveLength(1);
    const later = Date.now() + TOMBSTONE_MAX_AGE_MS + 1000;
    await pruneTombstones(later);
    expect(await listTombstones()).toEqual([]);
  });
  it('leftovers from before are cleared when accounts are off', async () => {
    flags.accounts = true; await deleteShortlisted('way/1'); flags.accounts = false;
    await clearTombstones();
    expect(await listTombstones()).toEqual([]);
  });
});
