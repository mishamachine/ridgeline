import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const run = (mode: string, input = '', env: Record<string, string> = {}) => spawnSync('bash', ['scripts/check-no-social-sdks.sh', mode], { input, encoding: 'utf8', env: { ...process.env, ...env } });

describe('native SDK guard', () => {
  it('fails on the plugin manifest as it ships before the provider config is applied (Facebook SDK active)', () => {
    const before = `.package(url: "https://github.com/facebook/facebook-ios-sdk.git", .upToNextMajor(from: "18.0.3")),\n.product(name: "FacebookCore", package: "facebook-ios-sdk"),`;
    const r = run('scan', before);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Facebook/Twitter SDK reference found');
  });
  it('fails on a Gradle tree or framework list that has Facebook, FBSDK or Twitter, in any case', () => {
    for (const bad of ['+--- com.facebook.android:facebook-login:18.1.3', 'FBSDKCoreKit.framework', 'com.TWITTER.sdk:x']) expect(run('scan', bad).status).toBe(1);
  });
  it('passes a clean tree (Google and Apple only)', () => {
    expect(run('scan', '+--- com.google.android.gms:play-services-auth:21.0.0\nGoogleSignIn.framework\nCapacitor.framework\n').status).toBe(0);
  });
  it('passes the real iOS manifests in this checkout once cap sync has applied the provider config', () => {
    const plugin = readFileSync('node_modules/@capgo/capacitor-social-login/Package.swift', 'utf8');
    // Only meaningful after `npm run build:native` (the plugin hook comments the Facebook lines out); CI runs the guard right after that.
    const r = run('ios', '', { GUARD_XCODE_CMD: 'echo "GoogleSignIn-iOS @ 9.0.0"' }); // xcodebuild itself only exists on the macOS CI runner
    if (/^\s*\.package\(.*facebook/mi.test(plugin)) expect(r.status).toBe(1); else expect(r.status).toBe(0);
  });
  it('a gradlew that fails, or prints nothing, FAILS the guard (no output is never "clean")', () => {
    const crash = run('android', '', { GUARD_GRADLE_CMD: 'echo "FAILURE: Build failed" >&2; exit 1' });
    expect(crash.status).toBe(1);
    expect(crash.stderr).toContain('gradlew :app:dependencies failed');
    expect(run('android', '', { GUARD_GRADLE_CMD: 'true' }).status).toBe(1);
  });
  it('a gradlew listing with Facebook fails; a clean one passes', () => {
    expect(run('android', '', { GUARD_GRADLE_CMD: 'echo "+--- com.facebook.android:facebook-login:18.1.3"' }).status).toBe(1);
    expect(run('android', '', { GUARD_GRADLE_CMD: 'echo "+--- com.google.android.gms:play-services-auth:21.0.0"' }).status).toBe(0);
  });
  it('an xcodebuild listing that fails, is empty or names Facebook FAILS the iOS guard', () => {
    expect(run('ios', '', { GUARD_XCODE_CMD: 'echo "xcodebuild: error" >&2; exit 65' }).status).toBe(1);
    expect(run('ios', '', { GUARD_XCODE_CMD: 'true' }).status).toBe(1);
    expect(run('ios', '', { GUARD_XCODE_CMD: 'echo "facebook-ios-sdk @ 18.0.3"' }).status).toBe(1);
    const ok = run('ios', '', { GUARD_XCODE_CMD: 'echo "GoogleSignIn-iOS @ 9.0.0"' });
    const plugin = readFileSync('node_modules/@capgo/capacitor-social-login/Package.swift', 'utf8');
    expect(ok.status).toBe(/^\s*\.package\(.*facebook/mi.test(plugin) ? 1 : 0);
  });
  it('capacitor.config.json turns Facebook and Twitter off', () => {
    const c = JSON.parse(readFileSync('capacitor.config.json', 'utf8'));
    expect(c.plugins.SocialLogin.providers).toEqual({ google: true, apple: true, facebook: false, twitter: false });
  });
});
