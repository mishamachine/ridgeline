import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { signInNative, signInWeb, providersFor, callbackUrl, isCallbackPath, signIn, signOut, type NativeLogin } from './auth';
import { getClient } from './client';
import { makeNonce, sha256Hex } from './nonce';
import { ensureProfile } from './profile';
import { features } from '../features';
import { AccountRow } from '../../components/AccountRow';

function fakeClient(over: { idTokenError?: boolean } = {}) {
  const upsert = vi.fn(async () => ({ error: null }));
  const from = vi.fn(() => ({ upsert }));
  const c = {
    auth: {
      signInWithIdToken: vi.fn(async () => (over.idTokenError ? { data: { user: null }, error: { message: 'x' } } : { data: { user: { id: 'u1' } }, error: null })),
      signInWithOAuth: vi.fn(async () => ({ error: null })),
    },
    schema: vi.fn(() => ({ from })),
    functions: { invoke: vi.fn(async () => ({ data: { ok: true }, error: null })) },
  };
  return { c: c as never, raw: c, upsert, from };
}
const plugin = (r: Awaited<ReturnType<NativeLogin['login']>> | Error): NativeLogin => ({ login: vi.fn(async () => { if (r instanceof Error) throw r; return r; }) });

describe('nonce', () => {
  it('hashes with SHA-256 hex (known vector)', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('gives the provider the hash and keeps the raw value', async () => {
    const n = await makeNonce();
    expect(n.raw).toMatch(/^[0-9a-f]{64}$/);
    expect(n.hashed).toBe(await sha256Hex(n.raw));
  });
});

describe('native sign-in', () => {
  it('sends the hashed nonce to the sheet and the raw nonce to Supabase', async () => {
    const { c, raw } = fakeClient();
    const p = plugin({ idToken: 'tok' });
    expect(await signInNative('google', c, p)).toEqual({ ok: true });
    const hashed = (p.login as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    const args = raw.auth.signInWithIdToken.mock.calls[0] as unknown as [{ provider: string; token: string; nonce: string }];
    expect(args[0]).toMatchObject({ provider: 'google', token: 'tok' });
    expect(await sha256Hex(args[0].nonce)).toBe(hashed);
  });
  it('creates a bare profile: user_id only, no name', async () => {
    const { c, upsert, raw } = fakeClient();
    await signInNative('apple', c, plugin({ idToken: 't' }));
    expect(raw.schema).toHaveBeenCalledWith('ridgeline');
    expect(upsert.mock.calls[0]).toEqual([{ user_id: 'u1' }, { onConflict: 'user_id', ignoreDuplicates: true }]);
  });
  it('passes Apple\'s authorization code to the apple-token function, and only for Apple', async () => {
    const a = fakeClient();
    await signInNative('apple', a.c, plugin({ idToken: 't', authorizationCode: 'code123' }));
    expect(a.raw.functions.invoke).toHaveBeenCalledWith('apple-token', { body: { code: 'code123' } });
    const g = fakeClient();
    await signInNative('google', g.c, plugin({ idToken: 't', authorizationCode: 'ignored' }));
    expect(g.raw.functions.invoke).not.toHaveBeenCalled();
  });
  it('still signs in when the token capture fails', async () => {
    const a = fakeClient();
    a.raw.functions.invoke.mockRejectedValueOnce(new Error('down'));
    expect(await signInNative('apple', a.c, plugin({ idToken: 't', authorizationCode: 'c' }))).toEqual({ ok: true });
  });
  it('reports cancel, missing token and rejected token distinctly and creates no profile', async () => {
    const a = fakeClient();
    expect(await signInNative('apple', a.c, plugin(Object.assign(new Error('x'), { code: 'USER_CANCELLED' })))).toEqual({ ok: false, reason: 'cancelled' });
    expect(await signInNative('apple', a.c, plugin({ idToken: null }))).toEqual({ ok: false, reason: 'failed' });
    const b = fakeClient({ idTokenError: true });
    expect(await signInNative('google', b.c, plugin({ idToken: 't' }))).toEqual({ ok: false, reason: 'failed' });
    expect(a.upsert).not.toHaveBeenCalled();
    expect(b.upsert).not.toHaveBeenCalled();
  });
});

describe('web sign-in', () => {
  it('uses the OAuth redirect to /auth/callback', async () => {
    const { c, raw } = fakeClient();
    await signInWeb('apple', c, 'https://hike.bbprojectfactory.com/auth/callback');
    expect(raw.auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'apple', options: { redirectTo: 'https://hike.bbprojectfactory.com/auth/callback', queryParams: undefined } });
  });
  it('builds and recognises the callback URL, including under a base path', () => {
    expect(callbackUrl('https://hike.bbprojectfactory.com')).toBe('https://hike.bbprojectfactory.com/auth/callback');
    expect(callbackUrl('http://localhost:5173/', '/ridgeline/')).toBe('http://localhost:5173/ridgeline/auth/callback');
    expect(isCallbackPath('/auth/callback')).toBe(true);
    expect(isCallbackPath('/auth/callback/')).toBe(true);
    expect(isCallbackPath('/ridgeline/auth/callback', '/ridgeline/')).toBe(true);
    expect(isCallbackPath('/profile')).toBe(false);
  });
  it('offers Apple on web and iOS, Google only on Android', () => {
    expect(providersFor('web')).toEqual(['apple', 'google']);
    expect(providersFor('ios')).toEqual(['apple', 'google']);
    expect(providersFor('android')).toEqual(['google']);
  });
});

describe('profile', () => {
  it('surfaces a database error', async () => {
    const c = { schema: () => ({ from: () => ({ upsert: async () => ({ error: { message: 'denied' } }) }) }) };
    await expect(ensureProfile(c as never, 'u')).rejects.toThrow('profile: denied');
  });
});

describe('accounts flag OFF (the shipped state): the app behaves as before', () => {
  it('is off by default', () => { expect(features.accounts).toBe(false); });
  it('creates no client, so nothing is imported or sent', () => { expect(getClient()).toBeNull(); expect(getClient(false)).toBeNull(); });
  it('sign-in and sign-out do nothing', async () => {
    expect(await signIn('google')).toEqual({ ok: false, reason: 'unavailable' });
    await expect(signOut()).resolves.toBeUndefined();
  });
  it('the Profile account row renders nothing', () => { expect(renderToStaticMarkup(<AccountRow />)).toBe(''); });
  it('with the flag on (preview only) it offers sign-in', () => {
    const h = renderToStaticMarkup(<AccountRow enabled />);
    expect(h).toContain('Not signed in. Your hikes are saved only on this phone.');
    expect(h).toContain('>Sign in<');
  });
});
