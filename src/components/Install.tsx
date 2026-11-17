import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../lib/settings';
import { isNative } from '../lib/native/platform';
import { markInstalled } from '../lib/install';
import { listSaved } from '../lib/store';
import {
  ANDROID_STEPS, DESKTOP_LINE, IOS_NO_CARRY_LINE, showNoCarryLine, IN_APP_LINE, IOS_STEPS, INSTALL_BODY, hasInstallPrompt, installPlatform, isInAppBrowser, isStandalone,
  promptInstall, shouldShowInstallPopup, subscribeInstall, type InstallPlatform,
} from '../lib/pwa';
import { useSyncExternalStore } from 'react';
import './install.css';

export { INSTALL_BODY };

export const usePromptReady = () => useSyncExternalStore(subscribeInstall, hasInstallPrompt, () => false);

const ShareIcon = () => (
  <svg className="a2-share" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Share icon">
    <path d="M12 15V3M8 7l4-4 4 4" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  </svg>
);

/** True when this browser holds saved trails (read once when asked). */
function useHasSaved(active: boolean) {
  const [has, setHas] = useState(false);
  useEffect(() => { if (active) listSaved().then((l) => setHas(l.length > 0)).catch(() => {}); }, [active]);
  return has;
}

/** The manual steps for this device. */
export function InstallSteps({ platform, withLine = false }: { platform: InstallPlatform; withLine?: boolean }) {
  const has = useHasSaved(withLine && platform === 'ios');
  if (platform === 'ios') {
    return (
      <>
        <ol className="a2-steps">
          <li>{IOS_STEPS[0]} <ShareIcon /></li>
          <li>{IOS_STEPS[1]}</li>
          <li>{IOS_STEPS[2]}</li>
        </ol>
        {withLine && showNoCarryLine(platform, has) && <p className="a2-sub">{IOS_NO_CARRY_LINE}</p>}
      </>
    );
  }
  return <ol className="a2-steps">{ANDROID_STEPS.map((s) => <li key={s}>{s}</li>)}</ol>;
}

/** What the Profile row shows. */
export function InstallProfile() {
  const [open, setOpen] = useState(false);
  const ready = usePromptReady();
  const platform = installPlatform();
  if (isNative()) return null;
  const note = (t: string) => <p className="pf-note a2-note">{t}</p>;
  if (isStandalone()) return <div className="pf-row pf-static"><span>You&rsquo;re using Ridgeline from your home screen.</span></div>;
  if (isInAppBrowser()) return <><div className="pf-row pf-static"><span>Add to home screen</span></div>{note(IN_APP_LINE)}</>;
  if (platform === 'desktop') return <><div className="pf-row pf-static"><span>Add to home screen</span></div>{note(DESKTOP_LINE)}</>;
  return (
    <>
      <button className="pf-row" aria-expanded={open} onClick={() => setOpen((o) => !o)}><span>Add to home screen</span></button>
      {open && (
        <div className="a2-inline">
          {ready && <button className="pf-btn solid" onClick={async () => { if ((await promptInstall()) === 'accepted') markInstalled(); }}>Add</button>}
          {!ready && <InstallSteps platform={platform} withLine />}
        </div>
      )}
    </>
  );
}

let shownThisVisit = false;
/** The occasional pop-up: a small card above the tab bar. `busy` is true whenever a tab screen is not showing. */
export function InstallPopup({ busy }: { busy: boolean }) {
  const [s, update] = useSettings();
  const ready = usePromptReady();
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [visible, setVisible] = useState(false);
  const [steps, setSteps] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const platform = installPlatform();

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const eligible = shouldShowInstallPopup(s, {
    native: isNative(), standalone: isStandalone(), inApp: isInAppBrowser(), offline: !online, platform, busy, shownThisVisit: shownThisVisit && !visible,
  }, Date.now());

  useEffect(() => {
    if (!eligible || visible) return;
    shownThisVisit = true;
    opener.current = document.activeElement as HTMLElement | null;
    update({ installLastShown: Date.now() });
    setVisible(true);
  }, [eligible, visible, update]);
  useEffect(() => { if (visible) card.current?.focus(); }, [visible]);

  if (!visible || busy || !online) return null;
  const close = (dismissed: boolean) => {
    if (dismissed) update({ installDismissals: s.installDismissals + 1 });
    setVisible(false);
    opener.current?.focus?.();
  };
  const add = async () => {
    if (platform !== 'ios' && ready) { if ((await promptInstall()) === 'accepted') markInstalled(); close(false); }
    else setSteps(true);
  };
  return (
    <div className="a2-card" role="region" aria-label="Add Ridgeline to your home screen" ref={card} tabIndex={-1}>
      <button className="a2-x" aria-label="Close" onClick={() => close(true)}>&times;</button>
      <p className="a2-title">Add Ridgeline to your home screen</p>
      {steps && <InstallSteps platform={platform} withLine />}
      <div className="a2-btns">
        {steps
          ? <button className="a2-btn solid" onClick={() => close(false)}>Got it</button>
          : <>
              <button className="a2-btn solid" onClick={add}>Add</button>
              <button className="a2-btn" onClick={() => close(true)}>Not now</button>
            </>}
      </div>
    </div>
  );
}
