import { useEffect, useRef } from 'react';
import { get, set } from 'idb-keyval';
import { accountsLive } from '../accounts/flags';
import { getClient } from '../accounts/client';
import { getSettings } from '../settings';
import { syncOnce, StaleEpochError, type Cursors, type Owner } from './engine';
import { isHikeActive } from '../swUpdate';
import { noteAccountFull } from './fullNote';
import { idbLocal } from './local';
import { supabaseRemote } from './remote';
import { syncGate } from './gate';

const cursors: Cursors = { get: async (k) => (await get<number>(k)) ?? 0, set: (k, v) => set(k, v), getJson: async <T,>(k: string) => get<T>(k), setJson: (k, v) => set(k, v) };
const OWNER_KEY = 'sync:owner';
export const idbOwner: Owner = { get: async () => (await get<string>(OWNER_KEY)) ?? null, set: (id) => set(OWNER_KEY, id) };

export interface PassOutcome { pulled: number; deletedElsewhere: boolean; ownerMismatch?: boolean; retrySoon?: boolean; full?: boolean }

/** One sync pass for the signed-in user, under the delete gate. Never throws; a failure just means "try again later". */
export async function runSync(userId: string): Promise<PassOutcome> {
  const none: PassOutcome = { pulled: 0, deletedElsewhere: false };
  if (!accountsLive()) return none;   // paused or not built in: no sync, no network, the local copy stays as it is
  const out = await syncGate.run(async () => {
    try {
      const c = await getClient();
      if (!c) return none;
      const r = await syncOnce(userId, idbLocal, supabaseRemote(c, userId, () => getSettings().keepTracksLocal), cursors, { canPush: () => !syncGate.paused, canWipe: () => !isHikeActive(), owner: idbOwner });
      return { pulled: r.pulled, deletedElsewhere: r.deletedElsewhere, ownerMismatch: r.ownerMismatch, full: r.full };
    } catch (e) {
      // A refused write means the data was deleted elsewhere while this pass ran: the next pass will see the new epoch and clear this phone.
      if (e instanceof StaleEpochError) return { ...none, retrySoon: true } as PassOutcome;
      // PausedError (the server refuses writes while sign-in is paused): quiet, retried at the next pass.
      return none;
    }
  });
  return out ?? none;
}

/**
 * The person's answer when a different account signs in on a phone that still holds another account's kept copy:
 * 'add' hands the copy to this account (it uploads), 'remove' clears it from the phone first. Until one of them, nothing syncs.
 */
export async function resolveOwnerMismatch(userId: string, choice: 'add' | 'remove'): Promise<void> {
  if (choice === 'remove') await idbLocal.wipe();
  await idbOwner.set(userId);
}

export const DELETED_ELSEWHERE_MESSAGE = 'Your Ridgeline data was deleted on another device.';

/** Syncs when the person signs in, when the app comes back to the front or the network returns, and every 2 minutes. Nothing runs while accounts are off, signed out, or a delete is in progress. */
export function useSync(userId: string | null, onPulled: () => void, onDeletedElsewhere: () => void = () => {}, enabled: boolean = accountsLive(), onOwnerMismatch: () => void = () => {}, onFull: () => void = () => {}) {
  const cb = useRef(onPulled), cbDel = useRef(onDeletedElsewhere), cbOwner = useRef(onOwnerMismatch), cbFull = useRef(onFull);
  cb.current = onPulled; cbDel.current = onDeletedElsewhere; cbOwner.current = onOwnerMismatch; cbFull.current = onFull;
  useEffect(() => {
    if (!enabled || !userId) return;
    const go = () => {
      if (!navigator.onLine) return;
      runSync(userId).then((o) => {
        if (o.ownerMismatch) { cbOwner.current(); return; }
        if (o.full) { noteAccountFull(); cbFull.current(); }
        if (o.deletedElsewhere) { cbDel.current(); cb.current(); }
        else if (o.pulled) cb.current();
        if ((o as PassOutcome & { retrySoon?: boolean }).retrySoon) setTimeout(go, 1500);
      });
    };
    go();
    const timer = setInterval(go, 120_000);
    const vis = () => { if (document.visibilityState === 'visible') go(); };
    window.addEventListener('online', go);
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(timer); window.removeEventListener('online', go); document.removeEventListener('visibilitychange', vis); };
  }, [enabled, userId]);
}
