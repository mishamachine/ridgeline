// Share sheet and external links: native plugins inside the apps, Web Share / clipboard in a browser.
import { Share } from '@capacitor/share';
import { isNative } from './platform';

export interface ShareInput {
  title?: string; text?: string; url?: string;
  /** Web: File objects. Native: file:// URIs. */
  files?: (File | string)[];
}
export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

export async function share(input: ShareInput): Promise<ShareResult> {
  const { title, text, url, files = [] } = input;
  try {
    if (isNative()) {
      await Share.share({ title, text, url, files: files.filter((f): f is string => typeof f === 'string'), dialogTitle: title });
      return 'shared';
    }
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    const realFiles = files.filter((f): f is File => typeof f !== 'string');
    const data: ShareData = { title, text, url };
    if (realFiles.length && nav.canShare?.({ files: realFiles })) data.files = realFiles;
    if (nav.share && (!nav.canShare || nav.canShare(data))) { await nav.share(data); return 'shared'; }
    await navigator.clipboard.writeText([text, url].filter(Boolean).join(' '));
    return 'copied';
  } catch (e) {
    return e instanceof Error && /cancel|abort/i.test(`${e.name} ${e.message}`) ? 'cancelled' : 'failed';
  }
}

/** Open a web page or a maps/geo link outside the app (system browser or maps app). */
export function openExternal(url: string): void {
  // Inside the apps the WebView hands anything outside the app to the system (browser, Google Maps, Apple Maps).
  if (/^https?:/i.test(url)) window.open(url, '_blank', 'noopener');
  else window.location.assign(url);
}
