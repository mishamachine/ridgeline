# Native release: TestFlight and Play internal testing

Ridgeline ships as a Capacitor app (`com.bbprojectfactory.ridgeline`) built on GitHub Actions. Nothing here needs
Xcode or Android Studio on a local Mac. Babar approved "build, test, and ship" on 6 Nov 2026; shipping needs the
console steps and secrets below, which only the account owner can do. Without them the release workflows end with a
`::warning::` and do nothing.

## How the apps differ from the web app

- No service worker. Saved offline maps are read from the same Cache Storage entries through a MapLibre
  request hook (`src/lib/native/offlineMaps.ts`), with network fallback.
- Spoken directions use native text-to-speech (works with the screen off); the lock-screen notification shows the next
  instruction, distance left and % done.
- Trail data is read from https://hike.bbprojectfactory.com/trails/ (`deploy/htaccess` allows the apps' WebView origins).
- Debug builds only (CI emulator run) carry a receiver that starts the hike service; release builds do not.

## What runs without any secret

`Native apps` (`.github/workflows/native.yml`, every PR): Android debug APK build, Android emulator smoke run
(best effort, CI only), iOS Simulator build with a launch screenshot. Artifacts: `ridgeline-debug-apk`,
`android-emulator-shots`, `ios-simulator-shots`.

## Repo secrets (Settings -> Secrets and variables -> Actions)

Set with `gh secret set NAME` (prompts, hidden). Never paste a value into a workflow input; the repo is public.

| Secret | Used by | Where it comes from |
|---|---|---|
| `ASC_KEY_ID`, `ASC_ISSUER_ID` | iOS release | App Store Connect -> Users and Access -> Integrations -> Team Keys |
| `ASC_KEY_P8_B64` | iOS release | `base64 -i AuthKey_XXXX.p8 \| tr -d '\n' \| gh secret set ASC_KEY_P8_B64` (role Admin so Xcode can make the cloud certificate) |
| `RIDGELINE_APPLE_TEAM_ID` | iOS release | developer.apple.com -> Membership details -> Team ID |
| `RIDGELINE_KEYSTORE_B64` | Android release | `base64 -i ridgeline-upload.jks \| tr -d '\n' \| gh secret set RIDGELINE_KEYSTORE_B64` |
| `RIDGELINE_KEYSTORE_PASSWORD`, `RIDGELINE_KEY_ALIAS`, `RIDGELINE_KEY_PASSWORD` | Android release | chosen when the upload key is made |

Make a new upload key for Ridgeline (do not reuse any other app's key):
`keytool -genkeypair -v -keystore ridgeline-upload.jks -alias ridgeline -keyalg RSA -keysize 2048 -validity 10000`.
Keep the file and passwords in your password manager, not in the repo.

## Apple (iOS)

1. developer.apple.com -> Identifiers: register `com.bbprojectfactory.ridgeline` with Associated Domains
   (automatic signing can also do this).
2. App Store Connect -> Apps -> + New App: iOS, name "Ridgeline", that bundle ID, any SKU (e.g. `ridgeline-ios`).
   The upload fails with "no suitable application records" until this exists.
3. Create the API key and set the four iOS secrets above.
4. Actions -> "iOS release" -> Run workflow. Set a new build number each time. The build appears in TestFlight after
   Apple processing (about 10-30 minutes). External testers also need the privacy policy URL and Beta App Review.
5. App Privacy answers (must match the code): Location, collected = No (never leaves the device). No tracking, no analytics.
6. Location justification for review: location is used only during a hike the user starts, with the system
   background-location indicator shown; it is never sent anywhere. Safety line in the app and listing:
   "Directions are a guide; check conditions; not for emergency use."
7. Associated domains: once the Team ID is known, replace `TODO_RELEASE_TEAMID` in
   `public/.well-known/apple-app-site-association` and deploy it to hike.bbprojectfactory.com.

## Google Play (Android)

1. Play Console -> Create app: "Ridgeline", package `com.bbprojectfactory.ridgeline`. Use Play App Signing.
2. Set the four Android secrets. Actions -> "Android release" -> Run workflow (new `version_code` each time).
3. Download `android-release-aab`; Play Console -> Testing -> Internal testing -> Create release -> upload it.
4. Data safety form: location, collected = No (processed on device only); no data shared; no ads.
5. Permissions declared: precise location (foreground), foreground service of type location, notifications.
   The app does not request background location (ACCESS_BACKGROUND_LOCATION); the foreground service with a
   visible notification keeps GPS running with the screen off, so no background-location declaration video is
   expected. The Foreground service (location) declaration asks for a short description and a video of the
   feature: start a hike, lock the phone, show the notification.
6. App Links: after the first upload, Play Console -> Setup -> App signing shows the SHA-256 certificate
   fingerprint. Put it in `public/.well-known/assetlinks.json` (replace the TODO) and deploy it to
   hike.bbprojectfactory.com.

## Site side

- DNS and hosting for hike.bbprojectfactory.com: the apps read trail data only from
  https://hike.bbprojectfactory.com/trails/ (there is no fallback host). `deploy/htaccess` sends the CORS header the apps need.
- Store listing URLs: privacy policy https://hike.bbprojectfactory.com/privacy/ and support
  https://hike.bbprojectfactory.com/support/. Both must be live before any store submission.
- App icon: the final "Summit Red" icon from `brand/icon/`; `npm run icons` regenerates every icon and the splash (static).

## Versions

`package.json` `version` is the store version name. The build number / versionCode is a workflow input.
