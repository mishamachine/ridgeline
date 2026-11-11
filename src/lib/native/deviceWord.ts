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

const FORMS = /\b(your|other|another|every|switch) phone(s?)\b/gi;
const keep = (from: string, to: string) => (from[0] === from[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to);
/** Web only: "your phone", "other phones", "another phone", "every phone", "switch phones" become "device(s)". "this phone" is not touched here
 *  (use thisDevice), so the setting name "Keep hike tracks on this phone only" can never change. Text that is true only of a physical phone
 *  (compass, pocket, screen off) is simply not passed through. */
export const localize = (text: string, platform: Platform = nativePlatform()): string =>
  platform === 'web' ? text.replace(FORMS, (m, w: string, s: string) => keep(m, `${w} device${s}`)) : text;
