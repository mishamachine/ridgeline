import { describe, it, expect, vi } from 'vitest';
import { deleteAccount, type DeleteDeps } from '../../../supabase/functions/_shared/deleteAccount';
import { revokeAppleToken } from '../../../supabase/functions/_shared/apple';
import { deleteMyAccount } from './auth';
import { syncGate } from '../sync/gate';
import { recentSignIn } from '../../../supabase/functions/_shared/reauth';
import { APPLE_MANUAL_LINE, COPY, resultText } from '../../screens/DeleteAccount';
import { parseRoute, routePath } from '../route';
import { SYNCED_SETTING_KEYS, sanitize } from '../settings';

function deps(over: Partial<DeleteDeps> = {}) {
  const calls: string[] = [];
  const d: DeleteDeps = {
    hasAppleIdentity: true,
    deleteUserData: async () => { calls.push('data'); },
    readAppleToken: async () => { calls.push('read'); return 'refresh-1'; },
    revokeApple: async () => { calls.push('revoke'); },
    deleteAppleToken: async () => { calls.push('delete-secret'); },
    deleteAuthUser: async () => { calls.push('delete-user'); },
    log: (e) => calls.push('log:' + e),
    ...over,
  };
  return { d, calls };
}
const boom = (name: string) => async () => { throw new Error(name); };

describe('delete: Ridgeline data only (path a)', () => {
  it('runs the one-transaction data step and nothing else: no Apple call, no secret, the auth user stays', async () => {
    const { d, calls } = deps();
    expect(await deleteAccount('data', d)).toEqual({ status: 'ok', apple: 'none' });
    expect(calls).toEqual(['data']);
  });
  it('if the data step fails, nothing was deleted and it says failed', async () => {
    const { d, calls } = deps({ deleteUserData: boom('db') });
    expect(await deleteAccount('data', d)).toEqual({ status: 'failed' });
    expect(calls).toEqual(['log:data_delete_failed']);
  });
});

describe('delete: whole account (path b), every failure point', () => {
  it('Apple user with a token: data, then revoke, then the Vault secret, and last the auth user', async () => {
    const { d, calls } = deps();
    expect(await deleteAccount('account', d)).toEqual({ status: 'ok', apple: 'revoked' });
    expect(calls).toEqual(['data', 'read', 'revoke', 'log:apple_revoked', 'delete-secret', 'delete-user']);
  });
  it('data step fails: failed, and nothing after it ran (so "nothing was deleted" is true)', async () => {
    const { d, calls } = deps({ deleteUserData: boom('db') });
    expect(await deleteAccount('account', d)).toEqual({ status: 'failed' });
    expect(calls).toEqual(['log:data_delete_failed']);
  });
  it('reading the Apple token fails after the data is gone: partial, the account is not closed', async () => {
    const { d, calls } = deps({ readAppleToken: boom('vault') });
    expect(await deleteAccount('account', d)).toEqual({ status: 'partial', apple: 'manual' });
    expect(calls).toEqual(['data', 'log:apple_revoke_failed']);
  });
  it('Apple refuses the revoke after the data is gone: partial, the token is kept for a retry, the auth user stays', async () => {
    const { d, calls } = deps({ revokeApple: boom('apple 400') });
    expect(await deleteAccount('account', d)).toEqual({ status: 'partial', apple: 'manual' });
    expect(calls).toEqual(['data', 'read', 'log:apple_revoke_failed']);
  });
  it('the Vault delete fails: partial, the auth user stays', async () => {
    const { d, calls } = deps({ deleteAppleToken: boom('vault') });
    expect(await deleteAccount('account', d)).toEqual({ status: 'partial', apple: 'revoked' });
    expect(calls).toEqual(['data', 'read', 'revoke', 'log:apple_revoked', 'log:vault_delete_failed']);
  });
  it('the auth delete fails last: partial, never success', async () => {
    const { d, calls } = deps({ deleteAuthUser: boom('auth down') });
    expect(await deleteAccount('account', d)).toEqual({ status: 'partial', apple: 'revoked' });
    expect(calls).toContain('log:auth_delete_failed');
  });
  it('Apple user with no stored token: logs the skipped revoke and still finishes', async () => {
    const { d, calls } = deps({ readAppleToken: async () => null });
    expect(await deleteAccount('account', d)).toEqual({ status: 'ok', apple: 'manual' });
    expect(calls).toEqual(['data', 'log:apple_revoke_skipped_no_token', 'delete-secret', 'delete-user']);
  });
  it('Google user: no Apple call at all', async () => {
    const { d, calls } = deps({ hasAppleIdentity: false });
    expect(await deleteAccount('account', d)).toEqual({ status: 'ok', apple: 'none' });
    expect(calls).toEqual(['data', 'delete-secret', 'delete-user']);
  });
  it('logs event names only', async () => {
    const { d, calls } = deps({ deleteAuthUser: boom('x') });
    await deleteAccount('account', d);
    for (const c of calls.filter((c) => c.startsWith('log:'))) expect(c).toMatch(/^log:[a-z_]+$/);
  });
});

