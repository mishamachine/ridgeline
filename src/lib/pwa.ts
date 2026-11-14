import { isNative } from './native/platform';

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1); // iPadOS reports as a Mac

/** Detail and Saved show this on iPhone. // pending legal re-check */
export const A2HS_TIP = 'On iPhone, tap Share, then Add to Home Screen.';
/** iPhone and iPad only, and only when this browser holds saved trails: home-screen apps keep their own storage. */
export const IOS_NO_CARRY_LINE = 'Trails saved here won\u2019t move to the home-screen app. Save them again there.';

export type InstallPlatform = 'ios' | 'android' | 'desktop';
const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|Messenger|Snapchat|MicroMessenger|LinkedInApp|Pinterest|TikTok|musical_ly|Twitter|\bLine\/|; wv\)/i;
/** Facebook, Instagram, Gmail-style and other in-app browsers cannot install a web app. */
export const isInAppBrowser = (ua = navigator.userAgent) => IN_APP.test(ua);
export function installPlatform(ua = navigator.userAgent): InstallPlatform {
  if (isIOS()) return 'ios';
  return /Android/i.test(ua) ? 'android' : 'desktop';
}

export const IOS_STEPS = ['Tap Share', 'Tap Add to Home Screen', 'Tap Add'];
export const ANDROID_STEPS = ['Tap the ⋮ menu', 'Tap Add to Home screen or Install app'];
export const IN_APP_LINE = 'Open Ridgeline in Safari or Chrome to add it to your home screen.';
export const DESKTOP_LINE = 'Use your browser’s Install option to keep Ridgeline in your dock or taskbar.';
export const INSTALL_BODY = 'Open it like an app, without the browser bars, with your saved maps one tap away.';

// --- The browser's own install prompt (Chromium on Android): held until the person taps our button. ---
interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let deferred: InstallEvent | null = null;
const subs = new Set<() => void>();
const ping = () => subs.forEach((f) => f());
export const subscribeInstall = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const hasInstallPrompt = () => deferred !== null;
/** Fires the system prompt. Resolves 'unavailable' when the browser never offered one. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const d = deferred;
  if (!d) return 'unavailable';
  deferred = null; ping();
  try { await d.prompt(); return (await d.userChoice).outcome; } catch { return 'dismissed'; }
}
/** Call once at start-up (web only). */
export function initInstallCapture(onInstalled: () => void) {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallEvent; ping(); });
  window.addEventListener('appinstalled', () => { deferred = null; ping(); onInstalled(); });
}

// --- When the pop-up may show (pure, so it can be tested with a fake clock). ---
export const POPUP_GAP_MS = 14 * 24 * 3600 * 1000;
export const POPUP_MAX_DISMISSALS = 2;
export const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export interface PopupState { installDismissals: number; installLastShown: number; installDone: boolean; installSessions: number; installDays: string[] }
export interface PopupContext {
  native: boolean; standalone: boolean; inApp: boolean; offline: boolean; platform: InstallPlatform;
  /** Navigate or Record is running, the tab bar is hidden, or a first-screen (shared link, tour) is up. */
  busy: boolean;
  shownThisVisit: boolean;
}

/** Records one app launch: the session count and the distinct days. */
export function recordVisit(s: PopupState, now: number): Pick<PopupState, 'installSessions' | 'installDays'> {
  const k = dayKey(now);
  return { installSessions: s.installSessions + 1, installDays: s.installDays.includes(k) ? s.installDays : [...s.installDays, k].slice(-3) };
}

export function shouldShowInstallPopup(s: PopupState, c: PopupContext, now: number): boolean {
  if (c.native || c.standalone || c.inApp || c.offline || c.busy || c.shownThisVisit || c.platform === 'desktop') return false;
  if (s.installDone || s.installDismissals >= POPUP_MAX_DISMISSALS) return false;
  if (s.installSessions <= 1) return false; // never in the first session
  if (s.installLastShown && now - s.installLastShown < POPUP_GAP_MS) return false;
  return s.installDays.length >= 3; // the 3rd separate day of use; onboarding is the main surface
}

/** Whether the "won't move" line shows: iPhone/iPad only, and only when this browser has saved trails. */
export const showNoCarryLine = (platform: InstallPlatform, hasSavedTrails: boolean) => platform === 'ios' && hasSavedTrails;
