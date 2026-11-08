import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DELETION_TIMING } from './copy';
import { ACCOUNTS_SECTION_HTML } from './privacyAccounts';
import { deleteCopy, resultText } from '../../screens/DeleteAccount';

const SENTENCE = 'Deleting removes your data from our live systems, normally straight away and always within 7 days; backup copies are erased within 7 days, when backups roll over.';

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
