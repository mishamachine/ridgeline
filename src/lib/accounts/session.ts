// Remembers which account this phone last signed in with. While sign-in is paused, the sign-in screen opens only for someone who already has an account here
// (to confirm who is deleting), and a re-sign-in that returns a DIFFERENT account is signed out again at once.
const KEY = 'ridgeline:lastUserId';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const store = (): Store | null => { try { return localStorage; } catch { return null; } };
export const markSession = (userId: string, s: Store | null = store()) => { try { s?.setItem(KEY, userId); } catch { /* ignore */ } };
export const lastUserId = (s: Store | null = store()): string | null => { try { return s?.getItem(KEY) || null; } catch { return null; } };
/** True when this phone has (or had) an account session. */
export const hadSession = (s: Store | null = store()): boolean => lastUserId(s) !== null;
/** While paused, may this sign-in stand? Only if it is the account this phone already had. */
export const isKnownAccount = (userId: string, s: Store | null = store()): boolean => lastUserId(s) === userId;

export const DIFFERENT_ACCOUNT_MESSAGE = 'That is not the account used on this phone, so you were signed out. Sign in with the account you want to delete, or ask for deletion by email.';