describe('Apple revoke call (mocked)', () => {
  it('posts the refresh token to Apple\'s revoke endpoint with the client id and secret', async () => {
    const f = vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch;
    await revokeAppleToken(f, 'com.example.app', 'client-secret-jwt', 'refresh-1');
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://appleid.apple.com/auth/revoke');
    const body = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(body)).toEqual({ client_id: 'com.example.app', client_secret: 'client-secret-jwt', token: 'refresh-1', token_type_hint: 'refresh_token' });
  });
  it('throws when Apple answers with an error', async () => {
    await expect(revokeAppleToken(vi.fn(async () => new Response('', { status: 400 })) as unknown as typeof fetch, 'c', 's', 't')).rejects.toThrow('400');
  });
});

describe('client side of delete', () => {
  const client = (data: unknown, error: unknown = null) => ({ functions: { invoke: vi.fn(async () => ({ data, error })) }, auth: { signOut: vi.fn(async () => ({})) } });
  it('whole account: signs out and clears the phone\'s synced copies and cursors', async () => {
    const c = client({ status: 'ok', apple: 'manual' }); const wipe = vi.fn(async () => {});
    expect(await deleteMyAccount('account', c as never, wipe)).toEqual({ status: 'ok', apple: 'manual' });
    expect(c.functions.invoke).toHaveBeenCalledWith('delete-account', { body: { scope: 'account' } });
    expect(c.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(wipe).toHaveBeenCalled();
  });
  it('data only: also signs out and wipes the synced copies, so nothing is uploaded again', async () => {
    const c = client({ status: 'ok', apple: 'none' }); const wipe = vi.fn(async () => {});
    expect(await deleteMyAccount('data', c as never, wipe)).toEqual({ status: 'ok', apple: 'none' });
    expect(c.auth.signOut).toHaveBeenCalled();
    expect(wipe).toHaveBeenCalled();
  });
  it('partial: wipes the synced copies (so they are not re-uploaded) but stays signed in so the person can try again', async () => {
    const c = client({ status: 'partial', apple: 'none' }); const wipe = vi.fn(async () => {});
    expect(await deleteMyAccount('account', c as never, wipe)).toEqual({ status: 'partial', apple: 'none' });
    expect(c.auth.signOut).not.toHaveBeenCalled();
    expect(wipe).toHaveBeenCalled();
  });
  it('"failed" only when the server said so: nothing changes on the phone', async () => {
    const wipe = vi.fn(async () => {});
    const asHttpError = (body: unknown) => ({ message: 'x', context: { json: async () => body } });
    for (const c of [client(null, asHttpError({ status: 'failed' })), client({ status: 'failed' })]) expect(await deleteMyAccount('account', c as never, wipe)).toEqual({ status: 'failed' });
    expect(wipe).not.toHaveBeenCalled();
  });
  it('a lost request or answer is "unconfirmed", never "nothing was deleted"', async () => {
    const wipe = vi.fn(async () => {});
    const lost = [client(null, { message: 'Failed to fetch' }), client(null, { message: 'x', context: { json: async () => { throw new Error('no body'); } } }), client(null, { message: 'x', context: { json: async () => ({ oops: 1 }) } }), client({}), client(undefined)];
    for (const c of lost) expect(await deleteMyAccount('account', c as never, wipe)).toEqual({ status: 'unconfirmed' });
    const thrown = { functions: { invoke: vi.fn(async () => { throw new TypeError('network'); }) }, auth: { signOut: vi.fn() } };
    expect(await deleteMyAccount('account', thrown as never, wipe)).toEqual({ status: 'unconfirmed' });
    expect(wipe).not.toHaveBeenCalled();
  });
  it('an old sign-in is sent back to sign in again, and nothing changes', async () => {
    const wipe = vi.fn(async () => {});
    const c = client(null, { message: 'x', context: { json: async () => ({ status: 'reauth' }) } });
    expect(await deleteMyAccount('account', c as never, wipe)).toEqual({ status: 'reauth' });
    expect(wipe).not.toHaveBeenCalled();
  });
  it('sync is paused during the delete and resumed after the wipe, whatever the result', async () => {
    const order: string[] = [];
    const c = { functions: { invoke: vi.fn(async () => { order.push(`invoke paused=${syncGate.paused}`); return { data: { status: 'ok', apple: 'none' }, error: null }; }) }, auth: { signOut: vi.fn(async () => { order.push(`signout paused=${syncGate.paused}`); return {}; }) } };
    await deleteMyAccount('data', c as never, async () => { order.push(`wipe paused=${syncGate.paused}`); });
    order.push(`after paused=${syncGate.paused}`);
    expect(order).toEqual(['invoke paused=true', 'signout paused=true', 'wipe paused=true', 'after paused=false']);
    await deleteMyAccount('data', { functions: { invoke: async () => { throw new Error('x'); } }, auth: {} } as never, async () => {});
    expect(syncGate.paused).toBe(false);
  });
});

describe('recent sign-in for closing the account', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  it('accepts a sign-in from the last 10 minutes only', () => {
    expect(recentSignIn('2026-11-08T11:55:00Z', now)).toBe(true);
    expect(recentSignIn('2026-11-08T11:49:59Z', now)).toBe(false);
    expect(recentSignIn('2026-11-07T12:00:00Z', now)).toBe(false);
    expect(recentSignIn(null, now)).toBe(false);
    expect(recentSignIn(undefined, now)).toBe(false);
    expect(recentSignIn('not a date', now)).toBe(false);
    expect(recentSignIn('2026-11-08T13:00:00Z', now)).toBe(false);   // a time in the future is not a sign-in
  });
});

