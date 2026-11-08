import { describe, it, expect, vi } from 'vitest';
import { deleteAccount, type DeleteDeps } from '../../../supabase/functions/_shared/deleteAccount';
import { revokeAppleToken } from '../../../supabase/functions/_shared/apple';
import { deleteMyAccount } from './auth';
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
    expect(await deleteAccount('data', d)).toEqual({ ok: true });
    expect(calls).toEqual(['delete-rows']);
  });
});

describe('delete: whole account (path b)', () => {
  it('Apple user with a token: revoke first, then the Vault secret, the rows, and last the auth user', async () => {
    const { d, calls } = deps();
    expect(await deleteAccount('account', d)).toEqual({ ok: true });
    expect(calls).toEqual(['read', 'revoke', 'log:apple_revoked', 'delete-secret', 'delete-rows', 'delete-user']);
  });
  it('if Apple refuses, nothing is deleted and the person can retry', async () => {
    const { d, calls } = deps({ revokeApple: async () => { throw new Error('apple 400'); } });
    expect(await deleteAccount('account', d)).toEqual({ ok: false, reason: 'apple_revoke_failed' });
    expect(calls).toEqual(['read', 'log:apple_revoke_failed']);
  });
  it('Apple user with no stored token: logs the fallback and still deletes', async () => {
    const { d, calls } = deps({ readAppleToken: async () => null });
    expect(await deleteAccount('account', d)).toEqual({ ok: true });
    expect(calls).toEqual(['log:apple_revoke_skipped_no_token', 'delete-secret', 'delete-rows', 'delete-user']);
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
  const client = (error: unknown) => ({ functions: { invoke: vi.fn(async () => ({ error })) }, auth: { signOut: vi.fn(async () => ({})) } });
  it('whole account: calls the function, then clears the local session', async () => {
    const c = client(null);
    expect(await deleteMyAccount('account', c as never)).toBe(true);
    expect(c.functions.invoke).toHaveBeenCalledWith('delete-account', { body: { scope: 'account' } });
    expect(c.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('data only: the person stays signed in', async () => {
    const c = client(null);
    expect(await deleteMyAccount('data', c as never)).toBe(true);
    expect(c.auth.signOut).not.toHaveBeenCalled();
  });
  it('a failed delete reports false and keeps the session', async () => {
    const c = client({ message: 'x' });
    expect(await deleteMyAccount('account', c as never)).toBe(false);
    expect(c.auth.signOut).not.toHaveBeenCalled();
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
