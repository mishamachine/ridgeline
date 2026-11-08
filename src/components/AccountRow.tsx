import { useState } from 'react';
import { features } from '../lib/features';
import { signIn, signOutKeeping, providersFor, type Provider } from '../lib/accounts/auth';
import { useAccount } from '../lib/accounts/useAccount';
import { nativePlatform } from '../lib/native/platform';

const LABEL: Record<Provider, string> = { apple: 'Continue with Apple', google: 'Continue with Google' };

/** Sign in / sign out in Profile. Renders nothing while features.accounts is off. The full Account screen comes in a later PR. */
export function AccountRow({ enabled = features.accounts }: { enabled?: boolean }) {
  const acct = useAccount(enabled);
  const [msg, setMsg] = useState('');
  const [leaving, setLeaving] = useState(false);
  if (!enabled) return null;

  const go = async (p: Provider) => {
    setMsg('');
    const r = await signIn(p, enabled);
    if (!r.ok && r.reason === 'failed') setMsg('Sign-in did not work. You can keep using Ridgeline without an account.');
  };

  if (acct.signedIn && leaving) {
    return (
      <div className="pf-static" role="group" aria-label="Sign out">
        <p className="pf-note" style={{ margin: 0 }}>Keep a copy of your hikes on this phone?</p>
        <button className="pf-row" onClick={() => signOutKeeping(true, enabled)}>Keep a copy</button>
        <button className="pf-row" onClick={() => signOutKeeping(false, enabled)}>Remove from this phone</button>
        <button className="pf-link" onClick={() => setLeaving(false)}>Stay signed in</button>
      </div>
    );
  }
  if (acct.signedIn) {
    return (
      <div className="pf-row pf-static" aria-label="Account: signed in">
        <span>Signed in with {acct.provider === 'apple' ? 'Apple' : 'Google'}{acct.email ? ` · ${acct.email}` : ''}</span>
        <button className="pf-link" onClick={() => setLeaving(true)}>Sign out</button>
      </div>
    );
  }
  return (
    <div className="pf-static" aria-label="Account: not signed in, optional">
      <div className="pf-row pf-static"><span>Account</span><span className="val">Not signed in · optional</span></div>
      {providersFor(nativePlatform()).map((p) => (
        <button key={p} className="pf-row" onClick={() => go(p)}>{LABEL[p]}</button>
      ))}
      {msg && <p className="pf-note" role="status" style={{ margin: 0 }}>{msg}</p>}
    </div>
  );
}
