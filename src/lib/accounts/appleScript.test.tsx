import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { APPLE_JS_URL, loadAppleScript, resetAppleScriptForTests } from './appleWeb';
import { accountsLive } from './flags';
import { vi } from 'vitest';
import { handleAppleKey, newToken, placeholderShowing } from '../../components/AppleButton';
import { APPLE_PRIVACY_LINE, ACCOUNTS_SECTION_HTML } from './privacyAccounts';
import { FLAGS_KEY } from './flags';

// A document that only counts the script tags it is given (any request to Apple's CDN starts with one).
const fakeDoc = () => { const added: { src: string }[] = []; const doc = { createElement: () => ({ src: '', async: false, onload: null as (() => void) | null, onerror: null as (() => void) | null, remove() {} }), head: { appendChild: (s: { src: string; onload: (() => void) | null }) => { added.push(s); queueMicrotask(() => s.onload?.()); } } }; return { doc: doc as unknown as Document, added }; };
const mem = (accounts?: boolean) => ({ getItem: (k: string) => (k === FLAGS_KEY && accounts !== undefined ? JSON.stringify({ accounts, at: 1, tried: 1 }) : null), setItem: () => {} });

beforeEach(() => resetAppleScriptForTests());

describe('Apple\'s script is requested only when the web sign-in screen opens with accounts live', () => {
  it('the URL is Apple\'s documented one', () => {
    expect(APPLE_JS_URL).toBe('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js');
  });
  it('no request with the flag off (accounts not built in)', async () => {
    const { doc, added } = fakeDoc();
    await expect(loadAppleScript(doc, accountsLive(false, mem(true)))).rejects.toThrow();
    expect(added).toHaveLength(0);
  });
  it('no request while paused, or before the flag has been read', async () => {
    for (const store of [mem(false), mem(undefined)]) {
      const { doc, added } = fakeDoc();
      await expect(loadAppleScript(doc, accountsLive(true, store))).rejects.toThrow();
      expect(added).toHaveLength(0);
    }
  });
  it('exactly one request when the sign-in screen opens (and not again if it opens twice)', async () => {
    const { doc, added } = fakeDoc();
    await loadAppleScript(doc, accountsLive(true, mem(true)));
    await loadAppleScript(doc, accountsLive(true, mem(true)));
    expect(added).toHaveLength(1);
    expect(added[0].src).toBe(APPLE_JS_URL);
  });
});

describe('nothing else can request it', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const src = walk('src').filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));
  it('the CDN host appears only in appleWeb.ts (the script URL) and in the privacy line', () => {
    const hits = src.filter((f) => readFileSync(f, 'utf8').includes('appleid.cdn-apple.com'));
    expect(hits.sort()).toEqual(['src/lib/accounts/appleWeb.ts', 'src/lib/accounts/privacyAccounts.ts']);
  });
  it('loadAppleScript is called from exactly one place: the web Apple button, which only mounts on a sign-in screen', () => {
    const callers = src.filter((f) => /loadAppleScript\(/.test(readFileSync(f, 'utf8')) && !f.endsWith('appleWeb.ts'));
    expect(callers).toEqual(['src/components/AppleButton.tsx']);
    const btn = readFileSync('src/components/AppleButton.tsx', 'utf8');
    expect(btn.split('function WebButton')[1]).toContain('loadAppleScript(');
    expect(btn.split('function IosButton')[1].split('function WebButton')[0]).not.toContain('loadAppleScript');   // never in the native apps
  });
  it('the page and the app shell carry no Apple script tag', () => {
    expect(readFileSync('index.html', 'utf8')).not.toMatch(/appleid|cdn-apple/);
  });
});

describe('the privacy line names the host the app really loads', () => {
  it('is the approved sentence with that host in it', () => {
    expect(APPLE_PRIVACY_LINE).toBe("Apple, when you open the sign-in screen on the web: your browser loads Apple's Sign in with Apple button from Apple's servers (appleid.cdn-apple.com). Apple sees your IP address and browser details. If you choose Apple, it handles your sign-in under its own privacy policy.");
  });
  it('the host in the line equals the host of the script URL (if one changes, this fails)', () => {
    const host = new URL(APPLE_JS_URL).hostname;
    expect(APPLE_PRIVACY_LINE).toContain(`(${host})`);
    expect(ACCOUNTS_SECTION_HTML).toContain(APPLE_PRIVACY_LINE);
  });
});

describe('the iOS button is the system control, registered with the app', () => {
  const swift = readFileSync('ios/App/App/HikePlugin.swift', 'utf8');
  it('uses ASAuthorizationAppleIDButton with the signIn type and is registered', () => {
    expect(swift).toContain('ASAuthorizationAppleIDButton(authorizationButtonType: .signIn');
    expect(swift).toContain('registerPluginInstance(AppleButtonPlugin())');
    expect(swift).toContain('jsName = "RidgelineAppleButton"');
    expect(swift).not.toMatch(/\.continue|UIImage|appleLogo/);
  });
});

