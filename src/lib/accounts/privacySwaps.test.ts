import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { APPLE_JS_URL } from './appleWeb';
import { GO_LIVE_DATE, STATIC_SWAPS, applyStaticSwaps, buildPrivacyPage } from './goLiveCopy';
import { APPLE_PRIVACY_LINE, injectAccountsSection } from './privacyAccounts';
import { DELETE_EMAIL_LINE } from './copy';

// The privacy page when accounts go on: the CBO-approved rewrite, word for word. With the flag off the page is exactly what it is today.
const page = readFileSync('public/privacy/index.html', 'utf8');
const on = buildPrivacyPage(page, true);
const plain = (h: string) => h.replace(/<[^>]*>/g, '').replace(/&rsaquo;/g, '›').replace(/&amp;/g, '&').replace(/&middot;/g, '·').replace(/&ldquo;|&rdquo;/g, '"');
const onText = plain(on);

describe('flag off: the privacy page is unchanged', () => {
  it('no swap and no section is applied', () => {
    expect(buildPrivacyPage(page, false)).toBe(page);
    expect(applyStaticSwaps('privacy/index.html', page, false)).toBe(page);
    expect(injectAccountsSection(page, false)).toBe(page);
  });
});

describe('flag on: none of the old sentences survive', () => {
  it.each([
    'no accounts and no ads', 'never sent to our servers', 'we never had it', 'No accounts, no email', 'hold no personal data on our servers', 'removing the app or clearing site data',
  ])('"%s" is not in the flag-on page except inside an approved new sentence', (old) => {
    const left = onText.split(old).length - 1;
    // "never sent to our servers" lives on in "Your live location is never sent to our servers"; "we never had it" and "removing the app or clearing site data" in the signed-out clauses.
    const allowed: Record<string, number> = { 'never sent to our servers': 1, 'we never had it': 1, 'removing the app or clearing site data': 1 };
    expect(left, old).toBe(allowed[old] ?? 0);
  });
  it('and the exact old sentences are all gone', () => {
    for (const old of [
      'Ridgeline has no accounts and no ads, and we don\'t sell your data.',
      'Your location is never sent to our servers.',
      "Clearing the site's data in your browser (or deleting the app from your Home Screen) deletes all of this. We can't recover it, because we never had it.",
      'No accounts, no email, no payments, no ads,',
      'We hold no personal data on our servers anyway.',
      'and delete everything by removing the app or clearing site data.',
      'Ridgeline has no accounts and no ads. Your location,',
    ]) expect(on, old).not.toContain(old);
  });
});

describe('flag on: the seven line rewrites, verbatim', () => {
  it.each([
    ['L8 meta', 'Ridgeline has no ads and works without an account. If you don\'t sign in, your hikes and saved trails stay on your device. If you do, we keep them safe for you. Here is exactly what we store and which services your device contacts.'],
    ['L38 (with the CBO addition)', "Ridgeline has no ads, and we don't sell your data. You can use it without an account, and then your location, recorded hikes and saved trails stay on your device. If you choose to sign in with Google or Apple, we store your email address, the name and picture Google or Apple share with us, your saved trails, hike history and the routes you walked (minus the first and last 200 m) so they're on all your devices. See Accounts below."],
    ['L44', "Your live location is never sent to our servers. If you're signed in, the route of a finished hike is saved to your account (minus the first and last 200 m), unless you turn on 'Keep hike tracks on this phone only'."],
    ['L48', "If you're not signed in, clearing the site's data in your browser (or deleting the app) deletes all of this, and we can't recover it, because we never had it. If you're signed in, your account copy stays until you delete it (see Deleting)."],
    ['L76', 'Accounts are optional. No payments, no ads, no marketing email, no sale or sharing of personal data, and no tracking across other apps or sites.'],
    ['L79', 'If we learn that a child under that age has an account, we delete it.'],
    ['L82', "and delete everything: if you're not signed in, by removing the app or clearing site data; if you're signed in, in Profile › Account or at hike.bbprojectfactory.com/account/delete/."],
  ])('%s', (_n, text) => { expect(_n === 'L8 meta' ? on : onText).toContain(text); });
  it('the page swaps are all registered for privacy/index.html and each one applies exactly once', () => {
    const swaps = STATIC_SWAPS.filter((s) => s.file === 'privacy/index.html');
    expect(swaps).toHaveLength(9);   // meta, date, L38, L44, L48, the list entries, L76, L79, L82
    for (const s of swaps) { expect(page.split(s.from).length - 1, s.from.slice(0, 40)).toBe(1); expect(s.to).not.toBe(s.from); }
  });
  it('a drifted source line fails the build loudly instead of silently missing', () => {
    expect(() => applyStaticSwaps('privacy/index.html', '<p>something else</p>', true)).toThrow(/expected text not found/);
  });
});

