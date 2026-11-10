import { useEffect, useRef, useState } from 'react';
import { AppleButton as NativeAppleButton } from '../lib/native/appleButtonPlugin';
import { loadAppleScript, renderAppleButton } from '../lib/accounts/appleWeb';
import { accountsLive } from '../lib/accounts/flags';
import { features } from '../lib/features';
import { OVERLAY_EVENT } from '../lib/overlayEvents';

export interface AppleButtonProps {
  platform: 'ios' | 'android' | 'web'; tone: 'light' | 'dark'; width: number; height: number; onClick: () => void;
  /** The screen showing the button is visible (not behind another screen). The button also checks for itself. */
  visible?: boolean;
  /** The delete page: signing in again is how people close their account, so Apple's script may load even while sign-in is paused. */
  forDelete?: boolean;
}

export const APPLE_LABEL = 'Sign in with Apple';

/**
 * Sign in with Apple, drawn by Apple and never by us:
 *   iOS      the system button (ASAuthorizationAppleIDButton, type signIn) laid over a placeholder, through the local plugin (not device-tested)
 *   web      Apple's JS button (data-type "sign-in"), script loaded only now that this screen shows it; a click or key press is handed to our own sign-in
 *   android  nothing (Android offers Google only)
 */
export function AppleButton(p: AppleButtonProps) {
  if (p.platform === 'android') return null;
  return p.platform === 'ios' ? <IosButton {...p} /> : <WebButton {...p} />;
}

/** Enter and Space on the wrapper act like a click: taken before Apple's own handler and handed to our sign-in. Returns true if it handled the key. */
export function handleAppleKey(e: { key: string; stopPropagation(): void; preventDefault(): void }, act: () => void): boolean {
  if (e.key !== 'Enter' && e.key !== ' ') return false;
  e.stopPropagation(); e.preventDefault(); act();
  return true;
}

let nextToken = 0;
export const newToken = () => `apple-${++nextToken}-${Math.random().toString(36).slice(2, 8)}`;

/** True when the placeholder is really on screen and nothing (a sheet, another screen) is drawn over its middle. */
export function placeholderShowing(el: HTMLElement | null, doc?: Document): boolean {
  const d = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!el || !d) return false;
  if (el.offsetParent === null || d.visibilityState === 'hidden') return false;
  const r = el.getBoundingClientRect();
  const vw = d.defaultView?.innerWidth ?? 0, vh = d.defaultView?.innerHeight ?? 0;
  if (r.width <= 0 || r.height <= 0 || r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) return false;
  // Nothing may be drawn over ANY part of it: the centre and all four corners (inset 2 px) must belong to the placeholder.
  const pts: [number, number][] = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 2, r.top + 2], [r.right - 2, r.top + 2], [r.left + 2, r.bottom - 2], [r.right - 2, r.bottom - 2]];
  return pts.every(([x, y]) => { const top = d.elementFromPoint(x, y); return !!top && (top === el || el.contains(top)); });
}

