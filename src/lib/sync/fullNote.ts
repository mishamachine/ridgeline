import { useEffect, useState } from 'react';
// "Your account is full": a calm, one-time note. Hitting a limit never blocks or loses a hike: it is saved and works on the phone, only the upload stops
// (the refused row is parked, so it is not retried in a storm). This remembers that the note is waiting and that it was shown once.
export const FULL_NOTE = 'Your account is full. New hikes are saved on this phone only.';
const KEY = 'ridgeline:fullNote';
export const FULL_EVENT = 'ridgeline:account-full';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const store = (): Store | null => { try { return localStorage; } catch { return null; } };
const read = (s: Store | null): 'pending' | 'shown' | null => { try { const v = s?.getItem(KEY); return v === 'pending' || v === 'shown' ? v : null; } catch { return null; } };

/** The server said the account is full. Marks the note as waiting, unless it was already shown. */
export function noteAccountFull(s: Store | null = store()) {
  if (!read(s)) { try { s?.setItem(KEY, 'pending'); } catch { /* ignore */ } try { window.dispatchEvent(new Event(FULL_EVENT)); } catch { /* no window */ } }
}
/** True once: the first time the person looks (Profile › Account) after the account filled up. */
export function takeFullNote(s: Store | null = store()): boolean {
  if (read(s) !== 'pending') return false;
  try { s?.setItem(KEY, 'shown'); } catch { /* ignore */ }
  return true;
}

/** React: true once, from the moment the account fills up (or the first time Profile is opened after it did). Never again after that. */
export function useFullNote(): boolean {
  const [show, setShow] = useState(() => takeFullNote());
  useEffect(() => {
    const on = () => { if (takeFullNote()) setShow(true); };
    window.addEventListener(FULL_EVENT, on);
    return () => window.removeEventListener(FULL_EVENT, on);
  }, []);
  return show;
}
