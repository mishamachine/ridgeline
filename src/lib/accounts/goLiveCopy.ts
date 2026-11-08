// Copy that changes when accounts go on. Every line has an OFF text (true today) and an ON text (true once sign-in is live), chosen by
// features.accounts, so none of it can be ahead of the feature. Static pages get the same swap at build time (vite.config.ts).
import { features } from '../features';

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
];

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
