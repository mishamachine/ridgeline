import { describe, it, expect } from 'vitest';
import { supabaseRemote } from './remote';

type R = Record<string, unknown>;
const T = '2026-11-10T10:00:00.123456+00:00';

/** A fake of the PostgREST query builder that understands what pull uses: gt, or(gt/eq keyset), order (two columns), limit. It records every request. */
function fake(rows: R[], keyCol: string, log: string[] = []) {
  const q = {
    _gt: null as string | null, _or: null as string | null,
    select() { return q; },
    gt(_c: string, v: string) { q._gt = v; return q; },
    or(expr: string) { q._or = expr; return q; },
    order() { return q; },
    limit(n: number) {
      log.push(q._or ?? 'gt:' + q._gt);
      if (log.length > 200) throw new Error('INFINITE LOOP: ' + log.length + ' page requests');
      let d = [...rows];
      if (q._gt !== null) d = d.filter((r) => Date.parse(String(r.synced_at)) > Date.parse(q._gt!));
      if (q._or !== null) {
        const m = /^synced_at\.gt\."(.*?)",and\(synced_at\.eq\."(.*?)",(\w+)\.gt\."(.*)"\)$/.exec(q._or);
        if (!m) throw new Error('unexpected filter ' + q._or);
        expect(m[3]).toBe(keyCol);
        d = d.filter((r) => String(r.synced_at) > m[1] || (String(r.synced_at) === m[2] && String(r[keyCol]) > m[4]));
      }
      d.sort((a, b) => String(a.synced_at).localeCompare(String(b.synced_at)) || String(a[keyCol]).localeCompare(String(b[keyCol])));
      q._gt = null; q._or = null;
      return Promise.resolve({ data: d.slice(0, n), error: null });
    },
  };
  const c = { schema: () => ({ from: () => q }) } as never;
  return supabaseRemote(c, 'u', () => false);
}
const hike = (i: number, at = T): R => ({ user_id: 'u', id: 'h' + String(i).padStart(3, '0'), started_at: at, stats: { name: 'x', endedAt: 1 }, track: null, updated_at: at, synced_at: at, deleted: false, epoch: 0, trail_id: null });

describe('pull pages by (synced_at, key), so rows that share one synced_at cannot loop', () => {
  it('25 hikes from one upsert (the page size) end after two requests', async () => {
    const log: string[] = [];
    const out = await fake(Array.from({ length: 25 }, (_, i) => hike(i)), 'id', log).pull('activities', 0);
    expect(out).toHaveLength(25);
    expect(log).toHaveLength(2);
  });
  it('60 hikes sharing one synced_at all arrive, once each, in 3 requests', async () => {
    const log: string[] = [];
    const out = await fake(Array.from({ length: 60 }, (_, i) => hike(i)), 'id', log).pull('activities', 0);
    expect(new Set(out.map((r) => r.id)).size).toBe(60);
    expect(out).toHaveLength(60);
    expect(log).toHaveLength(3);
  });
  it('the next page carries the RAW microsecond synced_at, not a millisecond date', async () => {
    const log: string[] = [];
    await fake(Array.from({ length: 30 }, (_, i) => hike(i)), 'id', log).pull('activities', 0);
    expect(log[1]).toBe(`synced_at.gt."${T}",and(synced_at.eq."${T}",id.gt."h024")`);
    expect(log[1]).toContain('.123456+00:00');
  });
  it('a mix of timestamps (some shared, some not) arrives complete, with no repeats', async () => {
    const rows = [
      ...Array.from({ length: 30 }, (_, i) => hike(i, '2026-11-10T10:00:00.000001+00:00')),
      ...Array.from({ length: 30 }, (_, i) => hike(100 + i, '2026-11-10T10:00:00.000002+00:00')),
      hike(900, '2026-11-10T10:00:05.5+00:00'),
    ];
    const out = await fake(rows, 'id').pull('activities', 0);
    expect(out).toHaveLength(61);
  });
  it('saved trails page on trail_id (with commas, quotes and parentheses in the id safely quoted)', async () => {
    const odd = ['way/1,2', 'a"b', 'c)d', 'e\\f'];
    const rows = Array.from({ length: 1200 }, (_, i) => ({ user_id: 'u', trail_id: (odd[i] ?? '') + 'w' + String(i).padStart(5, '0'), trail: { name: 't' }, added_at: T, updated_at: T, synced_at: T, deleted: false, epoch: 0 }));
    const log: string[] = [];
    const out = await fake(rows, 'trail_id', log).pull('saved', 0);
    expect(out).toHaveLength(1200);
    expect(log).toHaveLength(3);
  });
  it('a server that keeps returning the same full page makes pull stop with an error, not loop', async () => {
    const same = Array.from({ length: 25 }, (_, i) => hike(i));
    const c = { schema: () => ({ from: () => { const q: Record<string, unknown> = {}; for (const m of ['select', 'gt', 'or', 'order']) q[m] = () => q; q.limit = () => Promise.resolve({ data: same, error: null }); return q; } }) } as never;
    await expect(supabaseRemote(c, 'u', () => false).pull('activities', 0)).rejects.toThrow(/added no new rows/);
  });
  it('54000 and RL003 are permanent refusals', async () => {
    const { PERMANENT } = await import('./remote');
    expect(PERMANENT.has('54000') && PERMANENT.has('RL003')).toBe(true);
  });
});

