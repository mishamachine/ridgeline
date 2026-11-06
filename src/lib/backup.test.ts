import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = { saved: new Map<string, unknown>(), acts: new Map<string, unknown>() };
vi.mock('./store', () => ({
  getSaved: async (id: string) => db.saved.get(id),
  putSaved: async (s: { trail: { id: string } }) => { db.saved.set(s.trail.id, s); },
  putActivity: async (a: { id: string }) => { db.acts.set(a.id, a); },
  listSaved: async () => [...db.saved.values()],
  listActivities: async () => [...db.acts.values()],
}));

import { makeBackup, parseBackup, restoreBackup, BACKUP_VERSION } from './backup';
import { DEFAULT_SETTINGS, getSettings } from './settings';

const trail = { id: 'way/1', name: 'Rattlesnake Ledge', coords: [[-121.8, 47.4], [-121.79, 47.41]], lengthM: 1500, loop: false, partial: false, osmUrl: 'https://www.openstreetmap.org/way/1', tags: { name: 'Rattlesnake Ledge' } };
const saved = { trail, savedAt: 1, tileKeys: ['k1', 'k2'], bytes: 1000 };
const act = { id: '1', name: 'Hike', startedAt: 1000, endedAt: 2000, points: [{ lon: -121.8, lat: 47.4, alt: 300, acc: 5, t: 1000 }, { lon: -121.79, lat: 47.41, alt: null, acc: 5, t: 2000 }] };

beforeEach(() => { db.saved.clear(); db.acts.clear(); });

describe('backup file', () => {
  const text = (o: unknown) => JSON.stringify(o);
  const good = () => makeBackup([saved as never], [act as never], DEFAULT_SETTINGS, 5);

  it('round-trips through JSON', () => {
    const r = parseBackup(text(good()));
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(r.backup.version).toBe(BACKUP_VERSION);
      expect(r.backup.activities).toHaveLength(1);
      expect(r.backup.saved[0].trail.id).toBe('way/1');
    }
  });
  it('rejects non-JSON, other apps, newer versions and missing arrays', () => {
    expect(parseBackup('nope')).toMatchObject({ ok: false });
    expect(parseBackup(text({ app: 'other', version: 1 }))).toMatchObject({ ok: false });
    expect(parseBackup(text({ ...good(), version: 99 }))).toMatchObject({ ok: false, error: expect.stringContaining('newer') });
    expect(parseBackup(text({ ...good(), activities: undefined }))).toMatchObject({ ok: false });
  });
  it('rejects damaged hikes and trails without restoring any', () => {
    expect(parseBackup(text({ ...good(), activities: [{ ...act, points: [{ lon: 'x' }] }] }))).toMatchObject({ ok: false });
    expect(parseBackup(text({ ...good(), activities: [{ ...act, id: '' }] }))).toMatchObject({ ok: false });
    expect(parseBackup(text({ ...good(), saved: [{ ...saved, trail: { ...trail, coords: [['a']] } }] }))).toMatchObject({ ok: false });
  });
  it('cleans bad settings values back to defaults', () => {
    const r = parseBackup(text({ ...good(), settings: { units: 'furlongs', voice: 'yes', onboardingSeen: true } }));
    expect(r.ok && r.backup.settings).toEqual({ ...DEFAULT_SETTINGS, onboardingSeen: true });
  });
});

describe('restore', () => {
  it('writes hikes and trail routes (without map tiles) and settings', async () => {
    const r = parseBackup(JSON.stringify(makeBackup([saved as never], [act as never], { ...DEFAULT_SETTINGS, units: 'metric' })));
    if (!r.ok) throw new Error('parse');
    await restoreBackup(r.backup);
    expect(db.acts.get('1')).toEqual(act);
    expect(db.saved.get('way/1')).toMatchObject({ tileKeys: [], bytes: 0 });
    expect(getSettings().units).toBe('metric');
  });
  it('keeps the offline maps of a trail already saved on this phone', async () => {
    db.saved.set('way/1', saved);
    const r = parseBackup(JSON.stringify(makeBackup([saved as never], [], DEFAULT_SETTINGS)));
    if (!r.ok) throw new Error('parse');
    await restoreBackup(r.backup);
    expect(db.saved.get('way/1')).toBe(saved);
  });
});
