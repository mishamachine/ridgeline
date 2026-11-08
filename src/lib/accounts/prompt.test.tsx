import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { canShow, dismiss, EMPTY_PROMPT_STATE, loadPromptState, markShown, savePromptState, MAX_DISMISSALS, PROMPT_KEY, type PromptContext, type PromptState } from './prompt';
import { ACCOUNTS_SECTION_HTML, accountsFlagOn, injectAccountsSection } from './privacyAccounts';
import { GuestPrompt, PROMPT_BODY, PROMPT_HEADLINE } from '../../components/GuestPrompt';
import { ProviderButton, googleArtwork } from '../../components/ProviderButton';
import { createHash } from 'node:crypto';
import { AccountRow } from '../../components/AccountRow';
import { Celebrate } from '../../screens/Celebrate';
import { features } from '../features';
import { readFileSync } from 'node:fs';
import { Profile, hikeDeleteText } from '../../screens/Profile';
import { deleteCopy } from '../../screens/DeleteAccount';
import { providerWords } from './copy';
import { providersFor } from './auth';

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
    expect(a).not.toContain('Keep this hike');
  });
  it('the flag is off in the shipped code', () => { expect(features.accounts).toBe(false); });
});

describe('the card (preview with the flag on)', () => {
  it('does not render before its trigger and is not a modal', () => {
    expect(renderToStaticMarkup(<GuestPrompt kinds={['save']} trigger={false} enabled />)).toBe('');
  });
  it('the celebration shows the card under Share when given one', () => {
    const summary = { trail: { id: 'osm-r1', name: 'Ledge', highlights: [] }, distanceM: 6000, climbFt: 1500, movingMs: 9_000_000, startedAt: 1, endedAt: 2, highlightsHit: [], completedFraction: 1, track: [] };
    const h = renderToStaticMarkup(<Celebrate summary={summary} onDone={() => {}} onShareApp={() => {}} guestPrompt={<section className="gp">Keep this hike</section>} />);
    expect(h.indexOf('Share my hike')).toBeLessThan(h.indexOf('Keep this hike'));
    expect(h.indexOf('Keep this hike')).toBeLessThan(h.indexOf('>Done<'));
  });
  it('Profile › Account for a guest shows the final banner with a Sign in link; the providers appear after tapping it', () => {
    const h = renderToStaticMarkup(<AccountRow enabled />);
    expect(h).toContain('Not signed in. Your hikes are saved only on this phone.');
    expect(h).toContain('>Sign in<');
    expect(h).not.toContain('Continue with Apple');
  });
});

