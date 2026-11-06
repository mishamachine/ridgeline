// Shared B&B cookieless usage counter (D-062). Four event names, no IDs, nothing stored on the device.
import { features } from './features';
import { SITE_URL, COUNTER_URL } from './site';

export type CountEvent = 'session' | 'offline_save' | 'hike_start' | 'share';

const clip = (s: string | null | undefined) => (s ?? '').trim().slice(0, 64);
/** UTM values: no emails, only [A-Za-z0-9_.-]. */
const utm = (s: string | null) => { const v = (s ?? '').trim(); return v.includes('@') ? '' : clip(v.replace(/[^\w.-]/g, '')); };
const isIp = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':') || h.startsWith('[');
const TYPE = 'text/plain;charset=UTF-8'; // a CORS-safelisted type: no preflight

/** Referrer hostname only; '' when there is none or it is this site. */
function refHost(): string {
  try {
    if (!document.referrer) return '';
    const h = new URL(document.referrer).hostname;
    return isIp(h) || h === location.hostname || h === new URL(SITE_URL).hostname ? '' : clip(h);
  } catch { return ''; }
}

function source() {
  const q = new URLSearchParams(location.search);
  return { utm_source: utm(q.get('utm_source')), utm_medium: utm(q.get('utm_medium')), utm_campaign: utm(q.get('utm_campaign')), ref: refHost() };
}

const isNative = () => !!(globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

let sessionSent = false; // in memory only: once per app launch

export function count(e: CountEvent): void {
  if (!features.counter) return;
  try {
    if (e === 'session') {
      if (sessionSent) return;
      sessionSent = true;
    }
    const body = JSON.stringify(e === 'session' ? { p: 'ridgeline', e, si: 0, src: source() } : { p: 'ridgeline', e, si: 0 });
    if (isNative()) {
      void fetch(COUNTER_URL, { method: 'POST', keepalive: true, credentials: 'omit', headers: { 'content-type': TYPE }, body }).catch(() => {});
    } else if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(COUNTER_URL, new Blob([body], { type: TYPE }));
    }
  } catch { /* counting must never break the app */ }
}

/** Test hook. */
export const resetCounterForTests = () => { sessionSent = false; };
