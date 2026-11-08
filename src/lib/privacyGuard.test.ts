import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// The Accounts privacy text describes sign-in. It may only be on the page while the feature is on.
// Before the feature flag exists in features.ts this test does nothing; once it exists (and is off) the page may not carry the section.
describe('the privacy page does not run ahead of the feature', () => {
  const features = readFileSync('src/lib/features.ts', 'utf8');
  const page = readFileSync('public/privacy/index.html', 'utf8');
  const hasFlag = /^\s*accounts:/m.test(features);
  const flagOn = /^\s*accounts:\s*true\b/m.test(features);
  it('carries the Accounts section only when features.accounts is true', () => {
    if (!hasFlag) return;
    if (page.includes('Accounts (optional)')) expect(flagOn, 'the privacy rewrite is on the page but features.accounts is false: flip the flag in the same change').toBe(true);
  });
});
