import { useState } from 'react';
import { useAccountsState } from '../lib/accounts/flags';
import { signOutKeeping } from '../lib/accounts/auth';
import { useFullNotes } from '../lib/sync/fullNote';
import { clearNotNow, setOwnerPending, useOwnerPending } from '../lib/sync/ownerPending';
import { resolveOwnerMismatch } from '../lib/sync/useSync';
import { useAccount, type Account } from '../lib/accounts/useAccount';
import './guestPrompt.css';

/** Profile › Account: guest banner, sign in / out, and both delete options. Renders nothing while features.accounts is off. */
export const PAUSED_NOTE = 'Sign-in is paused for now. Your hikes are safe on this phone.';

export function AccountRow({ enabled, build, onOpenDelete, onSignIn, account, fullNote, ownerPending, onOwnerResolved }: { enabled?: boolean; build?: boolean; onOpenDelete?: () => void; /** Opens the sign-in screen (the row has no provider buttons of its own). */ onSignIn?: () => void; /** Tests and previews: who is signed in. */ account?: Account; /** Tests and previews: the account-full notes to show. */ fullNote?: string[]; /** Tests and previews: the account with a waiting owner choice. */ ownerPending?: string | null; onOwnerResolved?: () => void }) {
  const state = useAccountsState(build, enabled);   // `enabled` forces on/off in tests and previews
  const live = state === 'live';
  // While paused the session is still read (never synced), so the person can still delete their data or their account.
  const read = useAccount(live || state === 'paused');
  const acct = account ?? read;
  const fullHook = useFullNotes(acct.userId);
  const fullNotes = fullNote ?? fullHook;                      // one time only per account: a note never comes back after it was shown
  const pendingHook = useOwnerPending();
  const pendingOwner = ownerPending !== undefined ? ownerPending : pendingHook;
  const [leaving, setLeaving] = useState(false);
  if (state === 'off' || state === 'unknown') return null;
  if (state === 'paused') {
    return (
      <div className="pf-static" aria-label="Account: sign-in paused">
        <p className="pf-note pf-static" role="status" style={{ margin: 0, paddingTop: 8 }}>{PAUSED_NOTE}</p>
        {acct.signedIn && onOpenDelete && <button className="pf-row" onClick={onOpenDelete}>Delete my Ridgeline data</button>}
        {acct.signedIn && onOpenDelete && <button className="pf-row" onClick={onOpenDelete}>Delete my whole account</button>}
      </div>
    );
  }

  if (acct.signedIn && leaving) {
    return (
      <div className="pf-static" role="group" aria-label="Sign out">
        <p className="pf-note" style={{ margin: 0 }}>Keep a copy of your hikes on this phone? A kept copy can be added to whichever account signs in next.</p>
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
        {fullNotes.map((t) => <p key={t} className="pf-note" role="status" style={{ margin: 0 }}>{t}</p>)}
        {pendingOwner && pendingOwner === acct.userId && (
          <div role="group" aria-label="Hikes from another account">
            <p className="pf-note" role="status" style={{ margin: 0 }}>This phone still has saved trails and hikes from another account, so nothing is syncing yet. Add them to this account, or remove them from this phone?</p>
            <button className="pf-row" onClick={() => { const u = acct.userId!; clearNotNow(u); resolveOwnerMismatch(u, 'add').then(() => { setOwnerPending(null); onOwnerResolved?.(); }); }}>Add them to this account</button>
            <button className="pf-row" onClick={() => { const u = acct.userId!; clearNotNow(u); resolveOwnerMismatch(u, 'remove').then(() => { setOwnerPending(null); onOwnerResolved?.(); }); }}>Remove them from this phone</button>
          </div>
        )}
        {onOpenDelete && <button className="pf-row" onClick={onOpenDelete}>Delete my Ridgeline data</button>}
        {onOpenDelete && <button className="pf-row" onClick={onOpenDelete}>Delete my whole account</button>}
      </div>
    );
  }
  return (
    <div className="pf-static" aria-label="Account: not signed in, optional">
      <div className="pf-row pf-static">
        <span>Not signed in. Your hikes are saved only on this phone.</span>
        <button className="pf-link" onClick={onSignIn}>Sign in</button>
      </div>
    </div>
  );
}
