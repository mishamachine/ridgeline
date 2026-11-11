import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DELETION_TIMING } from './copy';
import { ACCOUNTS_SECTION_HTML } from './privacyAccounts';
import { DeleteAccount, deleteCopy, resultText } from '../../screens/DeleteAccount';

const SENTENCE = 'Deleting removes your data from our live systems, normally straight away and always within 7 days; backup copies are erased within 8 days, when backups roll over.';

describe('the deletion-timing sentence is pinned, verbatim, in every place', () => {
  it('the constant is the approved sentence', () => { expect(DELETION_TIMING).toBe(SENTENCE); });
  it('the privacy Accounts section', () => { expect(ACCOUNTS_SECTION_HTML).toContain(SENTENCE); });
  it('the in-app confirmations for both deletes, on every platform (the /account/delete/ page shows these)', () => {
    for (const p of ['web', 'ios', 'android'] as const) {
      expect(deleteCopy(p).data.warn).toContain(SENTENCE);
      expect(deleteCopy(p).account.warn).toContain(SENTENCE);
    }
  });
  it('the messages after a delete (data only and whole account)', () => {
    expect(resultText('data', { status: 'ok', apple: 'none' })).toContain(SENTENCE);
    for (const apple of ['none', 'manual', 'revoked'] as const) expect(resultText('account', { status: 'ok', apple })).toContain(SENTENCE);
  });
});

describe('no "instantly", and no "straight away" outside that sentence, in any deletion copy', () => {
  const files = ['src/screens/DeleteAccount.tsx', 'src/lib/accounts/privacyAccounts.ts', 'src/lib/accounts/copy.ts', 'public/privacy/index.html', 'public/support/index.html', 'docs/BRAND_ASSETS.md'];
  it.each(files)('%s', (f) => {
    const text = readFileSync(f, 'utf8');
    expect(text.toLowerCase()).not.toContain('instantly');
    expect(text.split(SENTENCE).join('').toLowerCase()).not.toContain('straight away');
  });
  it('the texts built from the helpers too', () => {
    const all = [ACCOUNTS_SECTION_HTML, ...(['web', 'android'] as const).flatMap((p) => [deleteCopy(p).data.warn, deleteCopy(p).account.warn]), resultText('account', { status: 'ok', apple: 'manual' }), resultText('data', { status: 'ok', apple: 'none' })].join('\n');
    expect(all.toLowerCase()).not.toContain('instantly');
    expect(all.split(SENTENCE).join('').toLowerCase()).not.toContain('straight away');
  });
});

describe('deletion by email (Play needs a way to ask without the app): one sentence, one source', () => {
  const LINE = "You can also email machinemisha@gmail.com from your account's email address. We'll send a confirmation to that address. Once you confirm, we delete within 7 days, and never more than one month after your request. The confirmation code expires after 23 days. (If you signed in with Apple's Hide My Email, delete in Profile › Account instead.)";
  const MAIL = 'mailto:machinemisha@gmail.com?subject=Ridgeline%20account%20deletion';
  const plain = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&rsaquo;/g, '›').replace(/&#x27;/g, "'");
  it('the constant is the approved sentence, verbatim', async () => {
    const { DELETE_EMAIL_LINE } = await import('./copy');
    expect(DELETE_EMAIL_LINE).toBe(LINE);
  });
  it('the privacy Accounts section carries it, with the address as a mailto link', async () => {
    const { deleteEmailLineHtml } = await import('./copy');
    expect(ACCOUNTS_SECTION_HTML).toContain(deleteEmailLineHtml());
    expect(plain(ACCOUNTS_SECTION_HTML)).toContain(LINE);
    expect(ACCOUNTS_SECTION_HTML).toContain(`<a href="${MAIL}">machinemisha@gmail.com</a>`);
    expect(ACCOUNTS_SECTION_HTML).not.toContain('without opening the app');   // the older sentence is gone
  });
  it('the /account/delete/ page carries it too', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const html = renderToStaticMarkup(<DeleteAccount onBack={() => {}} />);
    expect(plain(html)).toContain(LINE);
    expect(html).toContain(`href="${MAIL}"`);
  });
  it('one source: both places are built from the same parts', async () => {
    const { DELETE_EMAIL_BEFORE, DELETE_EMAIL_AFTER, DELETE_MAILTO } = await import('./copy');
    expect(DELETE_MAILTO).toBe(MAIL);
    expect(readFileSync('src/screens/DeleteAccount.tsx', 'utf8')).toContain('{DELETE_EMAIL_BEFORE}');
    expect(readFileSync('src/screens/DeleteAccount.tsx', 'utf8')).not.toContain("from your account's email address");
    expect(readFileSync('src/lib/accounts/privacyAccounts.ts', 'utf8')).toContain('${deleteEmailLineHtml()}');
    expect(readFileSync('src/lib/accounts/privacyAccounts.ts', 'utf8')).not.toContain("from your account's email address");
    expect(DELETE_EMAIL_BEFORE + 'machinemisha@gmail.com' + DELETE_EMAIL_AFTER).toBe(LINE);
  });
});

describe('the deletion timing sentence (CBO ruling): one constant, eight days for backups, no other copy of the old wording', () => {
  const NEWER = 'Deleting removes your data from our live systems, normally straight away and always within 7 days; backup copies are erased within 8 days, when backups roll over.';
  it('the constant is the approved sentence, verbatim', () => { expect(DELETION_TIMING).toBe(NEWER); });
  it('the privacy Accounts section, the delete screen, both confirmations and the runbook template all carry it', async () => {
    const { ACCOUNTS_SECTION_HTML } = await import('./privacyAccounts');
    expect(ACCOUNTS_SECTION_HTML).toContain(DELETION_TIMING);
    const screen = readFileSync('src/screens/DeleteAccount.tsx', 'utf8');
    expect(screen.match(/\$\{DELETION_TIMING\}/g)!.length).toBeGreaterThanOrEqual(4);   // the two warnings and the two results
    expect(readFileSync('docs/DELETE_BY_EMAIL.md', 'utf8')).toContain(DELETION_TIMING);
    for (const f of ['src/lib/accounts/privacyAccounts.ts', 'src/screens/DeleteAccount.tsx']) expect(readFileSync(f, 'utf8')).not.toContain('backup copies are erased');   // the words live in copy.ts only
  });
  it('the old seven-day backup wording exists nowhere in src/, public/ or docs/', () => {
    const old = 'within 7 days' + ', when backups roll over';   // built in two pieces so this file does not contain it
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? (n === 'node_modules' ? [] : walk(p)) : [p]; });
    const hits = ['src', 'public', 'docs'].flatMap(walk).filter((f) => /\.(ts|tsx|html|md|json|txt|css)$/.test(f) && readFileSync(f, 'utf8').includes(old));
    expect(hits).toEqual([]);
  });
  it('the runbook says why 8: PITR off, 7 daily backups, re-check before any change', () => {
    const mail = readFileSync('docs/DELETE_BY_EMAIL.md', 'utf8');
    for (const s of ['point-in-time recovery (PITR) being OFF', '7 daily backups', 'Checked read-only on 10 November 2026', 're-check this line BEFORE making that change', 'a future mailer must import it']) expect(mail, s).toContain(s);
  });
});
