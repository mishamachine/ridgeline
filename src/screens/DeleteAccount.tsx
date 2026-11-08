import { useState } from 'react';
import { PageHead } from '../components/PageHead';
import { getClient } from '../lib/accounts/client';
import { deleteMyAccount, signIn, providersFor, type DeleteScope } from '../lib/accounts/auth';
import { useAccount } from '../lib/accounts/useAccount';
import { wipeLocalAccountData } from '../lib/sync/local';
import { nativePlatform } from '../lib/native/platform';
import { ConfirmSheet } from '../components/ConfirmSheet';

const COPY: Record<DeleteScope, { title: string; button: string; warn: string }> = {
  data: {
    title: 'Delete my Ridgeline data',
    button: 'Delete my Ridgeline data',
    warn: 'This removes your saved trails, hike history, routes and settings from our servers. Your sign-in stays, so your other B&B and Bobo Learns apps keep working. Hikes on this phone are not touched.',
  },
  account: {
    title: 'Delete my whole account',
    button: 'Delete my whole account',
    warn: 'This removes your sign-in and the data of every app that uses it (Ridgeline, Ruffspeak, Chess Tutor, BoboLearns Hub and others). If you signed in with Apple, we also disconnect Ridgeline from your Apple ID. This cannot be undone.',
  },
};

/** /account/delete/ and (next PR) Profile › Account. Two choices, each with a confirm. */
export function DeleteAccount({ onBack }: { onBack: () => void }) {
  const acct = useAccount();
  const [ask, setAsk] = useState<DeleteScope | null>(null);
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'failed'>('idle');
  const [doneScope, setDoneScope] = useState<DeleteScope>('data');

  const run = async (scope: DeleteScope) => {
    setAsk(null); setState('working');
    const c = await getClient();
    const ok = c ? await deleteMyAccount(scope, await c) : false;
    if (ok && scope === 'account') await wipeLocalAccountData(); // the account is gone; so are its records here
    setDoneScope(scope); setState(ok ? 'done' : 'failed');
  };

  return (
    <div className="screen pf">
      <PageHead title="Delete account" sub="Optional. Ridgeline works without an account." />
      <div className="pf-body">
        {state === 'done' && <p className="pf-note" role="status">{doneScope === 'account' ? 'Your account is deleted. Backup copies are erased within 7 days.' : 'Your Ridgeline data is deleted from our servers.'}</p>}
        {state === 'failed' && <p className="pf-note" role="alert">That did not go through, and nothing was deleted. Try again in a minute.</p>}
        {!acct.signedIn && state !== 'done' && (
          <>
            <p className="pf-note">Sign in to the account you want to delete.</p>
            {providersFor(nativePlatform()).map((p) => <button key={p} className="pf-row" onClick={() => signIn(p)}>{p === 'apple' ? 'Continue with Apple' : 'Continue with Google'}</button>)}
          </>
        )}
        {acct.signedIn && state !== 'done' && (
          <div className="pf-group">
            {(['data', 'account'] as const).map((s) => (
              <div key={s}>
                <button className="pf-row" disabled={state === 'working'} onClick={() => setAsk(s)}>{COPY[s].button}</button>
                <p className="pf-note" style={{ margin: 0 }}>{COPY[s].warn}</p>
              </div>
            ))}
          </div>
        )}
        <button className="pf-link" onClick={onBack}>Back to Ridgeline</button>
      </div>
      {ask && <ConfirmSheet title={COPY[ask].title} body={COPY[ask].warn} confirmLabel={COPY[ask].button} cancelLabel="Keep my account" danger onConfirm={() => run(ask)} onCancel={() => setAsk(null)} />}
    </div>
  );
}
