// "Your account is full": a calm, one-time note. Hitting a limit never blocks or loses a hike: it is saved and works on the phone, only the upload stops
// (the refused row is parked, so it is not retried in a storm). This remembers that the note is waiting and that it was shown once.
export const FULL_NOTE = 'Your account is full. New hikes are saved on this phone only.';
const KEY = 'ridgeline:fullNote';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const store = (): Store | null => { try { return localStorage; } catch { return null; } };
const read = (s: Store | null): 'pending' | 'shown' | null => { try { const v = s?.getItem(KEY); return v === 'pending' || v === 'shown' ? v : null; } catch { return null; } };

/** The server said the account is full. Marks the note as waiting, unless it was already shown. */
export function noteAccountFull(s: Store | null = store()) { if (!read(s)) try { s?.setItem(KEY, 'pending'); } catch { /* ignore */ } }
/** True once: the first time the person looks (Profile › Account) after the account filled up. */
export function takeFullNote(s: Store | null = store()): boolean {
  if (read(s) !== 'pending') return false;
  try { s?.setItem(KEY, 'shown'); } catch { /* ignore */ }
  return true;
}
