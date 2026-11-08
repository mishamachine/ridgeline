import { useState } from 'react';
import { useAccountsState } from '../lib/accounts/flags';
import { signIn, signOutKeeping, providersFor, type Provider } from '../lib/accounts/auth';
import { useAccount } from '../lib/accounts/useAccount';
import { nativePlatform } from '../lib/native/platform';
import { ProviderButton } from './ProviderButton';
import './guestPrompt.css';

/** Profile › Account: guest banner, sign in / out, and both delete options. Renders nothing while features.accounts is off. */
export const PAUSED_NOTE = 'Sign-in is paused for now. Your hikes are safe on this phone.';

export function AccountRow({ enabled, onOpenDelete }: { enabled?: boolean; onOpenDelete?: () => void }) {
  const state = useAccountsState(undefined, enabled);   // `enabled` forces on/off in tests and previews
  const live = state === 'live';
  const acct = useAccount(live);
  const [msg, setMsg] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [choosing, setChoosing] = useState(false);
  if (state === 'off' || state === 'unknown') return null;
  if (state === 'paused') return <p className="pf-note pf-static" role="status" style={{ margin: 0, paddingTop: 8 }}>{PAUSED_NOTE}</p>;

  const go = async (p: Provider) => {
    setMsg('');
    const r = await signIn(p, live);
    if (!r.ok && r.reason === 'failed') setMsg('Sign-in did not work. You can keep using Ridgeline without an account.');
  };

  if (acct.signedIn && leaving) {
    return (
      <div className="pf-static" role="group" aria-label="Sign out">
        <p className="pf-note" style={{ margin: 0 }}>Keep a copy of your hikes on this phone?</p>
        <button className="pf-row" onClick={() => signOutKeeping(true, live)}>Keep a copy</button>
        <button className="pf-row" onClick={() => signOutKeeping(false, live)}>Remove from this phone</button>
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
      <div className="pf-row pf-static">
        <span>Not signed in. Your hikes are saved only on this phone.</span>
        {!choosing && <button className="pf-link" onClick={() => setChoosing(true)}>Sign in</button>}
      </div>
      {choosing && (
        <div className="gp-btns" style={{ padding: '4px 14px 12px' }}>
          {providersFor(nativePlatform()).map((p) => <ProviderButton key={p} provider={p} onClick={() => go(p)} />)}
        </div>
      )}
      {msg && <p className="pf-note" role="status" style={{ margin: 0 }}>{msg}</p>}
    </div>
  );
}
