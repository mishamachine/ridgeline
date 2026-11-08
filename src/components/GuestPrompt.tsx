import { useEffect, useState } from 'react';
import { features } from '../lib/features';
import { getSettings } from '../lib/settings';
import { signIn, providersFor } from '../lib/accounts/auth';
import { useAccount } from '../lib/accounts/useAccount';
import { canShow, dismiss, loadPromptState, markShown, savePromptState, type PromptKind } from '../lib/accounts/prompt';
import { nativePlatform } from '../lib/native/platform';
import './guestPrompt.css';

export interface GuestPromptProps {
  /** Which prompt kinds this card stands for. */
  kinds: PromptKind[];
  /** Becomes true at the moment worth keeping (a trail was saved, a hike finished, a badge earned). */
  trigger: boolean;
  /** A hike is being recorded or navigated: never show. */
  hikeActive?: boolean;
  tone?: 'light' | 'dark';
  enabled?: boolean;
}

/** A soft card, not a modal: it never blocks the map or the share button. Renders nothing while accounts are off. */
export function GuestPrompt({ kinds, trigger, hikeActive = false, tone = 'light', enabled = features.accounts }: GuestPromptProps) {
  const acct = useAccount(enabled);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!trigger || open) return;
    let st: Storage | null = null;
    try { st = localStorage; } catch { /* blocked */ }
    if (!st) return;
    const state = loadPromptState(st);
    if (!canShow(kinds, state, { accountsOn: enabled, signedIn: acct.signedIn, onboardingDone: getSettings().onboardingSeen, hikeActive })) return;
    savePromptState(st, markShown(state, kinds));
    setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  if (!enabled || !open || acct.signedIn || hikeActive) return null;
  const notNow = () => { try { savePromptState(localStorage, dismiss(loadPromptState(localStorage))); } catch { /* ignore */ } setOpen(false); };
  const go = async (p: 'apple' | 'google') => { const r = await signIn(p, enabled); if (!r.ok && r.reason === 'failed') setFailed(true); };

  return (
    <section className={`gp gp-${tone}`} aria-labelledby="gp-h">
      <h2 id="gp-h">Keep your hikes safe</h2>
      <p>Right now your saved trails and hikes live only on this phone. Sign in to keep them if you lose or switch phones.</p>
      <div className="gp-btns">
        {providersFor(nativePlatform()).map((p) => <button key={p} className="gp-btn" onClick={() => go(p)}>{p === 'apple' ? 'Continue with Apple' : 'Continue with Google'}</button>)}
      </div>
      {failed && <p role="status" className="gp-fail">Sign-in did not work. Your hikes are still safe on this phone.</p>}
      <button className="gp-later" onClick={notNow}>Not now</button>
    </section>
  );
}
