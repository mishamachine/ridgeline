import { useEffect, useState } from 'react';
import { accountsLive } from './flags';
import { getClient } from './client';
import { markSession } from './session';

export interface Account { signedIn: boolean; email: string | null; provider: 'google' | 'apple' | null; userId: string | null }
const GUEST: Account = { signedIn: false, email: null, provider: null, userId: null };

/** Remembers the account on this phone, but ONLY while sign-in is live: a paused sign-in must never make itself the "known" account. */
export const rememberUser = (userId: string, live: boolean = accountsLive()): void => { if (live) markSession(userId); };

/** Who is signed in. A permanent guest, with no network and no import, while features.accounts is off. */
export function useAccount(enabled: boolean = accountsLive()): Account {
  const [acct, setAcct] = useState<Account>(GUEST);
  useEffect(() => {
    const p = getClient(enabled);
    if (!p) { setAcct(GUEST); return; }
    let off = () => {};
    let live = true;
    p.then((c) => {
      const set = (u: { id: string; email?: string; app_metadata?: { provider?: string } } | undefined) => {
        if (u) rememberUser(u.id);
        if (live) setAcct(u ? { signedIn: true, userId: u.id, email: u.email ?? null, provider: u.app_metadata?.provider === 'apple' ? 'apple' : 'google' } : GUEST);
      };
      c.auth.getSession().then(({ data }) => set(data.session?.user));
      const { data } = c.auth.onAuthStateChange((_e, s) => set(s?.user));
      off = () => data.subscription.unsubscribe();
    }).catch(() => {});
    return () => { live = false; off(); };
  }, [enabled]);
  return acct;
}
