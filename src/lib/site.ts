// The public address of the app. The domain move changes only this line.
export const SITE_URL = 'https://hike.bobolearns.com';

/** Where the app is served from (GitHub Pages serves it under /ridgeline/). */
export const appBase = () => import.meta.env.BASE_URL ?? '/';
