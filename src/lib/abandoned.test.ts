import { describe, it, expect, vi } from 'vitest';

const db = new Map<string, unknown>();
vi.mock('./store', () => ({
  listActivities: async () => [...db.values()],
  putActivity: async (a: { id: string }) => { db.set(a.id, a); },
}));

import { STALE_MS, closeAbandoned, resumable, sealIfAbandoned } from './abandoned';
import { hikeTotals } from './badges';
import { makeBackup, parseBackup } from './backup';
import { DEFAULT_SETTINGS } from './settings';
import type { Activity } from './store';

const NOW = Date.UTC(2026, 10, 6, 18, 0);
const mk = (id: string, lastAgoMs: number, extra: Partial<Activity> = {}): Activity => {
  const last = NOW - lastAgoMs;
  return { id, name: 'Rattlesnake Ledge', trailId: 'osm-w1', startedAt: last - 600_000, ...extra,
    points: [{ lon: -121.77, lat: 47.43, alt: 200, acc: 5, t: last - 600_000 }, { lon: -121.77, lat: 47.4375, alt: 260, acc: 5, t: last }] };
};

describe('abandoned hikes', () => {
  it('closes a hike with no end whose last point is over 6 h old', () => {
    const a = mk('a', STALE_MS + 1);
    expect(sealIfAbandoned(a, NOW)).toMatchObject({ endedAt: a.points[1].t, unfinished: true });
  });
  it('leaves recent, finished and empty hikes alone', () => {
    expect(sealIfAbandoned(mk('b', STALE_MS - 1000), NOW)).toBeNull();
    expect(sealIfAbandoned(mk('c', STALE_MS + 1, { endedAt: 5 }), NOW)).toBeNull();
    expect(sealIfAbandoned({ ...mk('d', 0), points: [] }, NOW)).toBeNull();
  });
  it('offers to resume only an open trail hike under 6 h old, newest first', () => {
    const list = [mk('old', STALE_MS + 1), mk('new', 3600_000), mk('newer', 600_000), mk('done', 1000, { endedAt: 1 }), mk('free', 1000, { trailId: undefined })];
    expect(resumable(list, NOW)?.id).toBe('newer');
    expect(resumable([mk('old', STALE_MS + 1)], NOW)).toBeNull();
  });
  it('app start writes the sealed hikes and keeps the rest as they were', async () => {
    db.clear();
    db.set('old', mk('old', STALE_MS + 5));
    db.set('live', mk('live', 60_000));
    const out = await closeAbandoned(NOW);
    expect((db.get('old') as Activity).unfinished).toBe(true);
    expect((db.get('live') as Activity).endedAt).toBeUndefined();
    expect(out.map((a) => a.id).sort()).toEqual(['live', 'old']);
  });
  it('totals count only the distance actually walked; an unfinished hike has no trail climb', () => {
    const a = sealIfAbandoned(mk('x', STALE_MS + 1), NOW)!;
    const t = hikeTotals([a], []);
    expect(t.hikes).toBe(1);
    expect(t.distanceM).toBeGreaterThan(700);
    expect(t.distanceM).toBeLessThan(900);
  });
  it('survives a backup round trip', () => {
    const a = sealIfAbandoned(mk('x', STALE_MS + 1), NOW)!;
    const r = parseBackup(JSON.stringify(makeBackup([], [a], DEFAULT_SETTINGS, 1)));
    if (!r.ok) throw new Error(r.error);
    expect(r.backup.activities[0].unfinished).toBe(true);
    expect(parseBackup(JSON.stringify({ ...makeBackup([], [a], DEFAULT_SETTINGS, 1), activities: [{ ...a, unfinished: 'yes' }] })).ok).toBe(false);
  });
});
