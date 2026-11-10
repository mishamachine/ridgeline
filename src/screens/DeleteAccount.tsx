import { useState } from 'react';
import { PageHead } from '../components/PageHead';
import { getClient } from '../lib/accounts/client';
import { deleteMyAccount, type DeleteResult, type DeleteScope } from '../lib/accounts/auth';
import { useAccount } from '../lib/accounts/useAccount';
import { nativePlatform } from '../lib/native/platform';
import { appleDisconnectSentence, DELETION_TIMING, type Platform } from '../lib/accounts/copy';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { features } from '../lib/features';
import '../components/guestPrompt.css';

export const APPLE_MANUAL_LINE = 'To fully disconnect, also remove Ridgeline in your Apple ID settings › Sign in with Apple (appleid.apple.com).';

export const deleteCopy = (platform: Platform): Record<DeleteScope, { title: string; button: string; warn: string }> => ({
  data: {
    title: 'Delete my Ridgeline data',
    button: 'Delete my Ridgeline data',
    warn: `This removes your saved trails, hike history, routes and settings from our servers. This phone is signed out and its copies are removed. Other phones that are still signed in should be signed out too, or they may upload their copies again. A hike being recorded on another phone is kept there and uploads again when it ends. Your sign-in stays, so your other B&B apps keep working. ${DELETION_TIMING}`,
  },
  account: {
    title: 'Delete my whole account',
    button: 'Delete my whole account',
    warn: `This removes your sign-in and your data in Ridgeline, our language app (woof.bobolearns.com), the BoboLearns Hub sign-in, and any other B&B app you\u2019ve signed in to.${appleDisconnectSentence(platform)} This cannot be undone. Bobo Learns Chess doesn\u2019t use accounts; to delete its anonymous data, see chess.bobolearns.com/privacy/. ${DELETION_TIMING}`,
  },
});
/** Web and iOS wording (the default). */
export const COPY = deleteCopy('web');

export function resultText(scope: DeleteScope, r: DeleteResult): string {
  if (r.status === 'failed') return 'That did not go through, and nothing was deleted. Try again in a minute.';
  if (r.status === 'unconfirmed') return 'We couldn\u2019t confirm the delete. Try again.';
  if (r.status === 'reauth') return 'Sign in again to delete your account, then try again.';
  if (r.status === 'partial') return 'Your Ridgeline data was deleted, but we couldn\u2019t close your account. Try again.';
  if (scope === 'data') return `Your Ridgeline data was deleted from our servers, and this phone is signed out with its copies removed. Sign out your other phones too, or they may upload their copies again. ${DELETION_TIMING}`;
  const base = `Your account is deleted. ${DELETION_TIMING}`;
  if (r.apple === 'revoked') return base + ' We also disconnected Ridgeline from your Apple ID.';
  if (r.apple === 'manual') return base + ' ' + APPLE_MANUAL_LINE;
  return base;
}

/** /account/delete/ and (next PR) Profile › Account. Two choices, each with a confirm. */
export function DeleteAccount({ onBack, onSignIn }: { onBack: () => void; /** Opens the sign-in screen and returns here after. The delete page has no provider buttons of its own. */ onSignIn?: () => void }) {
  const acct = useAccount(features.accounts);   // deleting works while sign-in is paused, so this follows the build, not the pause flag
  const [ask, setAsk] = useState<DeleteScope | null>(null);
  const [result, setResult] = useState<{ scope: DeleteScope; r: DeleteResult } | null>(null);
  const [working, setWorking] = useState(false);

  const run = async (scope: DeleteScope) => {
    setAsk(null); setWorking(true);
    const c = getClient(features.accounts);
    const r: DeleteResult = c ? await deleteMyAccount(scope, await c) : { status: 'unconfirmed' };
    setResult({ scope, r }); setWorking(false);
  };
  const finished = result?.r.status === 'ok';
  const needsSignIn = !acct.signedIn || result?.r.status === 'reauth'; // a recent sign-in is required to close the whole account

  return (
    <div className="screen pf">
      <PageHead title="Delete account" sub="Optional. Ridgeline works without an account." />
      <div className="pf-body">
        {result && <p className="pf-note" role={result.r.status === 'ok' ? 'status' : 'alert'}>{resultText(result.scope, result.r)}</p>}
        {needsSignIn && !finished && (
          <>
            <p className="pf-note">Sign in to the account you want to delete.</p>
            <button className="pf-row" onClick={onSignIn}>Sign in</button>
          </>
        )}
        {acct.signedIn && !finished && result?.r.status !== 'reauth' && (
          <div className="pf-group">
            {(['data', 'account'] as const).map((s) => (
              <div key={s}>
                <button className="pf-row" disabled={working} onClick={() => setAsk(s)}>{deleteCopy(nativePlatform())[s].button}</button>
                <p className="pf-note" style={{ margin: 0 }}>{deleteCopy(nativePlatform())[s].warn}</p>
              </div>
            ))}
          </div>
        )}
        <button className="pf-link" onClick={onBack}>Back to Ridgeline</button>
      </div>
      {ask && <ConfirmSheet title={deleteCopy(nativePlatform())[ask].title} body={deleteCopy(nativePlatform())[ask].warn} confirmLabel={deleteCopy(nativePlatform())[ask].button} cancelLabel="Keep my account" danger onConfirm={() => run(ask)} onCancel={() => setAsk(null)} />}
    </div>
  );
}
