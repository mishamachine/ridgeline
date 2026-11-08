#!/usr/bin/env bash
# Fails the build if a Facebook or Twitter SDK is part of the native app. Ridgeline signs in with Google and Apple only
# (capacitor.config.json turns the other providers off; this guard proves it stayed that way).
#   scan     read text on stdin (used by the unit test)
#   ios      after `npm run build:ios` and the xcodebuild step: plugin Package.swift, resolved packages, built frameworks
#   android  after `npm run build:android`: the Gradle dependency tree and the debug APK
set -u
PAT='facebook|FBSDK|twitter'

scan() {
  if grep -iE "$PAT"; then echo "::error::Facebook/Twitter SDK reference found (lines above)" >&2; return 1; fi
  return 0
}

case "${1:-}" in
  scan) scan ;;
  ios)
    rc=0
    # Active (non-comment) dependency lines of the plugin and of the app's own package manifest.
    for f in node_modules/@capgo/capacitor-social-login/Package.swift ios/App/CapApp-SPM/Package.swift; do
      grep -vE '^\s*//' "$f" | scan || rc=1
    done
    # Resolved SwiftPM packages and the frameworks inside the built app, if a build exists.
    { find build/SourcePackages/checkouts -maxdepth 1 2>/dev/null; find ios -name Package.resolved 2>/dev/null | xargs -I{} cat {} 2>/dev/null
      find build/Build/Products -path '*App.app/Frameworks/*' -maxdepth 6 2>/dev/null; } | scan || rc=1
    exit $rc ;;
  android)
    rc=0
    (cd android && ./gradlew :app:dependencies --no-daemon -q) | scan || rc=1
    apk=android/app/build/outputs/apk/debug/app-debug.apk
    [ -f "$apk" ] && { unzip -l "$apk" | scan || rc=1; }
    exit $rc ;;
  *) echo "usage: $0 scan|ios|android" >&2; exit 2 ;;
esac
