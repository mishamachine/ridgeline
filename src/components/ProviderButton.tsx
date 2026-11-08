import type { Provider } from '../lib/accounts/auth';
import { nativePlatform } from '../lib/native/platform';
import googleLightWeb from '../assets/brand/google-signin-light-web.svg';
import googleDarkWeb from '../assets/brand/google-signin-dark-web.svg';
import googleLightIos from '../assets/brand/google-signin-light-ios.svg';
import googleDarkIos from '../assets/brand/google-signin-dark-ios.svg';

// Apple's mark (single path, 24 x 24), drawn in the button's text colour. Apple's official artwork is NOT in the repo yet: see docs/BRAND_ASSETS.md.
const APPLE_PATH = 'M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701';

export const PROVIDER_LABEL: Record<Provider, string> = { apple: 'Continue with Apple', google: 'Sign in with Google' };

/** Button sizes from Google's guidelines (the artwork's own size): 180 x 40 on web and Android, 188 x 44 on iOS. The Apple button is drawn to the same size. */
export const BUTTON_SIZE = { web: { w: 180, h: 40 }, ios: { w: 188, h: 44 } } as const;

/** Google's official button artwork, unmodified (docs/BRAND_ASSETS.md). Light theme on a light card, dark theme on a dark one; aspect ratio is never changed. */
export function googleArtwork(platform: 'ios' | 'android' | 'web', tone: 'light' | 'dark'): { src: string; w: number; h: number } {
  const ios = platform === 'ios';
  const src = ios ? (tone === 'dark' ? googleDarkIos : googleLightIos) : (tone === 'dark' ? googleDarkWeb : googleLightWeb);
  return { src, ...(ios ? BUTTON_SIZE.ios : BUTTON_SIZE.web) };
}

/**
 * One sign-in button. Google: its official "Sign in with Google" artwork as the button face (its wording is part of the artwork).
 * Apple: a custom button with the Apple mark, Apple's wording ("Continue with Apple") and its black (white on a dark card) style, drawn at the same size.
 */
export function ProviderButton({ provider, tone = 'light', onClick, platform = nativePlatform() }: { provider: Provider; tone?: 'light' | 'dark'; onClick: () => void; platform?: 'ios' | 'android' | 'web' }) {
  const size = platform === 'ios' ? BUTTON_SIZE.ios : BUTTON_SIZE.web;
  if (provider === 'google') {
    const a = googleArtwork(platform, tone);
    return (
      <button className="gp-btn gp-btn-google gp-btn-art" style={{ width: size.w, height: size.h }} onClick={onClick} aria-label={PROVIDER_LABEL.google}>
        <img src={a.src} width={a.w} height={a.h} alt="" />
      </button>
    );
  }
  return (
    <button className={`gp-btn gp-btn-apple gp-on-${tone}`} style={{ width: size.w, height: size.h }} onClick={onClick}>
      <svg className="gp-logo" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d={APPLE_PATH} /></svg>
      <span>{PROVIDER_LABEL.apple}</span>
    </button>
  );
}
