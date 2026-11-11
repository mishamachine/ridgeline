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
    expect(await signInNative('google', c, p, true)).toEqual({ ok: true });
    const hashed = (p.login as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    const args = raw.auth.signInWithIdToken.mock.calls[0] as unknown as [{ provider: string; token: string; nonce: string }];
    expect(args[0]).toMatchObject({ provider: 'google', token: 'tok' });
    expect(await sha256Hex(args[0].nonce)).toBe(hashed);
  });
  it('creates a bare profile: user_id only, no name', async () => {
    const { c, upsert, raw } = fakeClient();
    await signInNative('apple', c, plugin({ idToken: 't' }), true);
    expect(raw.schema).toHaveBeenCalledWith('ridgeline');
    expect(upsert.mock.calls[0]).toEqual([{ user_id: 'u1' }, { onConflict: 'user_id', ignoreDuplicates: true }]);
  });
  it('passes Apple\'s authorization code to the apple-token function, and only for Apple', async () => {
    const a = fakeClient();
    await signInNative('apple', a.c, plugin({ idToken: 't', authorizationCode: 'code123' }), true);
    expect(a.raw.functions.invoke).toHaveBeenCalledWith('apple-token', { body: { code: 'code123' } });
    const g = fakeClient();
    await signInNative('google', g.c, plugin({ idToken: 't', authorizationCode: 'ignored' }), true);
    expect(g.raw.functions.invoke).not.toHaveBeenCalled();
  });
  it('still signs in when the token capture fails', async () => {
    const a = fakeClient();
    a.raw.functions.invoke.mockRejectedValueOnce(new Error('down'));
    expect(await signInNative('apple', a.c, plugin({ idToken: 't', authorizationCode: 'c' }), true)).toEqual({ ok: true });
  });
  it('reports cancel, missing token and rejected token distinctly and creates no profile', async () => {
    const a = fakeClient();
    expect(await signInNative('apple', a.c, plugin(Object.assign(new Error('x'), { code: 'USER_CANCELLED' })), true)).toEqual({ ok: false, reason: 'cancelled' });
    expect(await signInNative('apple', a.c, plugin({ idToken: null }), true)).toEqual({ ok: false, reason: 'failed' });
    const b = fakeClient({ idTokenError: true });
    expect(await signInNative('google', b.c, plugin({ idToken: 't' }), true)).toEqual({ ok: false, reason: 'failed' });
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

describe('no profile write while sign-in is paused', () => {
  it('ensureProfile does nothing when accounts are not live (a re-sign-in only to delete writes nothing)', async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    const c = { schema: () => ({ from: () => ({ upsert }) }) };
    await ensureProfile(c as never, 'u', false);
    expect(upsert).not.toHaveBeenCalled();
    const { c: client, upsert: up2 } = fakeClient();
    expect((await signInNative('google', client, plugin({ idToken: 't' }), false)).ok).toBe(false);   // paused and not a known account: signed out again, nothing written
    expect(up2).not.toHaveBeenCalled();
  });
});

describe('profile', () => {
  it('surfaces a database error', async () => {
    const c = { schema: () => ({ from: () => ({ upsert: async () => ({ error: { message: 'denied' } }) }) }) };
    await expect(ensureProfile(c as never, 'u', true)).rejects.toThrow('profile: denied');
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

describe('while sign-in is paused only the account this phone already had may sign in', () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
  const withStore = async <T,>(fn: () => Promise<T>) => { const s = mem(); vi.stubGlobal('localStorage', s); try { return await fn(); } finally { vi.unstubAllGlobals(); } };
  const clientFor = (userId: string) => { const signOut = vi.fn(async () => ({})); return { signOut, c: { auth: { signInWithIdToken: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })), signOut, getSession: vi.fn(async () => ({ data: { session: { user: { id: userId } } } })) }, schema: () => ({ from: () => ({ upsert: async () => ({ error: null }) }) }), functions: { invoke: vi.fn() } } }; };
  it('a re-sign-in as the SAME account is fine, and writes nothing', async () => {
    await withStore(async () => {
      const { markSession } = await import('./session');
      markSession('u-known');
      const { c, signOut } = clientFor('u-known');
      expect(await signInNative('google', c as never, plugin({ idToken: 't' }), false)).toEqual({ ok: true });
      expect(signOut).not.toHaveBeenCalled();
    });
  });
  it('a DIFFERENT account is signed out again at once, and the person is told', async () => {
    await withStore(async () => {
      const { markSession, DIFFERENT_ACCOUNT_MESSAGE } = await import('./session');
      markSession('u-known');
      const { c, signOut } = clientFor('u-stranger');
      expect(await signInNative('apple', c as never, plugin({ idToken: 't' }), false)).toEqual({ ok: false, reason: 'different-account' });
      expect(signOut).toHaveBeenCalled();
      expect(DIFFERENT_ACCOUNT_MESSAGE).toContain('not the account used on this phone');
      expect(DIFFERENT_ACCOUNT_MESSAGE).toContain('ask for deletion by email');
    });
  });
  it('a client that tells its listeners BEFORE signInWithIdToken returns cannot make a stranger look like the known account (round 8)', async () => {
    await withStore(async () => {
      const { markSession, lastUserId } = await import('./session');
      const { rememberUser } = await import('./useAccount');
      markSession('u-known');
      const listeners: Array<(id: string) => void> = [(id) => rememberUser(id, false)];   // useAccount's listener, while paused: writes nothing
      const noisy = (userId: string, remember: boolean) => {
        const signOut = vi.fn(async () => ({}));
        return { signOut, c: { auth: { signInWithIdToken: vi.fn(async () => { listeners.forEach((l) => l(userId)); if (remember) markSession(userId); return { data: { user: { id: userId } }, error: null }; }), signOut }, schema: () => ({ from: () => ({ upsert: async () => ({ error: null }) }) }), functions: { invoke: vi.fn() } } };
      };
      // Even a listener that DOES remember the new session first (the old bug) is not enough: the "who was here" snapshot is taken before the call.
      const bad = noisy('u-stranger', true);
      expect(await signInNative('google', bad.c as never, plugin({ idToken: 't' }), false)).toEqual({ ok: false, reason: 'different-account' });
      expect(bad.signOut).toHaveBeenCalled();
      markSession('u-known');
      const good = noisy('u-known', true);
      expect(await signInNative('google', good.c as never, plugin({ idToken: 't' }), false)).toEqual({ ok: true });
      expect(good.signOut).not.toHaveBeenCalled();
      expect(lastUserId()).toBe('u-known');
    });
  });
  it('useAccount remembers an account only while sign-in is live', async () => {
    await withStore(async () => {
      const { rememberUser } = await import('./useAccount');
      const { lastUserId } = await import('./session');
      rememberUser('u-1', false); expect(lastUserId()).toBeNull();
      rememberUser('u-1', true); expect(lastUserId()).toBe('u-1');
    });
  });
  it('the web redirect path does the same', async () => {
    await withStore(async () => {
      const { markSession } = await import('./session');
      const { completeWebSignIn } = await import('./auth');
      markSession('u-known');
      const same = clientFor('u-known'); expect(await completeWebSignIn(same.c as never, false)).toBe(true); expect(same.signOut).not.toHaveBeenCalled();
      const other = clientFor('u-stranger'); expect(await completeWebSignIn(other.c as never, false)).toBe('different-account'); expect(other.signOut).toHaveBeenCalled();
    });
  });
  it('a phone that never had an account cannot sign anyone in while paused; signing in while live records the account', async () => {
    await withStore(async () => {
      const { lastUserId, hadSession } = await import('./session');
      expect(hadSession()).toBe(false);
      const { c, signOut } = clientFor('u-new');
      expect(await signInNative('google', c as never, plugin({ idToken: 't' }), false)).toEqual({ ok: false, reason: 'different-account' });
      expect(signOut).toHaveBeenCalled();
      const live = clientFor('u-new');
      expect(await signInNative('google', live.c as never, plugin({ idToken: 't' }), true)).toEqual({ ok: true });
      expect(lastUserId()).toBe('u-new');
      expect(hadSession()).toBe(true);
    });
  });
});
