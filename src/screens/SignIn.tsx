import { useState } from 'react';
import { PageHead } from '../components/PageHead';
import { ProviderButton } from '../components/ProviderButton';
import { features } from '../lib/features';
import { providersFor, signIn, type Provider, type ReturnTo } from '../lib/accounts/auth';
import { useAccountsState } from '../lib/accounts/flags';
import { hadSession } from '../lib/accounts/session';
import { nativePlatform } from '../lib/native/platform';
import '../components/guestPrompt.css';

/**
 * THE sign-in screen: the only place the Apple and Google buttons exist (so Apple's web script is only ever requested here).
 * Prompts, Profile and the delete page just open it. While sign-in is paused it is reachable only from the delete flow (`returnTo`), to confirm who is deleting.
 */
export function SignIn({ returnTo, onDone, onBack, platform = nativePlatform() }: { returnTo?: ReturnTo; onDone: () => void; onBack: () => void; platform?: 'ios' | 'android' | 'web' }) {
  const state = useAccountsState();
  const forDelete = returnTo === 'account-delete';
  const allowed = state === 'live' || (forDelete && features.accounts && hadSession());
  const [msg, setMsg] = useState('');
  if (!allowed) return null;

  const go = async (p: Provider) => {
    setMsg('');
    const r = await signIn(p, features.accounts, returnTo);
    if (r.ok) { if (platform !== 'web') onDone(); return; }      // on the web the browser leaves for Apple or Google and comes back to the app
    if (r.reason === 'failed') setMsg('Sign-in did not work. Your hikes are still safe on this phone.');
  };

  return (
    <div className="screen pf">
      <PageHead title="Sign in" sub={forDelete ? 'Sign in again to the account you want to delete.' : 'Optional. Keep your hikes if you lose or switch phones.'} />
      <div className="pf-body">
        <div className="gp-btns" style={{ padding: '4px 14px' }}>
          {providersFor(platform).map((p) => <ProviderButton key={p} provider={p} platform={platform} forDelete={forDelete} onClick={() => go(p)} />)}
        </div>
        {msg && <p className="pf-note" role="status">{msg}</p>}
        <button className="pf-link" onClick={onBack}>Not now</button>
      </div>
    </div>
  );
}
