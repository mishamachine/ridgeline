import { isNative } from './native/platform';

// What this build can honestly claim. Onboarding and other copy read from here; later PRs flip a flag when the feature ships.
export const features = {
  voice: true,
  screenOff: isNative(), // lock-screen directions exist only in the apps (foreground service / background location)
  badges: true,
  // Celebration screen, share card and /h/<id> landing page. Live with the hike.bbprojectfactory.com domain; the "Sharing a hike" privacy paragraph ships in the same commit.
  celebrate: true,
  // Flip only after the /v endpoint is confirmed live AND the privacy page's "Usage counts" section describes the counter.
  counter: false,
  // Google/Apple sign-in. OFF until the owner has finished the Apple, Google and Supabase setup, applied the migration and approved go-live;
  // flip together with the privacy text and store labels. While false nothing in src/lib/accounts runs or loads.
  accounts: false,
};
