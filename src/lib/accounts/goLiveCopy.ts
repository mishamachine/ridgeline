// Copy that changes when accounts go on. Every line has an OFF text (true today) and an ON text (true once sign-in is live), chosen by
// features.accounts, so none of it can be ahead of the feature. Static pages get the same swap at build time (vite.config.ts).
import { features } from '../features';
import { APPLE_PRIVACY_LINE, injectAccountsSection } from './privacyAccounts';

/** The go-live date shown as "Last updated" on the privacy page when accounts are on. Change it here on the day of the flip. */
export const GO_LIVE_DATE = '12 November 2026';

export interface Pair { off: string; on: string }

export const BADGES_FOOTER: Pair = {
  off: 'Kept on your phone; no account.',
  on: 'Saved on your phone, and in your account if you sign in.',
};
export const TOUR_BADGES_SENTENCE: Pair = {
  off: 'They stay on your phone.',
  on: "They're saved on your phone, and in your account if you sign in.",
};
export const TOUR_LOCATION_PERK: Pair = {
  off: 'Stays on your phone. Never sent to our servers.',
  on: 'Your live location stays on your phone. Never sent to our servers.',
};
export const PROFILE_LOCATION_SUMMARY: Pair = {
  off: 'Stays on your phone',
  on: 'Live location stays on your phone',
};
export const PROFILE_LOCATION_SENTENCE: Pair = {
  off: 'Your location is never sent to our servers.',
  on: 'Your live location is never sent to our servers. If you sign in, the route of a finished hike is saved to your account (minus the first and last 200 m), unless you turn on ‘Keep hike tracks on this phone only’.',
};

export const pick = (p: Pair, on: boolean = features.accounts): string => (on ? p.on : p.off);