describe('the web button is keyboard-operable and leaves no empty box', () => {
  const key = (k: string) => { const calls: string[] = []; return { e: { key: k, stopPropagation: () => calls.push('stop'), preventDefault: () => calls.push('prevent') }, calls }; };
  it('Enter and Space are caught before Apple\'s handler and call our sign-in; other keys are left alone', () => {
    for (const k of ['Enter', ' ']) { let n = 0; const { e, calls } = key(k); expect(handleAppleKey(e, () => n++)).toBe(true); expect(n).toBe(1); expect(calls.sort()).toEqual(['prevent', 'stop']); }
    let n = 0; const { e, calls } = key('Tab');
    expect(handleAppleKey(e, () => n++)).toBe(false); expect(n).toBe(0); expect(calls).toEqual([]);
  });
  it('the component wires the key handler, one tab stop, Apple\'s inner elements are taken out of the tab order, and a failed load renders nothing', () => {
    const src = readFileSync('src/components/AppleButton.tsx', 'utf8');
    expect(src).toContain('onKeyDownCapture');
    expect(src).toContain('tabIndex={0}');
    expect(src).toContain("setAttribute('tabindex', '-1')");
    expect(src).toContain('if (failed) return null;');
  });
});

describe('the iOS button belongs to one screen at a time and hides when it is not visible', () => {
  it('JS: hides whenever the placeholder is not really showing, with a token per screen, and sends page coordinates', () => {
    const src = readFileSync('src/components/AppleButton.tsx', 'utf8');
    expect(src).toContain('IntersectionObserver');
    expect(src).toContain('offsetParent');
    expect(src).toContain('elementFromPoint');
    expect(src).toContain('visible = true');
    expect(src).toContain('window.scrollX');
    expect(src).toContain('NativeAppleButton.hide({ token })');
  });
  it('JS: two screens get different tokens, and a missing placeholder is never "showing"', () => {
    expect(newToken()).not.toBe(newToken());
    expect(placeholderShowing(null)).toBe(false);
  });
  it('Swift: only the owner can hide it, and page coordinates go through the scroll view (safe area and scroll offset)', () => {
    const swift = readFileSync('ios/App/App/HikePlugin.swift', 'utf8');
    expect(swift).toContain('token == self.owner');
    expect(swift).toContain('web.scrollView.convert(');
    expect(swift).toContain('self.owner = token');
  });
});

// ---- Apple's script only ever belongs to the web sign-in screen ----
import { renderToStaticMarkup } from 'react-dom/server';
import { SignIn } from '../../screens/SignIn';
import { GuestPrompt } from '../../components/GuestPrompt';
import { AccountRow } from '../../components/AccountRow';
import { DeleteAccount } from '../../screens/DeleteAccount';
import { Profile } from '../../screens/Profile';
import { Celebrate } from '../../screens/Celebrate';
import { parseRoute } from '../route';

import { ProviderButton } from '../../components/ProviderButton';
// What the sign-in screen draws when accounts are live (the screen itself hides unless the flag says so).
const SignInLive = () => (<>{(['apple', 'google'] as const).map((p) => <ProviderButton key={p} provider={p} platform="web" onClick={() => {}} />)}</>);

describe('no Apple button, and so no request to appleid.cdn-apple.com, anywhere but the sign-in screen', () => {
  const walk2 = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk2(p) : [p]; });
  const srcFiles = walk2('src').filter((f) => /\.tsx$/.test(f) && !/\.test\./.test(f));
  it('ProviderButton (the only thing that draws Apple or Google buttons) is used by the sign-in screen alone', () => {
    const users = srcFiles.filter((f) => /<ProviderButton/.test(readFileSync(f, 'utf8')));
    expect(users).toEqual(['src/screens/SignIn.tsx']);
  });
  const none = (html: string) => { expect(html).not.toMatch(/appleid|Sign in with Apple|Sign in with Google|data-apple-button/); };
  it('the guest prompt card has one "Sign in" button and no provider buttons', () => {
    const card = renderToStaticMarkup(<GuestPrompt kinds={['save']} trigger enabled initialOpen onSignIn={() => {}} />);
    expect(card).toContain('>Sign in<');
    expect(card).toContain('Keep your saved trails');
    none(card);
    none(renderToStaticMarkup(<Celebrate summary={{ trail: { id: 'osm-r1', name: 'Ledge', highlights: [] }, distanceM: 6000, climbFt: 1500, movingMs: 9_000_000, startedAt: 1, endedAt: 2, highlightsHit: [], completedFraction: 1, track: [] }} onDone={() => {}} onShareApp={() => {}} guestPrompt={<GuestPrompt kinds={['hike']} trigger enabled initialOpen tone="dark" onSignIn={() => {}} />} />));
  });
  it('Profile › Account for a guest has one "Sign in" link and no provider buttons', () => {
    const row = renderToStaticMarkup(<AccountRow enabled onSignIn={() => {}} />);
    expect(row).toContain('Not signed in. Your hikes are saved only on this phone.');
    expect(row).toContain('>Sign in<');
    none(row);
    none(renderToStaticMarkup(<Profile onOpenBadges={() => {}} onReplayTour={() => {}} preset={{ activities: [], trails: [] }} />));
  });
  it('the delete page itself asks to sign in with one button and draws no provider button', () => {
    const page = renderToStaticMarkup(<DeleteAccount onBack={() => {}} onSignIn={() => {}} />);
    none(page);
  });
  it('the sign-in screen is the one place the web Apple button is drawn, once', () => {
    const html = renderToStaticMarkup(<SignIn platform="web" onDone={() => {}} onBack={() => {}} />);
    // (accounts are not live in this build, so it renders nothing here; the live render is checked through its parts below)
    expect(html).toBe('');
    const live = renderToStaticMarkup(<SignInLive />);
    expect((live.match(/id="appleid-signin-\d+"/g) ?? []).length).toBe(1);
    expect(live).toContain('aria-label="Sign in with Google"');
  });
  it('the sign-in route: open when live, reachable while paused only from the delete flow, absent when accounts are not built in', () => {
    expect(parseRoute('/signin', '', '/', false, true, true, false)).toEqual({ kind: 'sign-in' });
    expect(parseRoute('/signin', '', '/', false, true, false, true)).toEqual({ kind: 'tab', tab: 'find' });                    // paused, not from delete: no
    expect(parseRoute('/signin', '?return=delete', '/', false, true, false, true)).toEqual({ kind: 'sign-in', returnTo: 'account-delete' });
    expect(parseRoute('/signin', '?return=delete', '/', false, true, false, false)).toEqual({ kind: 'tab', tab: 'find' });    // paused and this phone never had an account: no new sign-ups
    expect(parseRoute('/signin', '?return=delete', '/', false, false, true, true)).toEqual({ kind: 'tab', tab: 'find' });       // not built in
  });
});

