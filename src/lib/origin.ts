import { SITE_URL } from './site';

/** Where the app is served from (GitHub Pages serves it under /ridgeline/). */
export const appBase = () => import.meta.env.BASE_URL ?? '/';

const isNative = () => typeof window !== 'undefined' && !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

/** Start of every link we hand out: the host the user is on (web), or the public site (native app). Ends without a slash. */
export function linkOrigin(): string {
  if (typeof window === 'undefined' || isNative() || !window.location?.origin || window.location.origin === 'null') return SITE_URL;
  return window.location.origin;
}

/** Base path to put after linkOrigin(): the app's own base on web, "/" for the public site. */
export const linkBase = () => (linkOrigin() === SITE_URL ? '/' : appBase());
