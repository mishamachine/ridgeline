import { describe, it, expect, vi } from 'vitest';
vi.mock('./native/platform', () => ({ isNative: () => false }));
import { A2HS_TIP, IOS_NO_CARRY_LINE, POPUP_GAP_MS, dayKey, showNoCarryLine, installPlatform, isInAppBrowser, recordVisit, shouldShowInstallPopup, type PopupContext, type PopupState } from './pwa';

const DAY = 24 * 3600 * 1000;
const T0 = Date.UTC(2026, 10, 20, 12);
const ok: PopupContext = { native: false, standalone: false, inApp: false, offline: false, platform: 'android', busy: false, shownThisVisit: false };
const due: PopupState = { installDismissals: 0, installLastShown: 0, installDone: false, installSessions: 2, installDays: ['2026-11-18', '2026-11-19', '2026-11-20'] };
const show = (s: Partial<PopupState> = {}, c: Partial<PopupContext> = {}, now = T0) => shouldShowInstallPopup({ ...due, ...s }, { ...ok, ...c }, now);

describe('A2HS tip and the no-carry line', () => {
  it('makes no storage claim', () => {
    expect(A2HS_TIP).toBe('On iPhone, tap Share, then Add to Home Screen.');
    expect(A2HS_TIP).not.toContain('Safari keeps');
    expect(A2HS_TIP).not.toMatch(/keeps|clear/);
  });
  it('the no-carry line has the approved wording', () => {
    expect(IOS_NO_CARRY_LINE).toBe('Trails saved here won\u2019t move to the home-screen app. Save them again there.');
  });
  it('shows on iOS only, and only with saved trails', () => {
    expect(showNoCarryLine('ios', true)).toBe(true);
    expect(showNoCarryLine('ios', false)).toBe(false);
    expect(showNoCarryLine('android', true)).toBe(false);
    expect(showNoCarryLine('desktop', true)).toBe(false);
  });
});

describe('in-app browsers and platform', () => {
  const ua = {
    insta: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0',
    fb: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0]',
    wv: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
    safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
    chrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
  };
  it('flags Instagram, Facebook and Android webviews', () => {
    expect(isInAppBrowser(ua.insta)).toBe(true);
    expect(isInAppBrowser(ua.fb)).toBe(true);
    expect(isInAppBrowser(ua.wv)).toBe(true);
  });
  it('does not flag Safari or Chrome', () => {
    expect(isInAppBrowser(ua.safari)).toBe(false);
    expect(isInAppBrowser(ua.chrome)).toBe(false);
  });
  it('finds the platform', () => {
    vi.stubGlobal('navigator', { userAgent: ua.chrome, platform: 'Linux', maxTouchPoints: 5 });
    expect(installPlatform(ua.chrome)).toBe('android');
    vi.stubGlobal('navigator', { userAgent: ua.safari, platform: 'iPhone', maxTouchPoints: 5 });
    expect(installPlatform(ua.safari)).toBe('ios');
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 });
    expect(installPlatform('Mozilla/5.0 (Macintosh)')).toBe('desktop');
    vi.unstubAllGlobals();
  });
});

describe('recordVisit', () => {
  it('counts launches and distinct days', () => {
    let s = { ...due, installSessions: 0, installDays: [] as string[] };
    s = { ...s, ...recordVisit(s, T0) };
    s = { ...s, ...recordVisit(s, T0 + 3600_000) };
    expect(s.installSessions).toBe(2);
    expect(s.installDays).toEqual([dayKey(T0)]);
    s = { ...s, ...recordVisit(s, T0 + DAY) };
    expect(s.installDays).toHaveLength(2);
  });
});

describe('pop-up rules', () => {
  it('shows only on the 3rd separate day of use (no save-offline trigger)', () => {
    expect(show()).toBe(true);
    expect(show({ installDays: ['2026-11-19', '2026-11-20'] })).toBe(false);
    expect(show({ installDays: ['2026-11-20'], ...({ installSaved: true } as object) })).toBe(false);
  });
  it('never in the first session', () => {
    expect(show({ installSessions: 1 })).toBe(false);
    expect(show({ installSessions: 0 })).toBe(false);
  });
  it('at most once every 14 days (fake clock)', () => {
    const last = T0 - DAY;
    expect(show({ installLastShown: last })).toBe(false);
    expect(show({ installLastShown: T0 - POPUP_GAP_MS + 1 })).toBe(false);
    expect(show({ installLastShown: T0 - POPUP_GAP_MS })).toBe(true);
  });
  it('at most once per visit, even when 14 days have passed', () => {
    expect(show({}, { shownThisVisit: true })).toBe(false);
  });
  it('stops for good after 2 pop-up dismissals', () => {
    expect(show({ installDismissals: 1 })).toBe(true);
    expect(show({ installDismissals: 2 })).toBe(false);
    expect(show({ installDismissals: 2, installLastShown: 0 }, {}, T0 + 400 * DAY)).toBe(false);
  });
  it('onboarding "Not now" and "Got it" are not dismissals: they write no state at all', () => {
    // Onboarding only moves to the next card; the pop-up reads installDismissals, which only the pop-up writes.
    expect(show({ installDismissals: 0 })).toBe(true);
  });
  it('never once installed', () => expect(show({ installDone: true })).toBe(false));
  it.each([
    ['native app', { native: true }],
    ['standalone', { standalone: true }],
    ['in-app browser', { inApp: true }],
    ['offline', { offline: true }],
    ['Navigate, Record or the tour (busy)', { busy: true }],
    ['desktop', { platform: 'desktop' as const }],
  ])('never in %s', (_n, c) => expect(show({}, c)).toBe(false));
  it('shows on iPhone too', () => expect(show({}, { platform: 'ios' })).toBe(true));
});
