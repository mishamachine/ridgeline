import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { canShow, dismiss, EMPTY_PROMPT_STATE, loadPromptState, markShown, savePromptState, MAX_DISMISSALS, PROMPT_KEY, type PromptContext, type PromptState } from './prompt';
import { ACCOUNTS_SECTION_HTML, accountsFlagOn, injectAccountsSection } from './privacyAccounts';
import { GuestPrompt } from '../../components/GuestPrompt';
import { AccountRow } from '../../components/AccountRow';
import { Celebrate } from '../../screens/Celebrate';
import { features } from '../features';
import { readFileSync } from 'node:fs';

const ok: PromptContext = { accountsOn: true, signedIn: false, onboardingDone: true, hikeActive: false };
const fresh = (): PromptState => ({ shown: {}, dismissals: 0 });
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };

describe('guest prompt rules', () => {
  it('shows each kind once', () => {
    let st = fresh();
    expect(canShow(['save'], st, ok)).toBe(true);
    st = markShown(st, ['save']);
    expect(canShow(['save'], st, ok)).toBe(false);
    expect(canShow(['hike'], st, ok)).toBe(true);
  });
  it('the first hike and its first badge share one card and use up both kinds', () => {
    const st = markShown(fresh(), ['hike', 'badge']);
    expect(canShow(['hike', 'badge'], st, ok)).toBe(false);
  });
  it('goes silent for good after 3 dismissals, even for kinds not yet shown', () => {
    let st = fresh();
    for (let i = 0; i < MAX_DISMISSALS; i++) st = dismiss(st);
    expect(canShow(['badge'], st, ok)).toBe(false);
    expect(canShow(['badge'], dismiss(dismiss(fresh())), ok)).toBe(true);
  });
  it('never during a hike, before the tour is done, when signed in, or with accounts off', () => {
    expect(canShow(['save'], fresh(), { ...ok, hikeActive: true })).toBe(false);
    expect(canShow(['save'], fresh(), { ...ok, onboardingDone: false })).toBe(false);
    expect(canShow(['save'], fresh(), { ...ok, signedIn: true })).toBe(false);
    expect(canShow(['save'], fresh(), { ...ok, accountsOn: false })).toBe(false);
  });
  it('persists, and survives garbage in storage', () => {
    const s = mem();
    savePromptState(s, dismiss(markShown(fresh(), ['save'])));
    expect(loadPromptState(s)).toEqual({ shown: { save: true }, dismissals: 1 });
    s.setItem(PROMPT_KEY, '{nonsense');
    expect(loadPromptState(s)).toEqual(EMPTY_PROMPT_STATE);
    s.setItem(PROMPT_KEY, JSON.stringify({ shown: { save: 'yes', hike: true }, dismissals: -4 }));
    expect(loadPromptState(s)).toEqual({ shown: { hike: true }, dismissals: 0 });
  });
});

describe('flag OFF: no prompt and no account UI anywhere', () => {
  it('the card renders nothing', () => { expect(renderToStaticMarkup(<GuestPrompt kinds={['hike']} trigger />)).toBe(''); });
  it('the Profile account row renders nothing', () => { expect(renderToStaticMarkup(<AccountRow />)).toBe(''); });
  it('the celebration looks the same without a prompt', () => {
    const summary = { trail: { id: 'osm-r1', name: 'Ledge', highlights: [] }, distanceM: 6000, climbFt: 1500, movingMs: 9_000_000, startedAt: 1, endedAt: 2, highlightsHit: [], completedFraction: 1, track: [] };
    const a = renderToStaticMarkup(<Celebrate summary={summary} onDone={() => {}} onShareApp={() => {}} />);
    const b = renderToStaticMarkup(<Celebrate summary={summary} onDone={() => {}} onShareApp={() => {}} guestPrompt={<GuestPrompt kinds={['hike']} trigger />} />);
    expect(b).toBe(a);
    expect(a).not.toContain('Keep your hikes safe');
  });
  it('the flag is off in the shipped code', () => { expect(features.accounts).toBe(false); });
});

describe('the card (preview with the flag on)', () => {
  it('does not render before its trigger and is not a modal', () => {
    expect(renderToStaticMarkup(<GuestPrompt kinds={['save']} trigger={false} enabled />)).toBe('');
  });
  it('the celebration shows the card under Share when given one', () => {
    const summary = { trail: { id: 'osm-r1', name: 'Ledge', highlights: [] }, distanceM: 6000, climbFt: 1500, movingMs: 9_000_000, startedAt: 1, endedAt: 2, highlightsHit: [], completedFraction: 1, track: [] };
    const h = renderToStaticMarkup(<Celebrate summary={summary} onDone={() => {}} onShareApp={() => {}} guestPrompt={<section className="gp">Keep your hikes safe</section>} />);
    expect(h.indexOf('Share my hike')).toBeLessThan(h.indexOf('Keep your hikes safe'));
    expect(h.indexOf('Keep your hikes safe')).toBeLessThan(h.indexOf('>Done<'));
  });
  it('Profile › Account for a guest shows the banner and both providers', () => {
    const h = renderToStaticMarkup(<AccountRow enabled />);
    expect(h).toContain('Signed out: your hikes live only on this phone.');
    expect(h).toContain('Continue with Apple');
  });
});

describe('privacy page', () => {
  const page = readFileSync('public/privacy/index.html', 'utf8');
  it('is unchanged while the flag is off, so the text is never ahead of the feature', () => {
    expect(injectAccountsSection(page, false)).toBe(page);
    expect(accountsFlagOn(readFileSync('src/lib/features.ts', 'utf8'))).toBe(false);
  });
  it('gets the Accounts section before "Your choices" when the flag is on', () => {
    const on = injectAccountsSection(page, true);
    expect(on).toContain('Accounts (optional).');
    expect(on.indexOf('Accounts (optional)')).toBeLessThan(on.indexOf('<h2>Your choices</h2>'));
  });
  it('carries the approved wording', () => {
    for (const s of ['the first and last 200 m removed', 'Supabase (our database provider) stores your data in the United States (Oregon)', 'backup copies are erased within 7 days, when backups roll over',
      'Signing in to Ridgeline doesn\'t share your hikes with those apps', 'Usage counts are never linked to your account', 'we also tell Apple to disconnect Ridgeline', 'the name and profile picture Google or Apple share with us'])
      expect(ACCOUNTS_SECTION_HTML).toContain(s);
    expect(ACCOUNTS_SECTION_HTML).not.toMatch(/Babar|\[N\]|TODO/);
  });
  it('reads the flag from features.ts text', () => {
    expect(accountsFlagOn('  accounts: true,')).toBe(true);
    expect(accountsFlagOn('  // accounts: true\n  accounts: false,')).toBe(false);
  });
});
