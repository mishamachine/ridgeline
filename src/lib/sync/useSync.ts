import { useEffect, useRef } from 'react';
import { get, set } from 'idb-keyval';
import { features } from '../features';
import { getClient } from '../accounts/client';
import { getSettings } from '../settings';
import { KINDS, syncOnce, type Cursors } from './engine';
import { idbLocal } from './local';
import { supabaseRemote } from './remote';

const cursors: Cursors = { get: async (k) => (await get<number>(k)) ?? 0, set: (k, v) => set(k, v) };
let running = false;

/** One sync pass for the signed-in user. Never throws; a failure just means "try again later". */
export async function runSync(userId: string): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const c = await getClient();
    if (!c) return 0;
    const r = await syncOnce(userId, idbLocal, supabaseRemote(c, userId, () => getSettings().keepTracksLocal), cursors, KINDS);
    return r.pulled;
  } catch { return 0; } finally { running = false; }
}

/** Syncs when the person signs in, when the app comes back to the front or the network returns, and every 2 minutes. Nothing runs while accounts are off or signed out. */
export function useSync(userId: string | null, onPulled: () => void, enabled: boolean = features.accounts) {
  const cb = useRef(onPulled);
  cb.current = onPulled;
  useEffect(() => {
    if (!enabled || !userId) return;
    const go = () => { if (navigator.onLine) runSync(userId).then((n) => { if (n) cb.current(); }); };
    go();
    const timer = setInterval(go, 120_000);
    const vis = () => { if (document.visibilityState === 'visible') go(); };
    window.addEventListener('online', go);
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(timer); window.removeEventListener('online', go); document.removeEventListener('visibilitychange', vis); };
  }, [enabled, userId]);
}
