import { isNative } from './native/platform';

// What this build can honestly claim. Onboarding and other copy read from here; later PRs flip a flag when the feature ships.
export const features = {
  voice: false,
  screenOff: isNative(), // lock-screen directions exist only in the apps (foreground service / background location)
  badges: true,
};
