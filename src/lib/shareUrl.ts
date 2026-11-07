import { SITE_URL } from './site';

/** The link to share: always the public site, never the host the app is served from. */
export const shareUrl = (): string => SITE_URL;