describe('final prompt copy', () => {
  it('headlines and body are verbatim', () => {
    expect(PROMPT_HEADLINE).toEqual({ save: 'Keep your saved trails', hike: 'Keep this hike', badge: 'Keep your badges' });
    expect(PROMPT_BODY).toBe("Right now they're saved only on this phone. Sign in to keep them if you lose or switch phones.");
  });
  it('Google uses its official artwork unmodified; Apple has its exact wording and mark; both are the same size', () => {
    const apple = renderToStaticMarkup(<ProviderButton provider="apple" platform="web" onClick={() => {}} />);
    const google = renderToStaticMarkup(<ProviderButton provider="google" platform="web" onClick={() => {}} />);
    expect(apple).toContain('Continue with Apple');
    expect(apple).toContain('<svg');
    expect(google).toContain('<img');
    expect(google).toContain('aria-label="Sign in with Google"');
    expect(apple).toContain('width:180px;height:40px');
    expect(google).toContain('width:180px;height:40px');
    expect(renderToStaticMarkup(<ProviderButton provider="apple" platform="ios" onClick={() => {}} />)).toContain('width:188px;height:44px');
    expect(renderToStaticMarkup(<ProviderButton provider="google" platform="ios" onClick={() => {}} />)).toContain('width:188px;height:44px');
    expect(googleArtwork('android', 'light')).toMatchObject({ w: 180, h: 40 });
    expect(googleArtwork('ios', 'dark')).toMatchObject({ w: 188, h: 44 });
    const css = readFileSync('src/components/guestPrompt.css', 'utf8');
    expect(css).toMatch(/gp-btn-apple\.gp-on-light \{ background: #000000; color: #FFFFFF/);
  });
  it('the Google artwork in the repo is byte-identical to the recorded download (sha256 in docs/BRAND_ASSETS.md)', () => {
    const doc = readFileSync('docs/BRAND_ASSETS.md', 'utf8');
    for (const f of ['google-signin-light-web.svg', 'google-signin-dark-web.svg', 'google-signin-light-ios.svg', 'google-signin-dark-ios.svg']) {
      const bytes = readFileSync(`src/assets/brand/${f}`);
      const sha = createHash('sha256').update(bytes).digest('hex');
      expect(doc, f).toContain(sha);
      expect(bytes.toString('utf8')).not.toMatch(/<script|onload=|href="http/);
    }
  });
});

describe('Android copy says Google only; web and iOS keep Google or Apple', () => {
  it('the helper words', () => {
    expect(providerWords('android')).toBe('Google');
    expect(providerWords('ios')).toBe('Google or Apple');
    expect(providerWords('web')).toBe('Google or Apple');
  });
  it('the whole-account warning drops the Apple sentence on Android only', () => {
    expect(deleteCopy('android').account.warn).not.toMatch(/Apple/);
    expect(deleteCopy('ios').account.warn).toContain('On iPhone Apple sign-ins we also disconnect Ridgeline from your Apple ID');
    expect(deleteCopy('web').account.warn).toContain('Apple ID settings');
    expect(deleteCopy('android').account.warn).toContain('Bobo Learns Chess');   // the rest is the same
  });
  it('Android offers only the Google button', () => {
    expect(providersFor('android')).toEqual(['google']);
    expect(providersFor('ios')).toEqual(['apple', 'google']);
  });
});

describe('the Saved tab leaves nothing behind when the prompt is not shown', () => {
  it('the card has its own margin class and no wrapper element is rendered around the slot', () => {
    const src = readFileSync('src/screens/Saved.tsx', 'utf8');
    expect(src).toContain('{renderPrompt?.(');
    expect(src).not.toMatch(/renderPrompt && <div/);
    expect(readFileSync('src/components/guestPrompt.css', 'utf8')).toContain('.gp-in-list');
    expect(renderToStaticMarkup(<GuestPrompt kinds={['save']} trigger={false} inList enabled />)).toBe('');
  });
});

describe('deleting a hike while signed in', () => {
  it('says it is deleted everywhere, on all signed-in phones', () => {
    expect(hikeDeleteText(true)).toBe('Delete this hike everywhere? It is removed from your account and from every phone you are signed in on. This cannot be undone.');
    expect(hikeDeleteText(false)).toBe('Delete this hike from your phone? This cannot be undone.');
  });
});

describe('Profile shows a hike whose route lives on another phone', () => {
  const trail = { id: 'osm-r1', name: 'Ledge', coords: [], lengthM: 1, loop: false, partial: false, osmUrl: '', tags: {} };
  const a = { id: 'h2', name: 'Rattlesnake Ledge', trailId: 'osm-r1', startedAt: Date.UTC(2026, 10, 1, 17), endedAt: Date.UTC(2026, 10, 1, 20), points: [], summary: { distanceM: 6115, durationMs: 3 * 3_600_000, climbM: 470 } };
  it('as a summary row with the date, distance, time and climb and the note', () => {
    const h = renderToStaticMarkup(<Profile onOpenBadges={() => {}} onReplayTour={() => {}} preset={{ activities: [a as never], trails: [trail as never] }} />);
    expect(h).toContain('Rattlesnake Ledge');
    expect(h).toContain('Route kept on your other phone');
    expect(h).toContain('3.8 mi');
    expect(h).toContain('3 h 0 min');
    expect(h).toContain('climbed');
    expect(h).toContain('Nov 1, 2026');
  });
  it('a hike with neither route nor summary is still not listed', () => {
    const h = renderToStaticMarkup(<Profile onOpenBadges={() => {}} onReplayTour={() => {}} preset={{ activities: [{ ...a, summary: undefined } as never], trails: [trail as never] }} />);
    expect(h).not.toContain('Rattlesnake Ledge');
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
  it('a page that carries the Accounts section only ships with the flag ON (fails if the privacy rewrite lands with the flag off)', () => {
    const hasSection = page.includes('Accounts (optional)');
    const flagOn = accountsFlagOn(readFileSync('src/lib/features.ts', 'utf8'));
    if (hasSection) expect(flagOn, 'public/privacy/index.html describes accounts but features.accounts is false: flip the flag in the same change, or drop the rewrite').toBe(true);
    // And the other way round: with the flag on, the built page always gets the section (from the source or the build step).
    expect(injectAccountsSection(page, flagOn).includes('Accounts (optional)')).toBe(flagOn || hasSection);
  });
  it('does not add the section twice when the rewritten page already has it', () => {
    const rewritten = injectAccountsSection(page, true);
    expect(injectAccountsSection(rewritten, true)).toBe(rewritten);
  });
  it('the Apple promise is conditional and carries the manual line', () => {
    expect(ACCOUNTS_SECTION_HTML).toContain('If you signed in with Apple on an iPhone, we also tell Apple to disconnect Ridgeline.');
    expect(ACCOUNTS_SECTION_HTML).toContain('to fully disconnect, also remove Ridgeline in your Apple ID settings &rsaquo; Sign in with Apple (appleid.apple.com)');
    expect(ACCOUNTS_SECTION_HTML).not.toContain('If you used Sign in with Apple, we also tell Apple');
  });
  it('the service worker does not precache the sign-in library', () => {
    const cfg = readFileSync('vite.config.ts', 'utf8');
    expect(cfg).toMatch(/globIgnores:\s*\[[^\]]*supabase-/);
    expect(cfg).toMatch(/name:\s*'supabase'/);
  });
  it('reads the flag from features.ts text', () => {
    expect(accountsFlagOn('  accounts: true,')).toBe(true);
    expect(accountsFlagOn('  // accounts: true\n  accounts: false,')).toBe(false);
  });
});
