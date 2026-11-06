import { isNative } from './native/platform';

// What this build can honestly claim. Onboarding and other copy read from here; later PRs flip a flag when the feature ships.
export const features = {
  voice: true,
  screenOff: isNative(), // lock-screen directions exist only in the apps (foreground service / background location)
  badges: true,
  // Celebration screen and /h/<id> landing page. Flip to true after the hike.bbprojectfactory.com deploy (PR #9) is live, in the same commit that adds the share-card privacy paragraph.
  celebrate: false,
  // Flip only after Florence confirms /v is live AND Nizam's privacy line is added to public/privacy (Usage counts).
  counter: false,
};
