import { isNative } from './native/platform';

// What this build can honestly claim. Onboarding and other copy read from here; later PRs flip a flag when the feature ships.
export const features = {
  voice: true,
  screenOff: isNative(), // lock-screen directions exist only in the apps (foreground service / background location)
  badges: true,
  // Celebration screen, share card and /h/<id> landing page. Live with the hike.bbprojectfactory.com domain; the "Sharing a hike" privacy paragraph ships in the same commit.
  celebrate: true,
  // Flip only after Florence confirms /v is live AND Nizam's privacy line is added to public/privacy (Usage counts).
  counter: false,
};
