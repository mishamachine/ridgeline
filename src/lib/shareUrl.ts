import { SITE_URL } from './site';

const isNative = () => typeof window !== 'undefined' && !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

/** The link to share: on the web, the host the person is on; in the native app, the public site. */
export function shareUrl(): string {
  if (isNative() || typeof window === 'undefined') return SITE_URL;
  return window.location.origin + (import.meta.env.BASE_URL ?? '/');
}
