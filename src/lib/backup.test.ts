import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = { saved: new Map<string, unknown>(), acts: new Map<string, unknown>(), sl: new Map<string, unknown>() };
vi.mock('./store', () => ({
  getSaved: async (id: string) => db.saved.get(id),
  putSaved: async (s: { trail: { id: string } }) => { db.saved.set(s.trail.id, s); },
  putActivity: async (a: { id: string }) => { db.acts.set(a.id, a); },
  getShortlisted: async (id: string) => db.sl.get(id),
  restoreShortlisted: async (m: { trail: { id: string } }) => { db.sl.set(m.trail.id, m); },
  listShortlisted: async () => [...db.sl.values()],
  listSaved: async () => [...db.saved.values()],
  listActivities: async () => [...db.acts.values()],
}));

import { makeBackup, parseBackup, restoreBackup, BACKUP_VERSION, MAX_BACKUP_BYTES, MAX_HIKES, MAX_SAVED, MAX_POINTS } from './backup';
import { DEFAULT_SETTINGS, getSettings } from './settings';
import type { Trail } from './trails';

const trail = { id: 'way/1', name: 'Rattlesnake Ledge', coords: [[-121.8, 47.4], [-121.79, 47.41]], lengthM: 1500, loop: false, partial: false, osmUrl: 'https://www.openstreetmap.org/way/1', tags: { name: 'Rattlesnake Ledge' } };
const saved = { trail, savedAt: 1, tileKeys: ['k1', 'k2'], bytes: 1000 };
const act = { id: '1', name: 'Hike', startedAt: 1000, endedAt: 2000, points: [{ lon: -121.8, lat: 47.4, alt: 300, acc: 5, t: 1000 }, { lon: -121.79, lat: 47.41, alt: null, acc: 5, t: 2000 }] };

beforeEach(() => { db.saved.clear(); db.acts.clear(); db.sl.clear(); });

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

