import type { Provider } from '../lib/accounts/auth';
import { AppleButton } from './AppleButton';
import { nativePlatform } from '../lib/native/platform';
import googleLightWeb from '../assets/brand/google-signin-light-web.svg';
import googleDarkWeb from '../assets/brand/google-signin-dark-web.svg';
import googleLightIos from '../assets/brand/google-signin-light-ios.svg';
import googleDarkIos from '../assets/brand/google-signin-dark-ios.svg';

export const PROVIDER_LABEL: Record<Provider, string> = { apple: 'Sign in with Apple', google: 'Sign in with Google' };

/** Button sizes from Google's guidelines (the artwork's own size): 180 x 40 on web and Android, 188 x 44 on iOS. The Apple button is drawn to the same size. */
export const BUTTON_SIZE = { web: { w: 180, h: 40 }, ios: { w: 188, h: 44 } } as const;

/** Google's official button artwork, unmodified (docs/BRAND_ASSETS.md). Light theme on a light card, dark theme on a dark one; aspect ratio is never changed. */
export function googleArtwork(platform: 'ios' | 'android' | 'web', tone: 'light' | 'dark'): { src: string; w: number; h: number } {
  const ios = platform === 'ios';
  const src = ios ? (tone === 'dark' ? googleDarkIos : googleLightIos) : (tone === 'dark' ? googleDarkWeb : googleLightWeb);
  return { src, ...(ios ? BUTTON_SIZE.ios : BUTTON_SIZE.web) };
}

/**
 * One sign-in button, both with the verb "Sign in with" and the same size.
 * Google: its official artwork as the button face (its wording is part of the artwork).
 * Apple: Apple's own control, never our drawing: the system button on iOS, Apple's JS button on the web (see AppleButton).
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
    <div className="gp-btn-apple-slot" style={{ width: size.w, height: size.h }} data-apple-button={platform}>
      <AppleButton platform={platform} tone={tone} width={size.w} height={size.h} onClick={onClick} />
    </div>
  );
}