describe('the iOS button: covered anywhere, or a sheet opening, hides it at once', () => {
  const box = (over: object = {}) => ({ offsetParent: {}, getBoundingClientRect: () => ({ left: 10, top: 100, right: 198, bottom: 144, width: 188, height: 44 }), contains: (n: unknown) => n === inner, ...over });
  const inner = {};
  const docWith = (hit: (x: number, y: number) => unknown) => ({ visibilityState: 'visible', defaultView: { innerWidth: 390, innerHeight: 800 }, elementFromPoint: hit }) as unknown as Document;
  it('visible only when the centre AND all four corners belong to the placeholder', () => {
    const el = box();
    expect(placeholderShowing(el as never, docWith(() => el))).toBe(true);
    // something drawn over just the bottom-right corner (a toast, a sheet edge)
    expect(placeholderShowing(el as never, docWith((x, y) => (x > 190 && y > 140 ? {} : el)))).toBe(false);
    expect(placeholderShowing(el as never, docWith((x, y) => (x < 13 && y < 103 ? {} : el)))).toBe(false);         // top-left corner covered
    expect(placeholderShowing(el as never, docWith((x, y) => (x > 190 && y < 103 ? {} : el)))).toBe(false);        // top-right
    expect(placeholderShowing(el as never, docWith((x, y) => (x < 13 && y > 140 ? {} : el)))).toBe(false);         // bottom-left
    expect(placeholderShowing(el as never, docWith((x, y) => (x === 104 ? {} : el)))).toBe(false);                 // the centre
  });
  it('not showing when hidden, off screen, or the page is in the background', () => {
    expect(placeholderShowing(box({ offsetParent: null }) as never, docWith(() => box()))).toBe(false);
    expect(placeholderShowing(box({ getBoundingClientRect: () => ({ left: 10, top: 900, right: 198, bottom: 944, width: 188, height: 44 }) }) as never, docWith(() => box()))).toBe(false);
  });
  it('a sheet announcing itself is heard in the same tick', async () => {
    const { announceOverlayOpen, OVERLAY_EVENT } = await import('../overlayEvents');
    const w = new EventTarget();
    vi.stubGlobal('window', w);
    try { let n = 0; w.addEventListener(OVERLAY_EVENT, () => n++); announceOverlayOpen(); expect(n).toBe(1); } finally { vi.unstubAllGlobals(); }
  });
  it('the button listens for it, sheets and the tour announce, and the tab-order and timeout nits are in', () => {
    const btn = readFileSync('src/components/AppleButton.tsx', 'utf8');
    expect(btn).toContain('window.addEventListener(OVERLAY_EVENT, cover)');
    expect(btn).toContain('[el, ...Array.from(el.querySelectorAll');
    expect(btn).toContain('if (el.childElementCount === 0 && !off) setFailed(true)');
    expect(readFileSync('src/components/ConfirmSheet.tsx', 'utf8')).toContain('useAnnounceOverlay()');
    expect(readFileSync('src/screens/Onboarding.tsx', 'utf8')).toContain('useAnnounceOverlay()');
    expect(readFileSync('src/App.tsx', 'utf8')).toContain('announceOverlayOpen()');
  });
});