import { cleanJson, toRow } from './remote';
describe('float residue is cleaned before upload (the database refuses |x| < 1e-12 and a refused hike would park for good)', () => {
  it('cleanJson: tiny becomes 0, non-finite is dropped, normal values are untouched', () => {
    expect(cleanJson({ a: 1e-13, b: -1e-13, c: NaN, d: Infinity, e: 0, f: 37.7749295, g: [1e-20, NaN, 5, { h: 1e-15, i: -Infinity }], s: 'x', n: null }))
      .toEqual({ a: 0, b: 0, e: 0, f: 37.7749295, g: [0, null, 5, { h: 0 }], s: 'x', n: null });
    expect(cleanJson(1e-12)).toBe(1e-12);
  });
  it('a hike with 1e-13 in its route and stats uploads as 0', () => {
    const points = Array.from({ length: 120 }, (_, i) => ({ lon: -122.4, lat: 37.7 + i * 0.0001, alt: i === 60 ? 1e-13 : i === 61 ? NaN : 100, acc: 4.5, t: 1762800000000 + i * 5000 }));
    const payload = { id: 'h1', name: 'x', startedAt: 1762800000000, updatedAt: 1, pausedMs: 1e-13, points };
    const row = toRow('u', { kind: 'activities', id: 'h1', updatedAt: 1, syncedAt: 0, editedAt: 1, deleted: false, payload } as never, false) as { stats: Record<string, unknown>; track: Array<Record<string, unknown>> };
    expect(row.stats.pausedMs).toBe(0);
    expect(JSON.stringify(row.track)).not.toContain('e-13');
    expect(row.track.some((p) => p.alt === 0)).toBe(true);
    expect(row.track.every((p) => p.alt === undefined || Number.isFinite(p.alt as number))).toBe(true);
  });
  it('saved trails, shortlist and settings are cleaned too', () => {
    const t = (kind: 'saved' | 'shortlist') => toRow('u', { kind, id: 'w1', updatedAt: 1, syncedAt: 0, editedAt: 1, deleted: false, payload: { trail: { len: 1e-13 }, addedAt: 1 } } as never, false) as { trail: { len: number } };
    expect(t('saved').trail.len).toBe(0); expect(t('shortlist').trail.len).toBe(0);
    expect((toRow('u', { kind: 'settings', id: 'settings', updatedAt: 1, syncedAt: 0, editedAt: 1, deleted: false, payload: { z: 1e-13 } } as never, false) as { data: { z: number } }).data.z).toBe(0);
  });
});
