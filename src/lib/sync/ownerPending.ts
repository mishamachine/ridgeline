// A different account signed in on a phone that kept another account's copy: nothing syncs until the person chooses. This remembers that a choice is waiting
// (so Profile can keep reminding them) and, PER ACCOUNT, that they said "not now" to the sheet. Answering for one account never silences another.
import { useSyncExternalStore } from 'react';

let pendingUser: string | null = null;
const listeners = new Set<() => void>();
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const store = (): Store | null => { try { return localStorage; } catch { return null; } };
const laterKey = (userId: string) => `ridgeline:ownerAsk:${userId}`;

export const getOwnerPending = () => pendingUser;
export function setOwnerPending(userId: string | null) { if (pendingUser !== userId) { pendingUser = userId; listeners.forEach((l) => l()); } }
export const useOwnerPending = (): string | null => useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, getOwnerPending, getOwnerPending);

/** "Not now" to the sheet, remembered for this account only. */
export function saidNotNow(userId: string, s: Store | null = store()) { try { s?.setItem(laterKey(userId), '1'); } catch { /* ignore */ } }
export const hasSaidNotNow = (userId: string, s: Store | null = store()): boolean => { try { return s?.getItem(laterKey(userId)) === '1'; } catch { return false; } };
export function clearNotNow(userId: string, s: Store | null = store()) { try { s?.removeItem(laterKey(userId)); } catch { /* ignore */ } }

/** The sheet shows when this account has a choice waiting and has not said "not now". */
export const shouldAskOwner = (pending: string | null, userId: string | null, s: Store | null = store()): boolean => !!pending && !!userId && pending === userId && !hasSaidNotNow(userId, s);