describe('what the person is told', () => {
  it('a lost answer says we could not confirm; a reauth asks for a new sign-in; neither says nothing was deleted', () => {
    expect(resultText('account', { status: 'unconfirmed' })).toBe('We couldn\u2019t confirm the delete. Try again.');
    expect(resultText('account', { status: 'reauth' })).toBe('Sign in again to delete your account, then try again.');
    expect(resultText('account', { status: 'unconfirmed' })).not.toContain('nothing was deleted');
  });
  it('partial is never presented as success', () => {
    expect(resultText('account', { status: 'partial', apple: 'none' })).toBe('Your Ridgeline data was deleted, but we couldn\u2019t close your account. Try again.');
  });
  it('an Apple user we could not revoke for gets the manual line; a revoked one is told we disconnected', () => {
    expect(resultText('account', { status: 'ok', apple: 'manual' })).toContain(APPLE_MANUAL_LINE);
    expect(APPLE_MANUAL_LINE).toBe('To fully disconnect, also remove Ridgeline in your Apple ID settings \u203a Sign in with Apple (appleid.apple.com).');
    expect(resultText('account', { status: 'ok', apple: 'revoked' })).toContain('disconnected Ridgeline from your Apple ID');
    expect(resultText('account', { status: 'ok', apple: 'none' })).not.toContain('Apple');
  });
  it('the warnings say what is removed, name the apps, and promise Apple disconnect only for iPhone sign-ins', () => {
    expect(COPY.data.warn).toContain('This phone is signed out and its copies are removed. Other phones that are still signed in should be signed out too, or they may upload their copies again.');
    const w = COPY.account.warn;
    expect(w).toContain('our language app (woof.bobolearns.com)');
    expect(w).toContain('the BoboLearns Hub sign-in');
    expect(w).toContain('any other B&B app you\u2019ve signed in to');
    expect(w).toContain('On iPhone Apple sign-ins we also disconnect Ridgeline');
    expect(w).toContain('Bobo Learns Chess doesn\u2019t use accounts; to delete its anonymous data, see chess.bobolearns.com/privacy/.');
    expect(w).not.toContain('Ruffspeak');
  });
});

describe('/account/delete/ route', () => {
  it('exists only when accounts are on (default off: falls back to the Find tab)', () => {
    expect(parseRoute('/account/delete/', '', '/')).toEqual({ kind: 'tab', tab: 'find' });
    expect(parseRoute('/account/delete/', '', '/', false, true)).toEqual({ kind: 'account-delete' });
    expect(routePath({ kind: 'account-delete' })).toBe('/account/delete/');
  });
});

describe('settings sync', () => {
  it('"keep tracks on this phone only" and the tour flag never leave the phone', () => {
    expect(SYNCED_SETTING_KEYS).not.toContain('keepTracksLocal');
    expect(SYNCED_SETTING_KEYS).not.toContain('onboardingSeen');
    expect(sanitize({ keepTracksLocal: true }).keepTracksLocal).toBe(true);
    expect(sanitize({ keepTracksLocal: 'yes' }).keepTracksLocal).toBe(false);
  });
});
