import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { clearNotNow, hasSaidNotNow, saidNotNow, shouldAskOwner } from './ownerPending';
import { AccountRow } from '../../components/AccountRow';
import { FULL_NOTE } from './fullNote';
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
  it('the account-full note, verbatim, only when it is due', () => {
    expect(FULL_NOTE).toBe('Your account is full. New hikes are saved on this phone only.');
    expect(renderToStaticMarkup(<AccountRow enabled account={acct('B')} ownerPending={null} fullNote={[FULL_NOTE]} />)).toContain('Your account is full. New hikes are saved on this phone only.');
    expect(renderToStaticMarkup(<AccountRow enabled account={acct('B')} ownerPending={null} fullNote={[]} />)).not.toContain('Your account is full');
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