describe('crafted files', () => {
  const good = () => makeBackup([saved as never], [act as never], DEFAULT_SETTINGS, 5);
  const bad = (o: unknown) => parseBackup(JSON.stringify(o));
  it('drops unknown keys from trails and hikes', () => {
    const r = bad({ ...good(), saved: [{ ...saved, evil: 1, trail: { ...trail, evil: { x: 1 }, __proto__: { polluted: true } } }], activities: [{ ...act, extra: 'x', points: [{ ...act.points[0], extra: 1 }, act.points[1]] }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.backup.saved[0].trail).sort()).toEqual(['coords', 'id', 'lengthM', 'loop', 'name', 'osmUrl', 'partial', 'tags']);
    expect(Object.keys(r.backup.saved[0]).sort()).toEqual(['bytes', 'savedAt', 'tileKeys', 'trail']);
    expect(Object.keys(r.backup.activities[0]).sort()).toEqual(['endedAt', 'id', 'name', 'points', 'startedAt']);
    expect(Object.keys(r.backup.activities[0].points[0]).sort()).toEqual(['acc', 'alt', 'lat', 'lon', 't']);
  });
  it('rejects tags that are not strings, __proto__ tags are not kept', () => {
    expect(bad({ ...good(), saved: [{ ...saved, trail: { ...trail, tags: { a: 1 } } }] }).ok).toBe(false);
    expect(bad({ ...good(), saved: [{ ...saved, trail: { ...trail, tags: [] } }] }).ok).toBe(false);
    const r = JSON.parse(JSON.stringify(good()));
    r.saved[0].trail.tags = JSON.parse('{"__proto__":"x","name":"y"}');
    const p = bad(r);
    expect(p.ok && Object.keys(p.backup.saved[0].trail.tags)).toEqual(['name']);
  });
  it('osmUrl must be an openstreetmap.org link', () => {
    for (const u of ['javascript:alert(1)', 'https://evil.example/way/1', 'http://www.openstreetmap.org/way/1', 5])
      expect(bad({ ...good(), saved: [{ ...saved, trail: { ...trail, osmUrl: u } }] }).ok).toBe(false);
  });
  it('elevation and ascent must be numbers; flags must be booleans', () => {
    expect(bad({ ...good(), saved: [{ ...saved, trail: { ...trail, elevation: [1, 'x'] } }] }).ok).toBe(false);
    expect(bad({ ...good(), saved: [{ ...saved, trail: { ...trail, ascentM: '3' } }] }).ok).toBe(false);
    expect(bad({ ...good(), saved: [{ ...saved, trail: { ...trail, loop: 'yes' } }] }).ok).toBe(false);
    expect(bad({ ...good(), activities: [{ ...act, withDog: 'true' }] }).ok).toBe(false);
    expect(bad({ ...good(), activities: [{ ...act, rain: 1 }] }).ok).toBe(false);
    const ok = bad({ ...good(), saved: [{ ...saved, trail: { ...trail, elevation: [1, 2], ascentM: 5, descentM: 4 } }], activities: [{ ...act, withDog: true, rain: false }] });
    expect(ok.ok && ok.backup.saved[0].trail.ascentM).toBe(5);
  });
  it('keeps and cleans a hike snapshot, rejects a malformed one', () => {
    const snap = { name: 'X', coverage: 3, ascentM: 10, highlights: ['lake'], junk: 1 };
    const r = bad({ ...good(), activities: [{ ...act, snapshot: snap }] });
    expect(r.ok && r.backup.activities[0].snapshot).toEqual({ name: 'X', coverage: 1, ascentM: 10, highlights: ['lake'] });
    expect(bad({ ...good(), activities: [{ ...act, snapshot: { name: 1, coverage: 1 } }] }).ok).toBe(false);
    expect(bad({ ...good(), activities: [{ ...act, snapshot: { name: 'x', coverage: 1, highlights: [1] } }] }).ok).toBe(false);
  });
  it('enforces size and count caps', () => {
    expect(parseBackup(' '.repeat(MAX_BACKUP_BYTES + 1)).ok).toBe(false);
    expect(bad({ ...good(), activities: Array(MAX_HIKES + 1).fill(act) }).ok).toBe(false);
    expect(bad({ ...good(), saved: Array(MAX_SAVED + 1).fill(saved) }).ok).toBe(false);
    expect(bad({ ...good(), activities: [{ ...act, points: Array(MAX_POINTS + 1).fill(act.points[0]) }] }).ok).toBe(false);
    expect(bad({ ...good(), activities: Array(MAX_HIKES).fill(act) }).ok).toBe(true);
  });
  it('rejects arrays or null where objects belong', () => {
    expect(bad([]).ok).toBe(false);
    expect(bad(null).ok).toBe(false);
    expect(bad({ ...good(), activities: [null] }).ok).toBe(false);
    expect(bad({ ...good(), saved: [{ ...saved, trail: null }] }).ok).toBe(false);
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

describe('shortlist and richer trail fields', () => {
  const rich = { ...trail, id: 'osm-w9', highlights: ['view', 'lake?'], trailhead: [-121.81, 47.39], trailheadIsParking: true, junctions: [{ along: 400, branches: [{ name: 'Ledge spur', point: [-121.8, 47.405] }, { point: [-121.79, 47.4] }] }] } as unknown as Trail;
  const mark = { trail: rich, addedAt: 77 };
  const parse = (o: unknown) => parseBackup(JSON.stringify(o));

  it('round-trips highlights, trailhead, trailheadIsParking and junctions, on saved trails and bookmarks', () => {
    const r = parse(makeBackup([{ ...saved, trail: rich } as never], [], DEFAULT_SETTINGS, 5, [mark]));
    if (!r.ok) throw new Error(r.error);
    for (const t of [r.backup.saved[0].trail, r.backup.shortlist[0].trail]) {
      expect(t.highlights).toEqual(['view', 'lake?']);
      expect(t.trailhead).toEqual([-121.81, 47.39]);
      expect(t.trailheadIsParking).toBe(true);
      expect(t.junctions).toEqual(rich.junctions);
    }
    expect(r.backup.shortlist[0].addedAt).toBe(77);
  });
  it('an older backup with no shortlist still opens', () => {
    const { shortlist: _drop, ...old } = makeBackup([saved as never], [], DEFAULT_SETTINGS, 5);
    const r = parse(old);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.backup.shortlist).toEqual([]);
  });
  it('rejects damaged bookmark and trail fields', () => {
    const bad = (t: object) => parse(makeBackup([saved as never], [], DEFAULT_SETTINGS, 5, [{ trail: { ...rich, ...t }, addedAt: 1 }])).ok;
    expect(bad({})).toBe(true);
    expect(bad({ highlights: 'view' })).toBe(false);
    expect(bad({ highlights: [1] })).toBe(false);
    expect(bad({ trailhead: [500, 0] })).toBe(false);
    expect(bad({ trailheadIsParking: 'yes' })).toBe(false);
    expect(bad({ junctions: [{ along: 'x', branches: [] }] })).toBe(false);
    expect(bad({ junctions: [{ along: 1, branches: [{ point: [0] }] }] })).toBe(false);
    expect(parse({ ...makeBackup([], [], DEFAULT_SETTINGS, 5), shortlist: 'x' }).ok).toBe(false);
    expect(parse({ ...makeBackup([], [], DEFAULT_SETTINGS, 5), shortlist: [{ trail: rich }] }).ok).toBe(false);
  });
  it('drops unknown keys on trails', () => {
    const r = parse(makeBackup([saved as never], [], DEFAULT_SETTINGS, 5, [{ trail: { ...rich, evil: 1 } as unknown as Trail, addedAt: 1 }]));
    if (!r.ok) throw new Error('parse');
    expect('evil' in r.backup.shortlist[0].trail).toBe(false);
  });
  it('restore writes bookmarks with their date and leaves one already on the phone alone', async () => {
    const r = parse(makeBackup([], [], DEFAULT_SETTINGS, 5, [mark]));
    if (!r.ok) throw new Error('parse');
    await restoreBackup(r.backup);
    expect(db.sl.get('osm-w9')).toMatchObject({ addedAt: 77 });
    const kept = { trail: rich, addedAt: 5 };
    db.sl.set('osm-w9', kept);
    await restoreBackup(r.backup);
    expect(db.sl.get('osm-w9')).toBe(kept);
  });
});
