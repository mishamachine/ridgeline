#!/usr/bin/env bash
# Fails the build if a Facebook or Twitter SDK is part of the native app. Ridgeline signs in with Google and Apple only
# (capacitor.config.json turns the other providers off; this guard proves it stayed that way).
#   scan     read text on stdin (used by the unit test)
#   ios      after `npm run build:ios`: plugin and app manifests, the SwiftPM package listing from xcodebuild, resolved packages, built frameworks
#   android  after `npm run build:android`: the Gradle dependency tree and the debug APK
# A listing command that itself fails (gradlew, xcodebuild) FAILS the guard: no output must never read as "clean".
# GUARD_GRADLE_CMD and GUARD_XCODE_CMD replace those two commands in the unit test.
set -euo pipefail
PAT='facebook|FBSDK|twitter'

scan() {
  if grep -iE "$PAT"; then echo "::error::Facebook/Twitter SDK reference found (lines above)" >&2; return 1; fi
  return 0
}

# Run a command, require it to succeed and to print something, then scan what it printed.
listing() {
  local label="$1"; shift
  local out
  if ! out=$("$@" 2>&1); then echo "::error::$label failed, so the guard cannot say the build is clean" >&2; echo "$out" | tail -20 >&2; return 1; fi
  if [ -z "$out" ]; then echo "::error::$label printed nothing, so the guard cannot say the build is clean" >&2; return 1; fi
  printf '%s\n' "$out" | scan
}

case "${1:-}" in
  scan) scan ;;
  ios)
    rc=0
    # Active (non-comment) dependency lines of the plugin and of the app's own package manifest.
    for f in node_modules/@capgo/capacitor-social-login/Package.swift ios/App/CapApp-SPM/Package.swift; do
      { grep -vE '^\s*//' "$f" || true; } | scan || rc=1
    done
    # The package list as Xcode resolves it, then what is on disk.
    if [ -n "${GUARD_XCODE_CMD:-}" ]; then
      listing "xcodebuild package listing" bash -c "$GUARD_XCODE_CMD" || rc=1
    else
      listing "xcodebuild package listing" xcodebuild -resolvePackageDependencies -project ios/App/App.xcodeproj -scheme App -derivedDataPath build || rc=1
    fi
    { find build/SourcePackages/checkouts -maxdepth 1 2>/dev/null || true; find build/Build/Products -path '*App.app/Frameworks/*' -maxdepth 6 2>/dev/null || true; } | scan || rc=1
    exit $rc ;;
  android)
    rc=0
    if [ -n "${GUARD_GRADLE_CMD:-}" ]; then
      listing "gradlew :app:dependencies" bash -c "$GUARD_GRADLE_CMD" || rc=1
    else
      listing "gradlew :app:dependencies" bash -c 'cd android && ./gradlew :app:dependencies --no-daemon -q' || rc=1
    fi
    apk=android/app/build/outputs/apk/debug/app-debug.apk
    if [ -f "$apk" ]; then unzip -l "$apk" | scan || rc=1; fi
    exit $rc ;;
  *) echo "usage: $0 scan|ios|android" >&2; exit 2 ;;
esac
