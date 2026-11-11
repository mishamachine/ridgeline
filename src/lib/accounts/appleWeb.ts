// Apple's own "Sign in with Apple" JS button for the WEB version. The script comes from Apple's CDN, is loaded ONLY when the web sign-in screen
// shows the Apple button (accounts live), never on page load anywhere else, and never in the iOS or Android apps (iOS uses the system button).
// This is the only place the URL appears. Loading it contacts Apple (IP address and page address), so the privacy text must name it.
import { accountsLive } from './flags';

export const APPLE_JS_URL = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

let loading: Promise<void> | null = null;

/**
 * Adds Apple's script tag once, and only while accounts are live (built in AND the runtime flag on, so never while paused or with the flag off).
 * Resolves when it has loaded; rejects (quietly for the caller) if it must not or cannot load.
 */
export function loadAppleScript(doc: Document = document, live: boolean = accountsLive()): Promise<void> {
  if (!live) return Promise.reject(new Error('accounts are not live'));
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const s = doc.createElement('script');
    s.src = APPLE_JS_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; s.remove(); reject(new Error('apple script')); };
    doc.head.appendChild(s);
  });
  return loading;
}

/** Asks Apple's script to draw the button into the page (the markup carries the options: type "sign-in", colour, size). */
export function renderAppleButton(): void {
  (globalThis as { AppleID?: { auth?: { renderButton?: () => void } } }).AppleID?.auth?.renderButton?.();
}

/** Test helper: forget that the script was added. */
export function resetAppleScriptForTests() { loading = null; }
