import { useEffect, useState } from 'react';
import { useAccountsState } from '../lib/accounts/flags';
import { getSettings } from '../lib/settings';
import { useAccount } from '../lib/accounts/useAccount';
import { canShow, dismiss, loadPromptState, markShown, savePromptState, type PromptKind } from '../lib/accounts/prompt';
import './guestPrompt.css';
import { thisDevice } from '../lib/native/deviceWord';

/** Final copy. A shared card (first hike that also earns the first badge) uses the hike headline. */
export const PROMPT_HEADLINE: Record<PromptKind, string> = { save: 'Keep your saved trails', hike: 'Keep this hike', badge: 'Keep your badges' };
export const promptBody = (platform?: 'ios' | 'android' | 'web') => `Right now they're saved only on ${thisDevice(platform)}. Sign in to keep them if you lose or switch phones.`;
const headlineFor = (kinds: PromptKind[]) => PROMPT_HEADLINE[kinds.includes('hike') ? 'hike' : kinds[0]];

export interface GuestPromptProps {
  /** Which prompt kinds this card stands for. */
  kinds: PromptKind[];
  /** Becomes true at the moment worth keeping (a trail was saved, a hike finished, a badge earned). */
  trigger: boolean;
  /** A hike is being recorded or navigated: never show. */
  hikeActive?: boolean;
  tone?: 'light' | 'dark';
  /** Sits in a page list: the card carries its own margin, so nothing is left behind when it is not shown. */
  inList?: boolean;
  enabled?: boolean;
  /** Opens the sign-in screen. The card has no provider buttons of its own. */
  onSignIn?: () => void;
  /** Previews and tests: start with the card showing. */
  initialOpen?: boolean;
}

/** A soft card, not a modal: it never blocks the map or the share button. Renders nothing while accounts are off. */
export function GuestPrompt({ kinds, trigger, hikeActive = false, tone = 'light', inList = false, enabled, onSignIn, initialOpen = false }: GuestPromptProps) {
  const live = useAccountsState(undefined, enabled) === 'live';   // paused or unknown: the card never shows
  const acct = useAccount(live);
  const [open, setOpen] = useState(initialOpen);

  useEffect(() => {
    if (!trigger || open) return;
    let st: Storage | null = null;
    try { st = localStorage; } catch { /* blocked */ }
    if (!st) return;
    const state = loadPromptState(st);
    if (!canShow(kinds, state, { accountsOn: live, signedIn: acct.signedIn, onboardingDone: getSettings().onboardingSeen, hikeActive })) return;
    savePromptState(st, markShown(state, kinds));
    setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  if (!live || !open || acct.signedIn || hikeActive) return null;
  const notNow = () => { try { savePromptState(localStorage, dismiss(loadPromptState(localStorage))); } catch { /* ignore */ } setOpen(false); };

  return (
    <section className={`gp gp-${tone}${inList ? ' gp-in-list' : ''}`} aria-labelledby="gp-h">
      <h2 id="gp-h">{headlineFor(kinds)}</h2>
      <p>{promptBody()}</p>
      <button className="gp-signin" onClick={onSignIn}>Sign in</button>
      <button className="gp-later" onClick={notNow}>Not now</button>
    </section>
  );
}