function IosButton({ tone, width, height, onClick, visible = true }: AppleButtonProps) {
  const ref = useRef<HTMLDivElement>(null);
  const token = useRef(newToken()).current;
  const click = useRef(onClick); click.current = onClick;
  useEffect(() => {
    let off = false, raf = 0, shown = false;
    const place = () => {
      raf = 0;
      if (off) return;
      const el = ref.current;
      if (!visible || !placeholderShowing(el)) {
        if (shown) { shown = false; NativeAppleButton.hide({ token }).catch(() => {}); }   // hidden whenever the placeholder is not really visible
        return;
      }
      const r = el!.getBoundingClientRect();
      shown = true;
      NativeAppleButton.show({ token, x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height, dark: tone === 'dark' }).catch(() => {});
    };
    const queue = () => { if (!raf) raf = requestAnimationFrame(place); };
    place();
    window.addEventListener('resize', queue);
    document.addEventListener('scroll', queue, true);          // any scroll container moves the placeholder
    document.addEventListener('visibilitychange', queue);
    const io = typeof IntersectionObserver !== 'undefined' && ref.current ? new IntersectionObserver(queue) : null;
    if (io && ref.current) io.observe(ref.current);
    const poll = setInterval(queue, 300);                       // a sheet opening over the button fires no event of its own
    const tap = NativeAppleButton.addListener('tap', (e) => { if (!e?.token || e.token === token) click.current(); });
    // Any sheet or modal opening hides the native button at once, in the same tick (the poll above is only a safety net).
    const cover = () => { if (shown) { shown = false; NativeAppleButton.hide({ token }).catch(() => {}); } };
    window.addEventListener(OVERLAY_EVENT, cover);
    return () => {
      off = true; if (raf) cancelAnimationFrame(raf);
      clearInterval(poll); io?.disconnect(); window.removeEventListener(OVERLAY_EVENT, cover);
      window.removeEventListener('resize', queue); document.removeEventListener('scroll', queue, true); document.removeEventListener('visibilitychange', queue);
      tap.then((h) => h.remove()).catch(() => {});
      NativeAppleButton.hide({ token }).catch(() => {});        // only hides the button if this screen still owns it
    };
  }, [tone, width, height, visible, token]);
  return <div ref={ref} aria-hidden="true" data-apple-button="ios" style={{ width, height }} />;
}

// Apple's script looks for its button by the id "appleid-signin", so only one element may carry it, and only while it renders.
let renderChain: Promise<void> = Promise.resolve();
let webSeq = 0;
const tabbable = 'button, a, [tabindex], [role="button"], input';

function WebButton({ tone, width, height, onClick, forDelete }: AppleButtonProps) {
  const slot = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const id = useRef(`appleid-signin-${++webSeq}`).current;
  const click = useRef(onClick); click.current = onClick;
  useEffect(() => {
    let off = false;
    const tidy = () => {
      const el = slot.current;
      if (!el) return false;
      // our wrapper is the one tab stop: Apple's inner elements, and the container itself if Apple made it focusable, leave the tab order
      [el, ...Array.from(el.querySelectorAll<HTMLElement>(tabbable))].forEach((n) => { if (n === el ? n.matches(tabbable) : true) n.setAttribute('tabindex', '-1'); });
      if (el.childElementCount > 0) { el.id = id; return true; }                                      // rendered: give the id back
      return false;
    };
    const run = async () => {
      const el = slot.current;
      if (off || !el) return;
      el.id = 'appleid-signin';                                  // held only while Apple draws into this element
      try { await loadAppleScript(document, forDelete ? features.accounts : accountsLive()); } catch { el.id = id; if (!off) setFailed(true); return; }
      if (off) { el.id = id; return; }
      if (el.childElementCount === 0) renderAppleButton();
      await new Promise<void>((resolve) => {
        const done = () => { obs.disconnect(); clearTimeout(timer); resolve(); };
        const obs = new MutationObserver(() => { if (tidy()) done(); });
        // Apple's script loaded but drew nothing in 3 s: render nothing rather than an empty box.
        const timer = setTimeout(() => { el.id = id; if (el.childElementCount === 0 && !off) setFailed(true); done(); }, 3000);
        obs.observe(el, { childList: true, subtree: true });
        if (tidy()) done();
      });
    };
    renderChain = renderChain.then(run, run);
    const watch = slot.current ? new MutationObserver(tidy) : null;
    if (watch && slot.current) watch.observe(slot.current, { childList: true, subtree: true });
    return () => { off = true; watch?.disconnect(); };
  }, [forDelete, id]);

  if (failed) return null;                                       // nothing to show, and no empty box left behind
  const act = () => click.current();
  return (
    // A click or Enter / Space is taken here, before Apple's own handler, and goes to our Supabase sign-in.
    <div role="button" tabIndex={0} aria-label={APPLE_LABEL} data-apple-button="web" style={{ width, height }}
      onClickCapture={(e) => { e.stopPropagation(); e.preventDefault(); act(); }}
      onKeyDownCapture={(e) => { handleAppleKey(e, act); }}>
      <div ref={slot} id={id} data-color={tone === 'dark' ? 'white' : 'black'} data-border="true" data-type="sign-in" data-width={width} data-height={height} data-border-radius="4" />
    </div>
  );
}
