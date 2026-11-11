# Sign-in brand assets

Brand artwork is used exactly as the vendor publishes it. It is never redrawn, recoloured or edited, and it comes only from the vendor's own site.

## Google: "Sign in with Google" buttons

- **Source page:** https://developers.google.com/identity/branding-guidelines
- **Download:** https://developers.google.com/static/identity/images/signin-assets.zip (HTTP 200, `last-modified` 29 Jun 2026; no sign-in or licence click-through was shown on the page or by the download)
- **Downloaded:** 8 Nov 2026. Whole archive sha256: `ba884069e12093b06bcfd776915081254a7c95094b80d50be2c5dc6bac1c1da1`
- The archive holds only PNG and SVG images (24 SVG, 96 PNG). Nothing was run. The four SVG files below were copied out byte for byte (same sha256 as in the archive). The SVGs contain no scripts or external links, and their text is outlined, so no font is needed.

| In the repo (`src/assets/brand/`) | Original path in the zip | sha256 |
|---|---|---|
| `google-signin-light-web.svg` | `Android + Web/SVG/Light/Theme=Light, Show text=Yes, Shape=Square, Platform=Android+Web.svg` | `9dbc9beb1660ca4de76a724cae014be02b22ecdd8124282318f9f0362579474c` |
| `google-signin-dark-web.svg` | `Android + Web/SVG/Dark/Theme=Dark, Show text=Yes, Shape=Square, Platform=Android+Web.svg` | `790f35a6cea01d512d8c0cbf51d6277219a17206a67471fc3329dfffa0ede293` |
| `google-signin-light-ios.svg` | `iOS/SVG/Light/Theme=Light, Show text=Yes, Shape=Square, Platform=iOS.svg` | `3ea703dc518cb7bf20e76bc1b15dd854b17ce7a97d60c14277bb738fa74c74c1` |
| `google-signin-dark-ios.svg` | `iOS/SVG/Dark/Theme=Dark, Show text=Yes, Shape=Square, Platform=iOS.svg` | `72c1908d9edc080fb9d6cac3003ee50bac7c026d4aee1fb8cbd33e3cd52a84c5` |

How the guidelines are followed: the button is the artwork itself (so its fill, 1 px stroke, padding, G and "Sign in with Google" wording are Google's). It is shown at the artwork's own size, 180 x 40 on web and Android and 188 x 44 on iOS, never stretched. The light theme is used on a light background and the dark theme on a dark one. Android and web use the "Android + Web" files; iOS uses the "iOS" files.

## Apple: Sign in with Apple

**No Apple artwork is in the repo, and no Apple licence has been accepted.** Apple's logo bundle (`Logo-Sign-in-with-Apple.dmg`, devimages-cdn.apple.com) carries a click-through licence that does not allow copying or redistributing the artwork, and this repo is public. The bundle and the licence text were only inspected, outside the repo, and are not committed.

Instead the button is always Apple's own control, with Apple's own wording "Sign in with Apple" (type `sign-in`), at the same size as Google's button:

- **iOS app:** the system button `ASAuthorizationAppleIDButton` (type `.signIn`; black, or white on a dark background) through the local plugin `RidgelineAppleButton` (`ios/App/App/HikePlugin.swift`, `src/lib/native/appleButtonPlugin.ts`). **Not tested on a device or simulator** (built in CI only).
- **Web:** Apple's Sign in with Apple JS button. The script URL, as given in Apple's documentation ("Displaying Sign in with Apple buttons on the web" and "Configuring your webpage for Sign in with Apple", checked 8 Nov 2026), is exactly
  `https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js`
  (host `appleid.cdn-apple.com`). It is added to the page only when the web sign-in screen shows the Apple button, only while accounts are live (built in AND the runtime flag on, never while paused), and never in the iOS or Android apps. It is the only place this URL appears (`src/lib/accounts/appleWeb.ts`). Loading it contacts Apple (IP address and browser details); the privacy Accounts section says so.
- **Android:** Google only.
