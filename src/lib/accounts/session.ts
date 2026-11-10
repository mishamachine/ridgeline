// Remembers that this phone has (or once had) a signed-in session. While sign-in is paused, the sign-in screen opens only for a person who already
// has an account here (to confirm who is deleting); it never creates new accounts.
const KEY = 'ridgeline:hadSession';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const store = (): Store | null => { try { return localStorage; } catch { return null; } };
export const markHadSession = (s: Store | null = store()) => { try { s?.setItem(KEY, '1'); } catch { /* ignore */ } };
export const hadSession = (s: Store | null = store()): boolean => { try { return s?.getItem(KEY) === '1'; } catch { return false; } };
