// Ship app updates to returning users: check for a new service worker, apply it at once
// unless a hike is running, in which case ask first. Saved offline maps live in rl-* caches
// that the service worker never deletes.
export const CHECK_EVERY_MS = 30 * 60 * 1000;
export const RELOAD_GUARD_MS = 60 * 1000;
const RELOAD_KEY = 'rl-sw-reload-at';

export type UpdateAction = 'apply' | 'toast';

/** A hike is running: never reload under the hiker. */
export const decideUpdate = (hikeActive: boolean): UpdateAction => (hikeActive ? 'toast' : 'apply');

/** Reload at most once per minute, so a bad update can never loop. */
export const mayReload = (lastReloadAt: number | null, now: number) =>
  lastReloadAt === null || now - lastReloadAt >= RELOAD_GUARD_MS || now < lastReloadAt;

let hikeActive = false;
let waiting: ServiceWorker | null = null;
let applying = false;
let readyListener: (ready: boolean) => void = () => {};

export const setHikeActive = (v: boolean) => {
  hikeActive = v;
  if (!v && waiting) handleWaiting(waiting); // the hike ended: apply the update that was waiting
};
export const onUpdateReady = (l: (ready: boolean) => void) => { readyListener = l; return () => { readyListener = () => {}; }; };

const lastReload = (): number | null => {
  try { const v = sessionStorage.getItem(RELOAD_KEY); return v ? Number(v) : null; } catch { return Date.now(); } // no storage: cannot guard, so never auto-reload
};

/** Tell the waiting worker to take over; the page reloads once when it does. */
export function applyUpdate() {
  if (!waiting) { location.reload(); return; } // another tab already updated: just reload
  applying = true;
  waiting.postMessage('SKIP_WAITING');
}

export function handleWaiting(w: ServiceWorker) {
  waiting = w;
  if (decideUpdate(hikeActive) === 'apply' && mayReload(lastReload(), Date.now())) applyUpdate();
  else readyListener(true);
}

export function initSwUpdate() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  const sw = navigator.serviceWorker;
  const hadController = !!sw.controller;
  sw.addEventListener('controllerchange', () => {
    if (!hadController) return; // first install
    if (!applying) { readyListener(true); return; } // another tab applied an update: offer this one a reload
    try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* ignore */ }
    location.reload();
  });
  const base = import.meta.env.BASE_URL;
  sw.register(`${base}sw.js`, { scope: base, updateViaCache: 'none' }).then((reg) => {
    const check = () => { reg.update().catch(() => {}); };
    const track = (w: ServiceWorker | null) => {
      if (!w) return;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && sw.controller) handleWaiting(w); });
    };
    if (reg.waiting && sw.controller) handleWaiting(reg.waiting);
    track(reg.installing);
    reg.addEventListener('updatefound', () => track(reg.installing));
    check();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, CHECK_EVERY_MS);
  }).catch(() => {});
}
