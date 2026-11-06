#!/usr/bin/env bash
# Runs inside the emulator job: install the debug APK, launch, grant location, walk a short route, screenshot.
set -u
APK=android/app/build/outputs/apk/debug/app-debug.apk
PKG=com.bbprojectfactory.ridgeline
mkdir -p shots
adb install -r "$APK"
for p in ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION POST_NOTIFICATIONS; do adb shell pm grant "$PKG" "android.permission.$p" || true; done
adb logcat -c
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1
sleep 12
adb exec-out screencap -p > shots/launch.png
# a short walk near Mount Si trailhead, one fix per second (lon lat order for geo fix)
for pt in "-121.7236 47.4881" "-121.7233 47.4884" "-121.7229 47.4888" "-121.7225 47.4891" "-121.7220 47.4895"; do
  adb emu geo fix $pt; sleep 1
done
sleep 3
adb exec-out screencap -p > shots/after-route.png
adb logcat -d > shots/logcat.txt
PID=$(adb shell pidof "$PKG" || true)
echo "app pid: ${PID:-none}"
if grep -q "FATAL EXCEPTION" shots/logcat.txt; then echo "::error::The app crashed"; grep -A12 "FATAL EXCEPTION" shots/logcat.txt | head -30; exit 1; fi
[ -n "$PID" ] || { echo "::error::The app is not running"; exit 1; }
echo "launch ok, no crash"
