import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyStaticSwaps, BADGES_FOOTER, pick, PROFILE_LOCATION_SENTENCE, STATIC_SWAPS, TOUR_BADGES_SENTENCE, TOUR_LOCATION_PERK } from './goLiveCopy';
import { accountsFlagOn } from './privacyAccounts';

const flagOn = accountsFlagOn(readFileSync('src/lib/features.ts', 'utf8'));
const file = (f: string) => readFileSync(f === 'llms.txt' ? 'public/llms.txt' : `public/${f}`, 'utf8');

describe('account lines in the app follow features.accounts', () => {
  it('today (flag off) the old, true text shows; with it on, the new text', () => {
    expect(pick(BADGES_FOOTER, false)).toBe('Kept on your phone; no account.');
    expect(pick(BADGES_FOOTER, true)).toBe('Saved on your phone, and in your account if you sign in.');
    expect(pick(TOUR_BADGES_SENTENCE, false)).toBe('They stay on your phone.');
    expect(pick(TOUR_BADGES_SENTENCE, true)).toBe("They're saved on your phone, and in your account if you sign in.");
    expect(pick(TOUR_LOCATION_PERK, false)).toBe('Stays on your phone. Never sent to our servers.');
    expect(pick(PROFILE_LOCATION_SENTENCE, false)).toBe('Your location is never sent to our servers.');
    expect(pick(PROFILE_LOCATION_SENTENCE, true)).toContain('minus the first and last 200 m');
  });
  it('the shipped flag is off, so pick() gives the old text', () => {
    expect(flagOn).toBe(false);
    expect(pick(BADGES_FOOTER)).toBe(BADGES_FOOTER.off);
  });
  it('the screens use pick(), not hard-coded account claims', () => {
    expect(readFileSync('src/screens/Badges.tsx', 'utf8')).toContain('pick(BADGES_FOOTER)');
    expect(readFileSync('src/screens/Onboarding.tsx', 'utf8')).toContain('pick(TOUR_BADGES_SENTENCE)');
    expect(readFileSync('src/screens/Onboarding.tsx', 'utf8')).toContain('pick(TOUR_LOCATION_PERK)');
    expect(readFileSync('src/screens/Profile.tsx', 'utf8')).toContain('pick(PROFILE_LOCATION_SENTENCE)');
  });
});

describe('static pages get the go-live wording only when accounts are on', () => {
  it('every source line the swap expects is still there exactly once (a drift would silently skip the swap)', () => {
    for (const s of STATIC_SWAPS) expect(file(s.file).split(s.from).length - 1, s.from.slice(0, 40)).toBe(1);
  });
  it('flag off: the page is untouched', () => {
    for (const f of new Set(STATIC_SWAPS.map((s) => s.file))) expect(applyStaticSwaps(f, file(f), false)).toBe(file(f));
  });
  it('flag on: the new wording appears, word for word', () => {
    const support = applyStaticSwaps('support/index.html', file('support/index.html'), true);
    expect(support).toContain('sign in with Google or Apple to keep your hikes and saved trails on all your devices.');
    expect(support).not.toContain('on all your phones');
    expect(support).not.toContain('No account, no sign-in');
    const llms = applyStaticSwaps('llms.txt', file('llms.txt'), true);
    expect(llms).toContain('Accounts are optional (Google or Apple).');
    expect(llms).not.toContain('No accounts.');
  });
  it('guard: the source pages must not already carry the account wording while the flag is off (so #28 cannot land early by accident)', () => {
    for (const s of STATIC_SWAPS) if (!flagOn) expect(file(s.file).includes(s.to), s.to.slice(0, 40)).toBe(false);
  });
  it('a swap that cannot find its text fails loudly', () => {
    expect(() => applyStaticSwaps('llms.txt', 'something else', true)).toThrow('expected text not found');
  });
});
