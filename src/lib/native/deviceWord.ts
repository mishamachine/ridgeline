import { nativePlatform } from './platform';

type Platform = 'ios' | 'android' | 'web';
/** "phone" in the iOS and Android apps, "device" on the web (a browser may be on a laptop). Running text only: the setting name
 *  "Keep hike tracks on this phone only" is a proper name quoted in the privacy page and is never passed through here. */
export const deviceWord = (platform: Platform = nativePlatform()): 'phone' | 'device' => (platform === 'web' ? 'device' : 'phone');
/** "this phone" or "this device", capitalised on request. */
export const thisDevice = (platform: Platform = nativePlatform(), cap = false): string => {
  const s = `this ${deviceWord(platform)}`;
  return cap ? s[0].toUpperCase() + s.slice(1) : s;
};
