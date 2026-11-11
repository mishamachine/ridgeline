// After the guest note closes and the app navigates away, the button that had focus is gone and focus would fall to the page body.
// This moves it to the heading of the screen the person lands on (made focusable with tabIndex -1 if it is not already).

interface El { tabIndex: number; focus: (o?: FocusOptions) => void; setAttribute: (k: string, v: string) => void; closest: (s: string) => unknown }
interface Doc { querySelector: (s: string) => unknown; querySelectorAll: (s: string) => ArrayLike<El> }

/** Visible screens only (tab screens that are not hidden, and overlays), the top-most last. */
const HEADINGS = '.screen h1';

/** Returns true once a heading was focused. Waits a few frames for the next screen to appear (it may be lazy-loaded); gives up quietly. */
export function focusLandingHeading(doc: Doc | null = typeof document === 'undefined' ? null : (document as unknown as Doc), schedule: (cb: () => void) => void = (cb) => requestAnimationFrame(cb), tries = 30): void {
  if (!doc) return;
  const attempt = (left: number) => {
    // While the sign-in screen is still on the page the navigation has not happened yet.
    const pending = doc.querySelector('[data-screen="sign-in"]');
    const heads = pending ? [] : [...Array.from(doc.querySelectorAll(HEADINGS))].filter((h) => !h.closest('[hidden]'));
    const h = heads[heads.length - 1];
    if (h) { if (h.tabIndex < 0) h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); return; }
    if (left > 0) schedule(() => attempt(left - 1));
  };
  schedule(() => attempt(tries));
}
