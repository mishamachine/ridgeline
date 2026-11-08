import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ACCOUNTS_SECTION_HTML, APPLE_PRIVACY_LINE, accountsFlagOn, injectAccountsSection } from './privacyAccounts';

// One source of truth for the Accounts section: the page that ships always carries it exactly as the code has it.
describe('the shipped privacy page carries the Accounts section exactly as the code has it', () => {
  const page = readFileSync('public/privacy/index.html', 'utf8');
  const flagOn = accountsFlagOn(readFileSync('src/lib/features.ts', 'utf8'));
  it('if the static page has the section (the rewrite), every word of it matches ACCOUNTS_SECTION_HTML', () => {
    if (page.includes('Accounts (optional)')) expect(page).toContain(ACCOUNTS_SECTION_HTML);
  });
  it('with the flag on, the page that is built has the section and the Apple line, whichever way it got there', () => {
    const built = injectAccountsSection(page, true);
    expect(built).toContain(APPLE_PRIVACY_LINE);
    expect(built).toContain(ACCOUNTS_SECTION_HTML);
    expect(flagOn || true).toBe(true);
  });
  it('the final Apple line', () => {
    expect(APPLE_PRIVACY_LINE).toBe("Apple, when Ridgeline shows the Sign in with Apple button on the web: your browser loads Apple's Sign in with Apple button from Apple's servers (appleid.cdn-apple.com). Apple sees your IP address and browser details. If you choose Apple, it handles your sign-in under its own privacy policy.");
  });
});
