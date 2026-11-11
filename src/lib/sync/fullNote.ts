// "Your account is full": a calm, one-time note, per account. Hitting a limit never blocks or loses anything: it is saved and works on the phone, only the upload
// stops (the refused row is parked, so it is not retried in a storm). This remembers that a note is waiting and that it was shown once.
import { useEffect, useState } from 'react';
import type { Kind } from './merge';
import { nativePlatform } from '../native/platform';

/** The final wording, one line per type of record (never a combined sentence). */
export const FULL_NOTE_HIKES = 'Your account has no room for more hikes. New hikes are saved on this phone only.';
export const FULL_NOTE_SAVED = 'Your account has no room for more saved trails. New saved trails stay on this phone only.';
export const FULL_NOTE_SHORTLIST = 'Your account has no room for more shortlisted trails. New ones stay on this phone only.';
/** The same lines on the web, where the copy lives in the browser, not on a phone (pending sign-off; swap here and nowhere else). */
export const FULL_NOTE_HIKES_WEB = 'Your account has no room for more hikes. New hikes are saved on this device only.';
export const FULL_NOTE_SAVED_WEB = 'Your account has no room for more saved trails. New saved trails stay on this device only.';
export const FULL_NOTE_SHORTLIST_WEB = 'Your account has no room for more shortlisted trails. New ones stay on this device only.';
/** The note for rows the database refused for their content (23514): kept on this device, shown once per account and kind. Wording is the CBO's, verbatim. */
const PARKED_WORDS: Record<FullKind, [one: string, many: string]> = { hikes: ['hike', 'hikes'], saved: ['saved trail', 'saved trails'], shortlist: ['shortlisted trail', 'shortlisted trails'] };
export const parkedText = (k: FullKind, n: number, web: boolean = nativePlatform() === 'web') =>
  `${n} ${PARKED_WORDS[k][n === 1 ? 0 : 1]} couldn't be saved to your account and ${n === 1 ? 'is' : 'are'} on this ${web ? 'device' : 'phone'} only.`;
export const FULL_EVENT = 'ridgeline:account-full';

export type FullKind = 'hikes' | 'saved' | 'shortlist';
export const FULL_KINDS: FullKind[] = ['hikes', 'saved', 'shortlist'];
/** Which note a kind of record needs. Settings are tiny and never fill an account. */
export const fullKindOf = (k: Kind): FullKind | null => (k === 'activities' ? 'hikes' : k === 'saved' ? 'saved' : k === 'shortlist' ? 'shortlist' : null);
export const fullText = (k: FullKind, web: boolean = nativePlatform() === 'web') =>
  web ? (k === 'hikes' ? FULL_NOTE_HIKES_WEB : k === 'saved' ? FULL_NOTE_SAVED_WEB : FULL_NOTE_SHORTLIST_WEB)
      : (k === 'hikes' ? FULL_NOTE_HIKES : k === 'saved' ? FULL_NOTE_SAVED : FULL_NOTE_SHORTLIST);

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const pkey = (userId: string, k: FullKind) => `ridgeline:parkedNote:${userId}:${k}`;
const store = (): Store | null => { try { return localStorage; } catch { return null; } };
const key = (userId: string, k: FullKind) => `ridgeline:fullNote:${userId}:${k}`;
const read = (s: Store | null, userId: string, k: FullKind): 'pending' | 'shown' | null => { try { const v = s?.getItem(key(userId, k)); return v === 'pending' || v === 'shown' ? v : null; } catch { return null; } };

/** The server said this account is full for this kind of record. Marks the note as waiting, unless it was already shown for that account. */
export function noteAccountFull(userId: string, kind: FullKind, s: Store | null = store()) {
  if (!read(s, userId, kind)) { try { s?.setItem(key(userId, kind), 'pending'); } catch { /* ignore */ } try { window.dispatchEvent(new Event(FULL_EVENT)); } catch { /* no window */ } }
}
/** The texts due now for this account, one per full type and each exactly once, stacked in the order hikes, saved trails, shortlist: the first time the person looks (Profile › Account) after the account filled up. */
export function takeFullNotes(userId: string | null, s: Store | null = store()): string[] {
  if (!userId) return [];
  const out: string[] = [];
  for (const k of FULL_KINDS) if (read(s, userId, k) === 'pending') { try { s?.setItem(key(userId, k), 'shown'); } catch { /* ignore */ } out.push(fullText(k)); }
  return out;
}

/** The sync pass found n rows of this kind refused for their content. Marks the note as waiting (with the count), unless it was already shown for that account. */
export function noteParked(userId: string, kind: FullKind, n: number, s: Store | null = store()) {
  if (n < 1) return;
  try { if (s?.getItem(pkey(userId, kind))) return; s?.setItem(pkey(userId, kind), 'pending:' + n); } catch { return; }
  try { window.dispatchEvent(new Event(FULL_EVENT)); } catch { /* no window */ }
}
/** The parked-row notes due now for this account, each exactly once, in the order hikes, saved trails, shortlist. */
export function takeParkedNotes(userId: string | null, s: Store | null = store()): string[] {
  if (!userId) return [];
  const out: string[] = [];
  for (const k of FULL_KINDS) {
    try { const v = s?.getItem(pkey(userId, k)); if (v && v.startsWith('pending:')) { s?.setItem(pkey(userId, k), 'shown'); out.push(parkedText(k, Number(v.slice(8)))); } } catch { /* ignore */ }
  }
  return out;
}

/** React: the notes to show for this account (each appears once, from the moment the account fills up, and never again after that). */
export function useFullNotes(userId: string | null): string[] {
  const [shown, setShown] = useState<string[]>(() => [...takeFullNotes(userId), ...takeParkedNotes(userId)]);
  useEffect(() => {
    setShown([...takeFullNotes(userId), ...takeParkedNotes(userId)]);
    const on = () => { const t = [...takeFullNotes(userId), ...takeParkedNotes(userId)]; if (t.length) setShown((s) => [...s, ...t.filter((x) => !s.includes(x))]); };
    window.addEventListener(FULL_EVENT, on);
    return () => window.removeEventListener(FULL_EVENT, on);
  }, [userId]);
  return shown;
}