describe('flag on: the outside-services LIST, the Apple row, the date and the section', () => {
  const list = on.slice(on.indexOf('<h2>Services your device contacts</h2>'), on.indexOf('<h2>', on.indexOf('<h2>Services your device contacts</h2>') + 5));
  it('lists Supabase (United States/Oregon) and Google/Apple sign-in (only when you sign in) as entries', () => {
    expect(list).toContain('<li><strong>Supabase</strong> (our database, United States/Oregon).</li>');
    expect(list).toContain('<li><strong>Google/Apple sign-in</strong> (only when you sign in).</li>');
    expect(onText).toContain('Supabase (our database provider) stores your data in the United States (Oregon)');   // and the "Who stores it" paragraph still says it too
  });
  it('has the Apple-on-web row, tied to the host of the script the app loads', () => {
    expect(list).toContain(`<li>${APPLE_PRIVACY_LINE}</li>`);
    expect(APPLE_PRIVACY_LINE).toContain(`(${new URL(APPLE_JS_URL).hostname})`);
    expect(new URL(APPLE_JS_URL).hostname).toBe('appleid.cdn-apple.com');
    expect(on.split(APPLE_PRIVACY_LINE).length - 1).toBe(1);   // once, in the list
  });
  it('keeps the web Apple delete line', () => {
    expect(on).toContain('If you signed in with Apple on the web, or');
    expect(onText).toContain("If you signed in with Apple on the web, or that doesn't work, to fully disconnect, also remove Ridgeline in your Apple ID settings › Sign in with Apple (appleid.apple.com).");
  });
  it('has the go-live date as "Last updated", and the old date is gone', () => {
    expect(GO_LIVE_DATE).toBe('12 November 2026');
    expect(on).toContain(`Last updated ${GO_LIVE_DATE}`);
    expect(on).not.toContain('Last updated 10 November 2026');
  });
  it('has ONE Accounts heading and no second bold "Accounts (optional)." under it', () => {
    expect(on.match(/Accounts \(optional\)/g)).toHaveLength(1);
    expect(on).toContain('<h2>Accounts (optional)</h2>\n<p>You can use Ridgeline without an account.');
  });
  it('carries the approved deletion and code lines, and the "no room" and "couldn\'t be saved" notes live in the app', () => {
    expect(onText).toContain(DELETE_EMAIL_LINE.replace('›', '›'));
    expect(onText).toContain('The confirmation code expires after 23 days.');
    expect(onText).toContain('never more than one month after your request');
    expect(onText).not.toContain('once you confirm, we delete within 7 days.');
    const fullNote = readFileSync('src/lib/sync/fullNote.ts', 'utf8');
    expect(fullNote).toContain('has no room for more hikes');
    expect(fullNote).toContain("couldn't be saved to your account");
  });
  it('does NOT carry the mailer\'s "scrambled code" sentence (it ships with the mailer PR)', () => {
    expect(on).not.toMatch(/scrambled/i);
    expect(onText).not.toMatch(/HMAC|scrambled code/i);
  });
});
