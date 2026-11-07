// Deep links: https://hike.bbprojectfactory.com/trail/<id> opens that trail inside the app.
import { App } from '@capacitor/app';
import { SITE_URL } from '../site';
import { isNative } from './platform';

const HOSTS = new Set([new URL(SITE_URL).hostname]);

/** Trail id from an app link, or null if it is not one of ours. */
export function parseTrailLink(url: string): string | null {
  try {
    const u = new URL(url);
    if (!HOSTS.has(u.hostname)) return null;
    const m = u.pathname.match(/^\/trail\/([^/]+)\/?$/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch { return null; }
}

/** Calls `cb(trailId)` when the app is opened from a trail link. Returns an unsubscribe function. */
export function onTrailLink(cb: (id: string) => void): () => void {
  if (!isNative()) return () => {};
  const h = App.addListener('appUrlOpen', ({ url }) => { const id = parseTrailLink(url); if (id) cb(id); });
  return () => { h.then((x) => x.remove()).catch(() => {}); };
}
