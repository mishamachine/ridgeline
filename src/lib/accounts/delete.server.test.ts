import { describe, it, expect, vi } from 'vitest';
import { deleteAccount, type DeleteDeps } from '../../../supabase/functions/_shared/deleteAccount';
import { revokeAppleToken } from '../../../supabase/functions/_shared/apple';
import { deleteMyAccount } from './auth';
import { APPLE_MANUAL_LINE, COPY, resultText } from '../../screens/DeleteAccount';
import { parseRoute, routePath } from '../route';
import { SYNCED_SETTING_KEYS, sanitize } from '../settings';

function deps(over: Partial<DeleteDeps> = {}) {
  const calls: string[] = [];
  const d: DeleteDeps = {
    hasAppleIdentity: true,
    readAppleToken: async () => { calls.push('read'); return 'refresh-1'; },
    revokeApple: async () => { calls.push('revoke'); },
    deleteAppleToken: async () => { calls.push('delete-secret'); },
    deleteRidgelineRows: async () => { calls.push('delete-rows'); },
    deleteAuthUser: async () => { calls.push('delete-user'); },
    log: (e) => calls.push('log:' + e),
    ...over,
  };
  return { d, calls };
}

describe('delete: Ridgeline data only (path a)', () => {
  it('removes the rows and nothing else: no Apple call, no secret, the auth user stays', async () => {
    const { d, calls } = deps();
    expect(await deleteAccount('data', d)).toEqual({ status: 'ok', apple: 'none' });
    expect(calls).toEqual(['delete-rows']);
  });
});

describe('delete: whole account (path b)', () => {
  it('Apple user with a token: revoke first, then the Vault secret, the rows, and last the auth user', async () => {
    const { d, calls } = deps();
    expect(await deleteAccount('account', d)).toEqual({ status: 'ok', apple: 'revoked' });
    expect(calls).toEqual(['read', 'revoke', 'log:apple_revoked', 'delete-secret', 'delete-rows', 'delete-user']);
  });
  it('if Apple refuses, nothing is deleted and the person can retry', async () => {
    const { d, calls } = deps({ revokeApple: async () => { throw new Error('apple 400'); } });
    expect(await deleteAccount('account', d)).toEqual({ status: 'failed', reason: 'apple_revoke_failed' });
    expect(calls).toEqual(['read', 'log:apple_revoke_failed']);
  });
  it('Apple user with no stored token: logs the fallback and still deletes', async () => {
    const { d, calls } = deps({ readAppleToken: async () => null });
    expect(await deleteAccount('account', d)).toEqual({ status: 'ok', apple: 'manual' });
    expect(calls).toEqual(['log:apple_revoke_skipped_no_token', 'delete-secret', 'delete-rows', 'delete-user']);
  });
  it('rows gone but the auth delete failed: reported as partial, never as success', async () => {
    const { d, calls } = deps({ deleteAuthUser: async () => { throw new Error('auth down'); } });
    expect(await deleteAccount('account', d)).toEqual({ status: 'partial', apple: 'revoked' });
    expect(calls).toContain('delete-rows');
    expect(calls).toContain('log:auth_delete_failed_after_rows');
  });
  it('Google user: no Apple call at all', async () => {
    const { d, calls } = deps({ hasAppleIdentity: false });
    await deleteAccount('account', d);
    expect(calls).toEqual(['delete-secret', 'delete-rows', 'delete-user']);
  });
  it('logs event names only', async () => {
    const { d, calls } = deps();
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
  it('a failed delete changes nothing on the phone', async () => {
    const wipe = vi.fn(async () => {});
    for (const c of [client(null, { message: 'x' }), client({ status: 'failed' }), client({})]) expect(await deleteMyAccount('account', c as never, wipe)).toEqual({ status: 'failed' });
    expect(wipe).not.toHaveBeenCalled();
  });
});

describe('what the person is told', () => {
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
    expect(COPY.data.warn).toContain('from this phone, and signs you out so nothing is uploaded again');
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
