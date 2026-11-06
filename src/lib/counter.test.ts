import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { count, resetCounterForTests } from './counter';
import { features } from './features';
import { COUNTER_URL } from './site';

const beacon = vi.fn(() => true);
const fetchMock = vi.fn(() => Promise.resolve(new Response()));
const blobText = (b: Blob) => b.text();
const store = { setItem: vi.fn(), getItem: vi.fn(), length: 0 };
const session = { setItem: vi.fn() };
const idb = { open: vi.fn() };
const doc = { referrer: '', cookieWrites: 0 };

beforeEach(() => {
  resetCounterForTests();
  beacon.mockClear(); fetchMock.mockClear();
  store.setItem.mockClear();
  vi.stubGlobal('navigator', { sendBeacon: beacon });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('location', { search: '?utm_source=  news  &utm_medium=email&utm_campaign=' + 'x'.repeat(100), hostname: 'hike.bbprojectfactory.com' });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('localStorage', store);
  vi.stubGlobal('sessionStorage', session);
  vi.stubGlobal('indexedDB', idb);
});
afterEach(() => { features.counter = false; vi.unstubAllGlobals(); });

describe('counter', () => {
  it('is a no-op with the flag off', () => {
    (['session', 'offline_save', 'hike_start', 'share'] as const).forEach(count);
    expect(beacon).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.setItem).not.toHaveBeenCalled();
    expect(doc.cookieWrites).toBe(0);
    expect(session.setItem).not.toHaveBeenCalled();
    expect(idb.open).not.toHaveBeenCalled();
  });

  it('sanitises UTM values and blanks IP and same-host referrers', async () => {
    features.counter = true;
    vi.stubGlobal('location', { search: '?utm_source=a%20b<x>&utm_medium=me@x.com&utm_campaign=ok-1_2.3', hostname: 'hike.bbprojectfactory.com' });
    const ref = async (r: string) => { resetCounterForTests(); beacon.mockClear(); doc.referrer = r; count('session'); return JSON.parse(await blobText((beacon.mock.calls[0] as unknown as [string, Blob])[1])); };
    const a = await ref('http://192.168.1.5/x');
    expect(a.src).toEqual({ utm_source: 'abx', utm_medium: '', utm_campaign: 'ok-1_2.3', ref: '' });
    expect((await ref('http://[::1]/')).src.ref).toBe('');
    expect((await ref('https://hike.bbprojectfactory.com/trail/1')).src.ref).toBe('');
    doc.referrer = '';
  });

  it('uses a non-preflight content type', () => {
    features.counter = true;
    count('share');
    expect((beacon.mock.calls[0] as unknown as [string, Blob])[1].type.toLowerCase()).toBe('text/plain;charset=utf-8');
  });

  it('targets SITE_URL/v', () => { expect(COUNTER_URL).toBe('https://hike.bbprojectfactory.com/v'); });

  it('sends exact payloads; src only on session', async () => {
    features.counter = true;
    count('offline_save'); count('hike_start'); count('share');
    const bodies = await Promise.all(beacon.mock.calls.map((c) => blobText((c as unknown as [string, Blob])[1])));
    expect(bodies).toEqual([
      '{"p":"ridgeline","e":"offline_save","si":0}',
      '{"p":"ridgeline","e":"hike_start","si":0}',
      '{"p":"ridgeline","e":"share","si":0}',
    ]);
    expect(beacon.mock.calls.every((c) => (c as unknown as [string])[0] === COUNTER_URL)).toBe(true);
    count('session');
    const last = beacon.mock.calls.at(-1) as unknown as [string, Blob];
    expect(JSON.parse(await blobText(last[1]))).toEqual({ p: 'ridgeline', e: 'session', si: 0, src: { utm_source: 'news', utm_medium: 'email', utm_campaign: 'x'.repeat(64), ref: '' } });
  });

  it('ref is the external hostname only', async () => {
    features.counter = true;
    doc.referrer = 'https://www.example.org/some/path?q=1';
    count('session');
    const b = JSON.parse(await blobText((beacon.mock.calls[0] as unknown as [string, Blob])[1]));
    expect(b.src.ref).toBe('www.example.org');
    doc.referrer = '';
  });

  it('session once per launch', () => {
    features.counter = true;
    count('session'); count('session');
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it('native uses fetch with keepalive and no credentials', () => {
    features.counter = true;
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true });
    count('share');
    expect(beacon).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(COUNTER_URL, { method: 'POST', keepalive: true, credentials: 'omit', headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: '{"p":"ridgeline","e":"share","si":0}' });
  });

  it('swallows errors and stores nothing', () => {
    features.counter = true;
    beacon.mockImplementationOnce(() => { throw new Error('x'); });
    expect(() => count('share')).not.toThrow();
    count('session');
    expect(store.setItem).not.toHaveBeenCalled();
  });
});
