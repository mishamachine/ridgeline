import { SITE_URL } from './site';

/** Where the app is served from (GitHub Pages serves it under /ridgeline/). */
export const appBase = () => import.meta.env.BASE_URL ?? '/';

/** Start of every link we hand out: always the public site, never the host the app happens to be served from. Ends without a slash. */
export const linkOrigin = (): string => SITE_URL;

/** Base path after linkOrigin(): the public site is served from the root. In-app navigation uses appBase(). */
export const linkBase = () => '/';
