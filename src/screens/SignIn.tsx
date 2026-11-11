import { useState } from 'react';
import { PageHead } from '../components/PageHead';
import { ProviderButton } from '../components/ProviderButton';
import { features } from '../lib/features';
import { providersFor, signIn, type Provider, type ReturnTo } from '../lib/accounts/auth';
import { useAccountsState } from '../lib/accounts/flags';
import { DIFFERENT_ACCOUNT_MESSAGE, hadSession } from '../lib/accounts/session';
import { nativePlatform } from '../lib/native/platform';
import { GuestContinueDialog } from '../components/GuestContinueDialog';
import { guestNoteText, guestContinueTap, guestContinueClose } from '../lib/accounts/guestContinue';
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
  const [note, setNote] = useState(false);
  if (!allowed) return null;

  const go = async (p: Provider) => {
    setMsg('');
    const r = await signIn(p, features.accounts, returnTo);
    if (r.ok) { if (platform !== 'web') onDone(); return; }      // on the web the browser leaves for Apple or Google and comes back to the app
    if (r.reason === 'failed') setMsg('Sign-in did not work. Your hikes are still safe on this phone.');
    if (r.reason === 'different-account') setMsg(DIFFERENT_ACCOUNT_MESSAGE);
  };

  return (
    <div className="screen pf">
      <PageHead title="Sign in" sub={forDelete ? 'Sign in again to the account you want to delete.' : 'Optional. Keep your hikes if you lose or switch phones.'} />
      <div className="pf-body">
        <div className="gp-btns" style={{ padding: '4px 14px' }}>
          {providersFor(platform).map((p) => <ProviderButton key={p} provider={p} platform={platform} forDelete={forDelete} onClick={() => go(p)} />)}
        </div>
        {msg && <p className="pf-note" role="status">{msg}</p>}
        {forDelete
          ? <button className="pf-link" onClick={onBack}>Not now</button>
          : <>
              <div style={{ padding: '4px 14px 0' }}>
                <button className="btn btn-outline" style={{ width: '100%' }} onClick={() => guestContinueTap(undefined, onBack, () => setNote(true))}>Continue without an account</button>
              </div>
              <p className="pf-note" style={{ margin: 0, paddingTop: 8 }}>{guestNoteText(platform)}</p>
              {note && <GuestContinueDialog platform={platform} onClose={() => guestContinueClose(undefined, onBack)} />}
            </>}
      </div>
    </div>
  );
}
