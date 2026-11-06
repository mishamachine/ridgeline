import { SITE_URL } from '../site';
import { isNative } from './platform';

/** Where hosted trail data lives: this site on the web; the live site by absolute URL inside the native apps. */
export function trailBase(native = isNative()): string {
  return native ? `${SITE_URL}/trails/` : `${import.meta.env.BASE_URL ?? '/'}trails/`;
}
