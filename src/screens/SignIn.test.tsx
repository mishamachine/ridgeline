import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SignIn } from './SignIn';
import { GuestContinueDialog } from '../components/GuestContinueDialog';
import { FLAGS_KEY } from '../lib/accounts/flags';
import { GUEST_NOTE_KEY, guestContinueClose, guestContinueTap, guestNoteShown, guestNoteText, markGuestNoteShown } from '../lib/accounts/guestContinue';

function fakeStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
}
const flags = (accounts: boolean) => JSON.stringify({ accounts, at: 1, tried: 1 });
const noop = () => {};

// The build ships with accounts off; these tests exercise the screen as it will be when accounts are on.
vi.mock('../lib/features', () => ({ features: { accounts: true } }));

afterEach(() => vi.unstubAllGlobals());

describe('guest note copy', () => {
  it('is verbatim on the phone and on the web', () => {
    expect(guestNoteText('ios')).toBe("Without an account, your hikes and saved trails stay on this phone only: no backup, and they won't be on your other devices.");
    expect(guestNoteText('android')).toBe(guestNoteText('ios'));
    expect(guestNoteText('web')).toBe("Without an account, your hikes and saved trails stay on this device only: no backup, and they won't be on your other devices.");
  });
});

describe('once per device', () => {
  it('is not shown until marked, then stays shown', () => {
    const s = fakeStorage();
    expect(guestNoteShown(s)).toBe(false);
    markGuestNoteShown(s);
    expect(s.m.get(GUEST_NOTE_KEY)).toBe('1');
    expect(guestNoteShown(s)).toBe(true);
  });
  it('never throws when storage is missing or blocked', () => {
    expect(guestNoteShown(null)).toBe(false);
    expect(() => markGuestNoteShown(null)).not.toThrow();
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(guestNoteShown(bad)).toBe(false);
    expect(() => markGuestNoteShown(bad)).not.toThrow();
  });
});

describe('tap logic', () => {
  it('first tap opens the note without marking it; closing marks it and continues; later taps continue directly', () => {
    const s = fakeStorage(); const back = vi.fn(); const open = vi.fn();
    guestContinueTap(s, back, open);
    expect(open).toHaveBeenCalledOnce(); expect(back).not.toHaveBeenCalled(); expect(guestNoteShown(s)).toBe(false);   // killed while open: still unseen
    guestContinueClose(s, back);
    expect(guestNoteShown(s)).toBe(true); expect(back).toHaveBeenCalledOnce();
    guestContinueTap(s, back, open);
    expect(open).toHaveBeenCalledOnce(); expect(back).toHaveBeenCalledTimes(2);
  });
});

describe('the pop-up', () => {
  it('is an accessible modal dialog with one Got it button', () => {
    const h = renderToStaticMarkup(<GuestContinueDialog platform="web" onClose={noop} />);
    expect(h).toContain('role="dialog"');
    expect(h).toContain('aria-modal="true"');
    expect(h).toContain('aria-labelledby="gc-title"');
    expect(h).toContain('id="gc-title"');
    expect(h).toContain('aria-describedby="gc-body"');
    expect(h).toContain('data-autofocus');           // useDialogKeys moves focus here, handles Tab, Escape and returns focus (see ConfirmSheet)
    expect(h.match(/<button/g)).toHaveLength(1);
    expect(h).toContain('>Got it<');
    expect(h).toContain('stay on this device only');
  });
  it('says "this phone" in the apps', () => {
    expect(renderToStaticMarkup(<GuestContinueDialog platform="ios" onClose={noop} />)).toContain('stay on this phone only');
  });
});

describe('sign-in screen', () => {
  beforeEach(() => vi.stubGlobal('localStorage', fakeStorage({ [FLAGS_KEY]: flags(true) })));

  it('offers a full-width Continue button and the note, and no "Not now"', () => {
    const h = renderToStaticMarkup(<SignIn onDone={noop} onBack={noop} platform="web" />);
    expect(h).toContain('Continue without an account');
    expect(h).toContain('width:100%');
    expect(h).not.toContain('Not now');
    expect(h).toContain(guestNoteText('web').replace("won't", 'won&#x27;t'));
    expect(h).not.toContain('role="dialog"');          // the pop-up opens only on tap
  });
  it('keeps "Not now" on the delete re-sign-in path', () => {
    vi.stubGlobal('localStorage', fakeStorage({ [FLAGS_KEY]: flags(true), 'ridgeline:lastUserId': 'u1' }));
    const h = renderToStaticMarkup(<SignIn returnTo="account-delete" onDone={noop} onBack={noop} platform="web" />);
    expect(h).toContain('Not now');
    expect(h).not.toContain('Continue without an account');
    expect(h).not.toContain(guestNoteText('web').slice(0, 30));
  });
  it('on the delete path with accounts paused it still shows Not now (paused state does not break it)', () => {
    vi.stubGlobal('localStorage', fakeStorage({ [FLAGS_KEY]: flags(false), 'ridgeline:lastUserId': 'u1' }));
    expect(renderToStaticMarkup(<SignIn returnTo="account-delete" onDone={noop} onBack={noop} platform="ios" />)).toContain('Not now');
  });
  it('is not reachable for a guest while accounts are paused (the paused flag does not change the pop-up logic)', () => {
    vi.stubGlobal('localStorage', fakeStorage({ [FLAGS_KEY]: flags(false) }));
    expect(renderToStaticMarkup(<SignIn onDone={noop} onBack={noop} platform="web" />)).toBe('');
    expect(guestNoteShown(fakeStorage())).toBe(false);
  });
});
