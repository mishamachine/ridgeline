// "Continue without an account": a one-time note, shown the first time a guest chooses to carry on without signing in.
// Stored on this device only (no network, no analytics). Once it has been shown it never shows again.
export const GUEST_NOTE_KEY = 'ridgeline:guestNoteShown';

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const store = (): Store | null => { try { return localStorage; } catch { return null; } };

export const guestNoteText = (platform: 'ios' | 'android' | 'web'): string =>
  `Without an account, your hikes and saved trails stay on ${platform === 'web' ? 'this device' : 'this phone'} only: no backup, and they won't be on your other devices.`;

export const guestNoteShown = (s: Store | null = store()): boolean => { try { return s?.getItem(GUEST_NOTE_KEY) === '1'; } catch { return false; } };
export function markGuestNoteShown(s: Store | null = store()) { try { s?.setItem(GUEST_NOTE_KEY, '1'); } catch { /* private mode: it may show again next launch */ } }
