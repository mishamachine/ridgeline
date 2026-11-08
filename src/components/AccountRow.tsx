import { useState } from 'react';
import { features } from '../lib/features';
import { signIn, signOutKeeping, providersFor, type Provider } from '../lib/accounts/auth';
import { useAccount } from '../lib/accounts/useAccount';
import { nativePlatform } from '../lib/native/platform';

const LABEL: Record<Provider, string> = { apple: 'Continue with Apple', google: 'Continue with Google' };

/** Profile › Account: guest banner, sign in / out, and both delete options. Renders nothing while features.accounts is off. */
export function AccountRow({ enabled = features.accounts, onOpenDelete }: { enabled?: boolean; onOpenDelete?: () => void }) {
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
      <div className="pf-static" aria-label="Account: signed in">
        <div className="pf-row pf-static">
          <span>Signed in with {acct.provider === 'apple' ? 'Apple' : 'Google'}{acct.email ? ` · ${acct.email}` : ''}</span>
          <button className="pf-link" onClick={() => setLeaving(true)}>Sign out</button>
        </div>
        {onOpenDelete && <button className="pf-row" onClick={onOpenDelete}>Delete my Ridgeline data</button>}
        {onOpenDelete && <button className="pf-row" onClick={onOpenDelete}>Delete my whole account</button>}
      </div>
    );
  }
  return (
    <div className="pf-static" aria-label="Account: not signed in, optional">
      <div className="pf-row pf-static"><span>Account</span><span className="val">Not signed in · optional</span></div>
      <p className="pf-note pf-static" style={{ margin: 0, paddingTop: 8 }}>Signed out: your hikes live only on this phone.</p>
      {providersFor(nativePlatform()).map((p) => (
        <button key={p} className="pf-row" onClick={() => go(p)}>{LABEL[p]}</button>
      ))}
      {msg && <p className="pf-note" role="status" style={{ margin: 0 }}>{msg}</p>}
    </div>
  );
}
