import { afterEach, describe, expect, it, vi } from 'vitest';
import { SITE_URL } from './site';
import { appShareUrl, hikeShareUrl, isTrailId, parseHikeParams, parseHikePath, statsLine, trailUrl } from './shareLinks';

const hike = { trailId: 'osm-r123', distanceM: 6115, climbFt: 1540.4, movingMs: (2 * 60 + 41) * 60000 };

describe('hikeShareUrl', () => {
  it('has the trail id and three numbers, nothing else', () => {
    const u = new URL(hikeShareUrl(hike));
    expect(u.origin).toBe(SITE_URL);
    expect(u.pathname).toBe('/h/osm-r123');
    expect([...u.searchParams.keys()]).toEqual(['d', 'c', 't']);
    expect(u.searchParams.get('d')).toBe('3.8');
    expect(u.searchParams.get('c')).toBe('1540');
    expect(u.searchParams.get('t')).toBe('2:41');
  });
  it('falls back to the plain site for a bad trail id', () => {
    expect(hikeShareUrl({ ...hike, trailId: '../x?y=<script>' })).toBe(SITE_URL);
    expect(hikeShareUrl({ ...hike, trailId: '' })).toBe(SITE_URL);
  });
  it('clamps and survives NaN', () => {
    const u = new URL(hikeShareUrl({ trailId: 'a', distanceM: 1e9, climbFt: -5, movingMs: NaN }));
    expect(u.searchParams.get('d')).toBe('200.0');
    expect(u.searchParams.get('c')).toBe('0');
    expect(u.searchParams.get('t')).toBe('0:00');
  });
});

describe('appShareUrl', () => {
  it('is a plain marker with no id', () => {
    expect(appShareUrl()).toBe(`${SITE_URL}/?ref=share`);
  });
});

describe('trailUrl', () => {
  it('encodes the id', () => {
    expect(trailUrl('osm-w9-0')).toBe(`${SITE_URL}/h/osm-w9-0`);
    expect(trailUrl('bad id')).toBe(SITE_URL);
  });
});

describe('parseHikePath', () => {
  it('reads a good id, with or without a trailing slash', () => {
    expect(parseHikePath('/h/osm-r123')).toBe('osm-r123');
    expect(parseHikePath('/h/osm-w9-0/')).toBe('osm-w9-0');
  });
  it('rejects junk', () => {
    for (const p of ['/h/', '/h', '/x/abc', '/h/a/b', '/h/%3Cscript%3E', '/h/%E0%A4%A', '/h/' + 'a'.repeat(65), '/h/-bad']) expect(parseHikePath(p)).toBeNull();
  });
});

describe('parseHikeParams', () => {
  it('round-trips a built link', () => {
    expect(parseHikeParams(new URL(hikeShareUrl(hike)).search)).toEqual({ miles: 3.8, climbFt: 1540, time: '2:41' });
  });
  it('drops junk and keeps good fields', () => {
    expect(parseHikeParams('?d=abc&c=12&t=lots')).toEqual({ climbFt: 12 });
    expect(parseHikeParams('?d=<b>&c=-5&t=2:99')).toEqual({});
    expect(parseHikeParams('')).toEqual({});
  });
  it('clamps out-of-range values', () => {
    expect(parseHikeParams('?d=9999&c=999999&t=99:00')).toEqual({ miles: 200, climbFt: 30000, time: '48:00' });
  });
  it('accepts an encoded colon', () => {
    expect(parseHikeParams('?t=1%3A05').time).toBe('1:05');
  });
});

describe('statsLine', () => {
  it('formats what it has', () => {
    expect(statsLine({ miles: 3.8, climbFt: 1540, time: '2:41' })).toBe('3.8 mi · 1,540 ft climbed · 2:41');
    expect(statsLine({ time: '0:30' })).toBe('0:30');
    expect(statsLine({})).toBe('');
  });
});

describe('isTrailId', () => {
  it('only takes safe ids', () => {
    expect(isTrailId('osm-r1')).toBe(true);
    expect(isTrailId('a b')).toBe(false);
    expect(isTrailId(5)).toBe(false);
  });
});

describe('web vs native base', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('uses the serving origin on the web, but the canonical host on the card', () => {
    vi.stubGlobal('window', { location: { origin: 'https://example.test' } });
    expect(appShareUrl()).toBe('https://example.test/?ref=share');
    expect(hikeShareUrl(hike).startsWith('https://example.test/h/osm-r123?')).toBe(true);
    expect(trailUrl('osm-r123')).toBe(`${SITE_URL}/h/osm-r123`);
  });
  it('uses SITE_URL on native', () => {
    vi.stubGlobal('window', { location: { origin: 'capacitor://localhost' }, Capacitor: { isNativePlatform: () => true } });
    expect(appShareUrl()).toBe(`${SITE_URL}/?ref=share`);
  });
});
