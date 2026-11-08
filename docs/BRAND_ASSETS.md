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

**Not added yet.** Apple's logo bundle is a disk image on a different host (`devimages-cdn.apple.com/design/resources/download/Logo-Sign-in-with-Apple.dmg`, linked from https://developer.apple.com/design/resources/), and its button files are on Figma and Sketch. Until that is approved, the Apple button is drawn: black (white on a dark card), the Apple mark, and Apple's wording "Continue with Apple", at the same size as Google's button. It should be replaced by Apple's official artwork. On iOS a native `ASAuthorizationAppleIDButton` can follow later if App Review asks.
