import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { clearNotNow, hasSaidNotNow, saidNotNow, shouldAskOwner } from './ownerPending';
import { AccountRow } from '../../components/AccountRow';
import { FULL_NOTE_HIKES, FULL_NOTE_SAVED, FULL_NOTE_SHORTLIST } from './fullNote';
import { readFileSync } from 'node:fs';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const acct = (id: string) => ({ signedIn: true, email: null, provider: 'google' as const, userId: id });

describe('the different-account choice is remembered per account', () => {
  it('"Not now" for one account never silences another', () => {
    const s = mem();
    expect(shouldAskOwner('B', 'B', s)).toBe(true);
    saidNotNow('B', s);
    expect(hasSaidNotNow('B', s)).toBe(true);
    expect(shouldAskOwner('B', 'B', s)).toBe(false);          // B asked not to be asked again now
    expect(shouldAskOwner('C', 'C', s)).toBe(true);           // C signing in on the same phone is asked
    clearNotNow('B', s);
    expect(shouldAskOwner('B', 'B', s)).toBe(true);
  });
  it('nothing to ask when there is no pending choice, or it belongs to someone else', () => {
    const s = mem();
    expect(shouldAskOwner(null, 'B', s)).toBe(false);
    expect(shouldAskOwner('A', 'B', s)).toBe(false);
    expect(shouldAskOwner('B', null, s)).toBe(false);
  });
});

describe('Profile › Account keeps reminding while sync is blocked, and shows the full note once', () => {
  it('a persistent note with both choices for the account that is waiting; none for anyone else', () => {
    const waiting = renderToStaticMarkup(<AccountRow enabled account={acct('B')} ownerPending="B" fullNote={[]} />);
    expect(waiting).toContain('so nothing is syncing yet');
    expect(waiting).toContain('Add them to this account');
    expect(waiting).toContain('Remove them from this phone');
    expect(renderToStaticMarkup(<AccountRow enabled account={acct('C')} ownerPending="B" fullNote={[]} />)).not.toContain('nothing is syncing yet');
    expect(renderToStaticMarkup(<AccountRow enabled account={acct('B')} ownerPending={null} fullNote={[]} />)).not.toContain('nothing is syncing yet');
  });
  it('the account-full lines, verbatim, only for the full types, stacked, never combined', () => {
    const row = (notes: string[]) => renderToStaticMarkup(<AccountRow enabled account={acct('B')} ownerPending={null} fullNote={notes} />);
    expect(row([FULL_NOTE_HIKES])).toContain('Your account has no room for more hikes. New hikes are saved on this phone only.');
    expect(row([FULL_NOTE_SAVED])).toContain('Your account has no room for more saved trails. New saved trails stay on this phone only.');
    expect(row([FULL_NOTE_SHORTLIST])).toContain('Your account has no room for more shortlisted trails. New ones stay on this phone only.');
    const two = row([FULL_NOTE_HIKES, FULL_NOTE_SHORTLIST]);
    expect(two).toContain(FULL_NOTE_HIKES); expect(two).toContain(FULL_NOTE_SHORTLIST); expect(two).not.toContain(FULL_NOTE_SAVED);
    expect(two.indexOf(FULL_NOTE_HIKES)).toBeLessThan(two.indexOf(FULL_NOTE_SHORTLIST));
    expect(row([])).not.toContain('no room for more');
  });
  it('the sign-out question says a kept copy can go to whichever account signs in next, and the delete warning mentions a hike in progress elsewhere', () => {
    expect(readFileSync('src/components/AccountRow.tsx', 'utf8')).toContain('A kept copy can be added to whichever account signs in next.');
    expect(readFileSync('src/screens/DeleteAccount.tsx', 'utf8')).toContain('A hike being recorded on another phone is kept there and uploads again when it ends.');
  });
});

describe('PAUSE.md lists every exception', () => {
  const doc = readFileSync('docs/PAUSE.md', 'utf8');
  it('names each one', () => {
    for (const s of ['The exceptions while paused', 'Delete.', 'Re-signing in to confirm a delete', 'only on a phone that already has, or had, an account session', 'signs it out again at once', 'writes no profile row', 'The session itself', 'Reading the flag file']) expect(doc).toContain(s);
  });
});