/** Static pages: [file inside the build, text in the source (OFF), text to ship when accounts are on]. */
export interface Swap { file: string; from: string; to: string }
export const STATIC_SWAPS: Swap[] = [
  { file: 'support/index.html',
    from: 'No account, no sign-in. Save a trail to your phone and it works with no signal.',
    to: 'No account needed: save a trail to your phone and it works with no signal. If you like, sign in with Google or Apple to keep your hikes and saved trails on all your devices.' },
  { file: 'support/index.html',
    from: "Ridgeline keeps no account and nothing on our servers. Your recorded hikes and saved trails live on your device only. Delete a single hike or saved trail from its own screen, or delete everything by removing the app or clearing the site's data in your browser settings.",
    to: "Without an account, Ridgeline keeps nothing on our servers: your recorded hikes and saved trails live on your device only. If you sign in, your saved trails, hike history and the routes you walked (minus the first and last 200 m) are also stored in your account. Delete a single hike or saved trail from its own screen. To delete everything: if you are not signed in, remove the app or clear the site's data in your browser settings; if you are signed in, use Profile &rsaquo; Account or hike.bbprojectfactory.com/account/delete/." },
  { file: 'llms.txt',
    from: 'No accounts. Saved trails, recordings and live GPS position stay on the device; place searches',
    to: 'Accounts are optional (Google or Apple). Without one, saved trails, recordings and live GPS position stay on the device; if you sign in, saved trails, hike history and routes (minus the first and last 200 m) are also stored in your account, and your live position is never sent to our servers. Place searches' },
  // The privacy page (wording is the approved rewrite draft, verbatim). Each OFF line is the text on the page today; each swap throws if it has drifted.
  { file: 'privacy/index.html',
    from: '<meta name="description" content="Ridgeline has no accounts and no ads. Your location, recorded hikes and saved trails stay on your device. Here is exactly which outside services your device contacts.">',
    to: '<meta name="description" content="Ridgeline has no ads and works without an account. If you don\'t sign in, your hikes and saved trails stay on your device. If you do, we keep them safe for you. Here is exactly what we store and which services your device contacts.">' },
  { file: 'privacy/index.html', from: 'Last updated 10 November 2026', to: `Last updated ${GO_LIVE_DATE}` },
  { file: 'privacy/index.html',
    from: "Ridgeline has no accounts and no ads, and we don't sell your data. Your location, recorded hikes and saved trails stay on your device.",
    to: "Ridgeline has no ads, and we don't sell your data. You can use it without an account, and then your location, recorded hikes and saved trails stay on your device. If you choose to sign in with Google or Apple, we store your email address, the name and picture Google or Apple share with us, your saved trails, hike history and the routes you walked (minus the first and last 200 m) so they're on all your devices. See Accounts below." },
  { file: 'privacy/index.html',
    from: 'Your location is never sent to our servers.</li>',
    to: "Your live location is never sent to our servers. If you're signed in, the route of a finished hike is saved to your account (minus the first and last 200 m), unless you turn on 'Keep hike tracks on this phone only'.</li>" },
  { file: 'privacy/index.html',
    from: "Clearing the site's data in your browser (or deleting the app from your Home Screen) deletes all of this. We can't recover it, because we never had it.",
    to: "If you're not signed in, clearing the site's data in your browser (or deleting the app) deletes all of this, and we can't recover it, because we never had it. If you're signed in, your account copy stays until you delete it (see Deleting)." },
  // The outside-services LIST: Supabase, Google/Apple sign-in, and the Apple button on the web.
  { file: 'privacy/index.html',
    from: '<li><strong>Our web hosts (Hostinger and GitHub Pages)</strong>, which keep standard server logs: IP address, browser type and pages loaded.</li>',
    to: `<li><strong>Supabase</strong> (our database, United States/Oregon).</li>
<li><strong>Google/Apple sign-in</strong> (only when you sign in).</li>
<li>${APPLE_PRIVACY_LINE}</li>
<li><strong>Our web hosts (Hostinger and GitHub Pages)</strong>, which keep standard server logs: IP address, browser type and pages loaded.</li>` },
  { file: 'privacy/index.html',
    from: '<strong>Recorded hikes and GPX files.</strong> These are saved on your device. They leave it only if you choose to export them.',
    to: "<strong>Recorded hikes and GPX files.</strong> These are saved on your device. If you're not signed in, they leave it only if you choose to export them. If you're signed in, your hike history and routes (minus the first and last 200 m) also sync to our servers (see Accounts)." },
  { file: 'privacy/index.html',
    from: '<strong>Saved trails and offline maps.</strong> These are stored on your device.',
    to: "<strong>Saved trails and offline maps.</strong> Offline maps are stored on your device only. If you're signed in, your list of saved trails also syncs to your account." },
  { file: 'privacy/index.html',
    from: 'No accounts, no email, no payments, no ads, no sale or sharing of personal data, and no tracking across other apps or sites.',
    to: 'Accounts are optional. No payments, no ads, no marketing email, no sale or sharing of personal data, and no tracking across other apps or sites.' },
  { file: 'privacy/index.html',
    from: "We hold no personal data on our servers anyway.",
    to: 'If we learn that a child under that age has an account, we delete it.' },
  { file: 'privacy/index.html',
    from: 'and delete everything by removing the app or clearing site data.',
    to: "and delete everything: if you're not signed in, by removing the app or clearing site data; if you're signed in, in Profile &rsaquo; Account or at hike.bbprojectfactory.com/account/delete/." },
];

/** The privacy page exactly as it ships: the Accounts section first, then the go-live swaps. With accounts off it is the page unchanged. */
export function buildPrivacyPage(html: string, on: boolean): string {
  return applyStaticSwaps('privacy/index.html', injectAccountsSection(html, on), on);
}

/** Applies the swaps for `file` when accounts are on. Throws if a source line has drifted, so the swap can never silently miss. */
export function applyStaticSwaps(file: string, text: string, on: boolean): string {
  if (!on) return text;
  let out = text;
  for (const s of STATIC_SWAPS.filter((x) => x.file === file)) {
    if (!out.includes(s.from)) throw new Error(`go-live copy: expected text not found in ${file}: ${s.from.slice(0, 50)}`);
    out = out.replace(s.from, s.to);
  }
  return out;
}
