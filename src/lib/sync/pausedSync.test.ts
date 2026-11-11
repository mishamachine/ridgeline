import { describe, it, expect, vi, beforeEach } from 'vitest';

const flags = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock('../features', () => ({ features: { accounts: true } }));
const getClientMock = vi.hoisted(() => vi.fn(() => null));
vi.mock('../accounts/client', () => ({ getClient: getClientMock }));
vi.mock('idb-keyval', () => ({ get: async () => 0, set: async () => {}, del: async () => {}, keys: async () => [], getMany: async () => [] }));

import { runSync } from './useSync';
import { FLAGS_KEY } from '../accounts/flags';
import { StaleEpochError, PausedError, syncOnce, type Cursors, type Remote } from './engine';
import type { LocalSource } from './local';
import type { Kind, SyncRec } from './merge';

beforeEach(() => {
  flags.store.clear(); getClientMock.mockClear();
  vi.stubGlobal('localStorage', { getItem: (k: string) => flags.store.get(k) ?? null, setItem: (k: string, v: string) => { flags.store.set(k, v); }, removeItem: (k: string) => { flags.store.delete(k); } });
});
const setFlag = (accounts: boolean) => flags.store.set(FLAGS_KEY, JSON.stringify({ accounts, at: 1, tried: 1 }));

describe('runSync honours the pause switch', () => {
  it('paused: no client, no network, nothing happens', async () => {
    setFlag(false);
    expect(await runSync('u1')).toEqual({ pulled: 0, deletedElsewhere: false });
    expect(getClientMock).not.toHaveBeenCalled();
  });
  it('flag not read yet (new install): also nothing', async () => {
    await runSync('u1');
    expect(getClientMock).not.toHaveBeenCalled();
  });
  it('live: the pass starts', async () => {
    setFlag(true);
    await runSync('u1');
    expect(getClientMock).toHaveBeenCalled();
  });
});

describe('resume after a pause: nothing is lost', () => {
  const server = new Map<string, SyncRec>();
  let paused = false;
  const remote: Remote = {
    epoch: async () => 0,
    pull: async () => [],
    push: async (kind, recs) => { if (paused) throw new PausedError(); for (const r of recs) server.set(kind + '/' + r.id, r); return { failed: [] }; },
  };
  const recs = new Map<string, SyncRec>(); const cursors = new Map<string, number>();
  const cur: Cursors = { get: async (k) => cursors.get(k) ?? 0, set: async (k, v) => { cursors.set(k, v); } };
  let seq = 0;
  const local: LocalSource = {
    wipe: async () => {}, apply: async () => {},
    readAll: async (kind: Kind) => [...recs.values()].filter((r) => r.kind === kind),
  };
  const edit = (id: string) => recs.set('shortlist/' + id, { kind: 'shortlist', id, updatedAt: ++seq, editedAt: ++seq, deleted: false, payload: { id } });

  it('edits made while paused (and a push the server refused) are all uploaded once sync resumes, and the local copy was never touched', async () => {
    edit('before'); await syncOnce('u1', local, remote, cur);
    paused = true;
    edit('during-1'); edit('during-2');
    await expect(syncOnce('u1', local, remote, cur)).rejects.toBeInstanceOf(PausedError);   // an old client that still tries is refused
    expect(recs.size).toBe(3);                                                                // the phone keeps everything
    expect(server.has('shortlist/during-1')).toBe(false);
    paused = false;
    const r = await syncOnce('u1', local, remote, cur);
    expect(r.pushed).toBe(2);
    expect([...server.keys()].sort()).toEqual(['shortlist/before', 'shortlist/during-1', 'shortlist/during-2']);
    expect(StaleEpochError).toBeDefined();
  });
});
