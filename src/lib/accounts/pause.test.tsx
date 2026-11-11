import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { FLAGS_KEY, FLAGS_REFRESH_MS, FLAGS_URL, accountsLive, accountsState, readFlags, refreshFlags, remoteState } from './flags';
import { AccountRow, PAUSED_NOTE } from '../../components/AccountRow';
import { GuestPrompt } from '../../components/GuestPrompt';
import { getClient } from './client';
import { signIn } from './auth';
import { parseRoute } from '../route';

const mem = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body })) as unknown as typeof fetch;
const T0 = 1_700_000_000_000;

describe('the runtime flag: reading it', () => {
  it('is "unknown", and accounts are NOT live, before the first fetch on a new install', () => {
    const s = mem();
    expect(remoteState(s)).toBe('unknown');
    expect(accountsState(true, s)).toBe('unknown');
    expect(accountsLive(true, s)).toBe(false);
  });
  it('reads {"accounts": true} and {"accounts": false} from our own host with no cache', async () => {
    const s = mem(), f = reply({ accounts: true });
    await refreshFlags(f, T0, false, s);
    expect(f).toHaveBeenCalledWith(FLAGS_URL, { cache: 'no-store' });
    expect(FLAGS_URL).toBe('https://hike.bbprojectfactory.com/flags.json');
    expect(accountsLive(true, s)).toBe(true);
    await refreshFlags(reply({ accounts: false }), T0 + FLAGS_REFRESH_MS + 1, false, s);
    expect(accountsState(true, s)).toBe('paused');
  });
  it('asks at most once an hour', async () => {
    const s = mem(), f = reply({ accounts: true });
    await refreshFlags(f, T0, false, s);
    await refreshFlags(f, T0 + 60_000, false, s);
    await refreshFlags(f, T0 + FLAGS_REFRESH_MS - 1, false, s);
    expect(f).toHaveBeenCalledTimes(1);
    await refreshFlags(f, T0 + FLAGS_REFRESH_MS + 1, false, s);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('a failed fetch keeps the last known value (and does not hammer the host)', async () => {
    const s = mem();
    await refreshFlags(reply({ accounts: true }), T0, false, s);
    for (const bad of [reply({}, false), vi.fn(async () => { throw new TypeError('offline'); }) as unknown as typeof fetch, reply({ accounts: 'yes' }), reply(null)]) {
      await refreshFlags(bad, T0 + FLAGS_REFRESH_MS + 5, true, s);
      expect(accountsLive(true, s)).toBe(true);
    }
    expect(readFlags(s)!.accounts).toBe(true);
    // and on a new install a failed fetch leaves it unknown, i.e. off
    const fresh = mem();
    await refreshFlags(reply({}, false), T0, false, fresh);
    expect(accountsLive(true, fresh)).toBe(false);
    expect(fresh.m.has(FLAGS_KEY)).toBe(false);
  });
  it('the build flag still rules: without accounts built in, nothing is ever live', () => {
    const s = mem(); s.setItem(FLAGS_KEY, JSON.stringify({ accounts: true, at: 1, tried: 1 }));
    expect(accountsState(false, s)).toBe('off');
    expect(accountsLive(false, s)).toBe(false);
  });
});

describe('paused: guest mode works exactly as today, sign-in is hidden, nothing syncs', () => {
  it('Profile › Account shows the quiet note and no sign-in; a signed-out guest sees no delete buttons', () => {
    const s = mem(); s.setItem(FLAGS_KEY, JSON.stringify({ accounts: false, at: 1, tried: 1 }));
    vi.stubGlobal('localStorage', s);
    try {
      const h = renderToStaticMarkup(<AccountRow build />);
      expect(h).toContain('Sign-in is paused for now. Your hikes are safe on this phone.');
      expect(PAUSED_NOTE).toBe('Sign-in is paused for now. Your hikes are safe on this phone.');
      expect(h).not.toContain('Sign in<');
      expect(h).not.toContain('Continue with Apple');
      expect(h).not.toContain('Delete');
    } finally { vi.unstubAllGlobals(); }
  });
  it('while paused, anyone WITH a session can still delete their data or their whole account', () => {
    const s = mem(); s.setItem(FLAGS_KEY, JSON.stringify({ accounts: false, at: 1, tried: 1 }));
    vi.stubGlobal('localStorage', s);
    try {
      const account = { signedIn: true, email: 'a@example.com', provider: 'google' as const, userId: 'u1' };
      const h = renderToStaticMarkup(<AccountRow build account={account} onOpenDelete={() => {}} />);
      expect(h).toContain('Sign-in is paused for now. Your hikes are safe on this phone.');
      expect(h).toContain('Delete my Ridgeline data');
      expect(h).toContain('Delete my whole account');
      expect(h).not.toContain('Sign in<');
    } finally { vi.unstubAllGlobals(); }
  });
  it('before the flag is known the account row shows nothing at all, not even the pause note', () => {
    vi.stubGlobal('localStorage', mem());
    try {
      expect(renderToStaticMarkup(<AccountRow build />)).toBe('');   // accounts built in, flag not read yet: nothing about accounts
      expect(renderToStaticMarkup(<AccountRow />)).toBe('');        // and with accounts not built in (today)
    } finally { vi.unstubAllGlobals(); }
  });
  it('the guest prompt never shows, no client is created, sign-in is unavailable', async () => {
    expect(renderToStaticMarkup(<GuestPrompt kinds={['hike']} trigger enabled={false} />)).toBe('');
    expect(getClient(accountsLive(true, mem()))).toBeNull();
    expect(await signIn('google', false)).toEqual({ ok: false, reason: 'unavailable' });
  });
  it('the delete page stays reachable while paused (people can always delete)', () => {
    expect(parseRoute('/account/delete/', '', '/', false, true)).toEqual({ kind: 'account-delete' });
  });
});

describe('the runbooks are in the repo and point at each other', () => {
  const pause = readFileSync('docs/PAUSE.md', 'utf8');
  const mail = readFileSync('docs/DELETE_BY_EMAIL.md', 'utf8');
  it('PAUSE.md links the email-deletion runbook and states the paused sign-in rule exactly', () => {
    expect(pause).toContain('[DELETE_BY_EMAIL.md](DELETE_BY_EMAIL.md)');
    expect(pause).toContain('returns a DIFFERENT account, the app signs it out again at once and says so');
    expect(pause).toContain('What this does not prevent');
    expect(pause).not.toContain('never creates a new account');
  });
  it('DELETE_BY_EMAIL.md covers the owner, the identity check, the exact steps, the reply and the 7-day rule', () => {
    for (const s of ['the owner/operator', 'must come FROM the address on the account', 'privaterelay.appleid.com', "select ridgeline.delete_user_data('<uid>')", 'ridgeline.read_apple_token', 'revokeAppleToken', "ridgeline.delete_apple_token('<uid>')", 'auth.admin.deleteUser', 'Reply (template)', 'within 7 days', 'production action']) expect(mail, s).toContain(s);
    expect(mail).toContain('[PAUSE.md](PAUSE.md)');
  });
});
