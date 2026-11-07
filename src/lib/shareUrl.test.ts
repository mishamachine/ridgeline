import { describe, it, expect, vi, afterEach } from 'vitest';
import { shareUrl } from './shareUrl';
import { SITE_URL } from './site';

afterEach(() => vi.unstubAllGlobals());

describe('shareUrl', () => {
  it('SITE_URL is the umbrella domain', () => expect(SITE_URL).toBe('https://hike.bbprojectfactory.com'));
  it('on the web it is still SITE_URL, never the host the person is on', () => {
    vi.stubGlobal('window', { location: { origin: 'https://example.test' } });
    expect(shareUrl()).toBe(SITE_URL);
  });
  it('in the native app it is SITE_URL', () => {
    vi.stubGlobal('window', { location: { origin: 'capacitor://localhost' }, Capacitor: { isNativePlatform: () => true } });
    expect(shareUrl()).toBe(SITE_URL);
  });
});
