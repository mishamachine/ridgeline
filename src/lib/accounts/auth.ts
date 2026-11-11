// Sign in with Google and Apple. Web: Supabase OAuth redirect. Native: the platform sheet gives an ID token for signInWithIdToken.
import type { SupabaseClient } from '@supabase/supabase-js';
import { appBase } from '../origin';
import { SITE_URL } from '../site';
import { nativePlatform } from '../native/platform';
import { CALLBACK_PATH, GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from './config';
import { getClient } from './client';
import { accountsLive } from './flags';
import { makeNonce } from './nonce';
import { syncGate } from '../sync/gate';
import { lastUserId, markSession } from './session';
import { ensureProfile } from './profile';

export type Provider = 'google' | 'apple';
export type SignInResult = { ok: true } | { ok: false; reason: 'cancelled' | 'unavailable' | 'failed' | 'different-account' };

/** What the native plugin gives back. Narrowed so tests can fake it. */
export interface NativeLogin {
  login(p: Provider, nonceHashed: string): Promise<{ idToken: string | null; authorizationCode?: string }>;
}

/** Android offers Google only in v1 (Apple's own rule 4.8 applies on iOS; Apple on Android needs a web flow). */
export const providersFor = (platform: 'ios' | 'android' | 'web'): Provider[] => (platform === 'android' ? ['google'] : ['apple', 'google']);

/** Where the web redirect lands: the app's own /auth/callback. */
export function callbackUrl(origin: string, base = '/'): string {
  return origin.replace(/\/$/, '') + base.replace(/\/?$/, '/') + CALLBACK_PATH;
}

export function webRedirectTo(): string {
  // The installed or hosted site at hike.bbprojectfactory.com, or the dev server; never a stray host.
  const here = typeof location !== 'undefined' ? location.origin : SITE_URL;
  return callbackUrl(here, appBase());
}

const cancelled = (e: unknown) => /cancel|USER_CANCELLED|dismiss/i.test(String((e as { code?: string; message?: string })?.code ?? '') + String((e as Error)?.message ?? ''));

export async function signInWeb(provider: Provider, c: SupabaseClient, redirectTo = webRedirectTo()): Promise<SignInResult> {
  const { error } = await c.auth.signInWithOAuth({ provider, options: { redirectTo, queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined } });
  return error ? { ok: false, reason: 'failed' } : { ok: true };
}

export async function signInNative(provider: Provider, c: SupabaseClient, plugin: NativeLogin, live: boolean = accountsLive()): Promise<SignInResult> {
  const nonce = await makeNonce();
  let r: { idToken: string | null; authorizationCode?: string };
  try { r = await plugin.login(provider, nonce.hashed); } catch (e) { return { ok: false, reason: cancelled(e) ? 'cancelled' : 'failed' }; }
  if (!r.idToken) return { ok: false, reason: 'failed' };
  // Who was here BEFORE this sign-in. Taken first: signInWithIdToken tells the auth listeners before it returns, and anything that remembers the session
  // there would otherwise make every account look like the one already on this phone.
  const prev = lastUserId();
  const { data, error } = await c.auth.signInWithIdToken({ provider, token: r.idToken, nonce: nonce.raw });
  if (error || !data.user) return { ok: false, reason: 'failed' };
  // While sign-in is paused only the account this phone already had may sign in (to confirm a delete). Anyone else is signed out again at once.
  if (!live && prev !== data.user.id) { try { await c.auth.signOut(); } catch { /* signed out locally anyway */ } return { ok: false, reason: 'different-account' }; }
  if (live) markSession(data.user.id);
  try { await ensureProfile(c, data.user.id, live); } catch { /* the profile is made at the next sync (runSync calls ensureProfile, which is idempotent), once per launch */ }
  if (provider === 'apple' && r.authorizationCode) {
    // Lets "Delete my whole account" tell Apple to disconnect Ridgeline. Best effort: sign-in already worked.
    try { await c.functions.invoke('apple-token', { body: { code: r.authorizationCode } }); } catch { /* fallback is logged server-side at delete time */ }
  }
  return { ok: true };
}

/** The real Capacitor plugin, loaded only inside the apps. */
export async function capacitorLogin(): Promise<NativeLogin> {
  const { SocialLogin } = await import('@capgo/capacitor-social-login');
  const platform = nativePlatform();
  await SocialLogin.initialize({
    google: { iOSClientId: GOOGLE_IOS_CLIENT_ID || undefined, webClientId: GOOGLE_WEB_CLIENT_ID || undefined },
    apple: platform === 'ios' ? { useProperTokenExchange: true } : undefined,
  });
  return {
    async login(p, nonce) {
      if (p === 'google') {
        const { result } = await SocialLogin.login({ provider: 'google', options: { scopes: ['email', 'profile'], nonce } });
        return { idToken: 'idToken' in result ? result.idToken : null };
      }
      const { result } = await SocialLogin.login({ provider: 'apple', options: { scopes: ['email', 'name'], nonce } });
      return { idToken: result.idToken, authorizationCode: result.authorizationCode };
    },
  };
}

/** Entry point for the buttons. Does nothing, and loads nothing, when accounts are off. */
/** Where the web redirect should bring the person back to after Apple or Google: the delete page when they were re-signing in to delete. */
export const RETURN_KEY = 'ridgeline:returnTo';
export type ReturnTo = 'account-delete';
export function rememberReturn(to: ReturnTo | undefined, s: Pick<Storage, 'setItem' | 'removeItem'> | null = typeof sessionStorage === 'undefined' ? null : sessionStorage) {
  try { if (to) s?.setItem(RETURN_KEY, to); else s?.removeItem(RETURN_KEY); } catch { /* private mode: they land on Profile */ }
}
export function takeReturn(s: Pick<Storage, 'getItem' | 'removeItem'> | null = typeof sessionStorage === 'undefined' ? null : sessionStorage): ReturnTo | null {
  try { const v = s?.getItem(RETURN_KEY); s?.removeItem(RETURN_KEY); return v === 'account-delete' ? v : null; } catch { return null; }
}

export async function signIn(provider: Provider, enabled?: boolean, returnTo?: ReturnTo): Promise<SignInResult> {
  const p = getClient(enabled);
  if (!p) return { ok: false, reason: 'unavailable' };
  const c = await p;
  const platform = nativePlatform();
  if (!providersFor(platform).includes(provider)) return { ok: false, reason: 'unavailable' };
  if (platform === 'web') { rememberReturn(returnTo); return signInWeb(provider, c); }
  return signInNative(provider, c, await capacitorLogin());
}

export async function signOut(enabled?: boolean): Promise<void> {
  const p = getClient(enabled);
  if (!p) return;
  await (await p).auth.signOut();
}

/** On /auth/callback: let supabase-js swap the code for a session, make the profile, then send the person home. */
export async function completeWebSignIn(c: SupabaseClient, live: boolean = accountsLive()): Promise<boolean | 'different-account'> {
  const prev = lastUserId();   // before anything can remember the new session
  const { data } = await c.auth.getSession();
  if (!data.session) return false;
  if (!live && prev !== data.session.user.id) { try { await c.auth.signOut(); } catch { /* ignore */ } return 'different-account'; }
  if (live) markSession(data.session.user.id);
  try { await ensureProfile(c, data.session.user.id, live); } catch { /* made at the next sync, once per launch */ }
  return true;
}

export const isCallbackPath = (pathname: string, base = '/') => pathname.replace(/\/+$/, '') === (base.replace(/\/?$/, '/') + CALLBACK_PATH);

export type DeleteScope = 'data' | 'account';
export type AppleResult = 'revoked' | 'manual' | 'none';
/**
 * ok: done. partial: the Ridgeline data is gone but the account could not be closed (still signed in, so the person can try again).
 * failed: the server said nothing was deleted. reauth: sign in again first. unconfirmed: the request or its answer was lost, so we do not know.
 */
export type DeleteResult =
  | { status: 'ok'; apple: AppleResult }
  | { status: 'partial'; apple: AppleResult }
  | { status: 'failed' }
  | { status: 'reauth' }
  | { status: 'unconfirmed' };

const defaultWipe = async () => (await import('../sync/local')).wipeLocalAccountData();

/** What the server said when it answered with an error status (the body is JSON {status}). null when there was no answer at all (a network error). */
async function serverStatus(error: unknown): Promise<string | null> {
  const ctx = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  if (!ctx || typeof ctx.json !== 'function') return null;
  try { const b = (await ctx.json()) as { status?: unknown } | null; return typeof b?.status === 'string' ? b.status : null; } catch { return null; }
}

/**
 * Calls the delete-account Edge Function and then makes this phone match.
 * Sync is paused first (and any pass in flight is finished), so nothing is uploaded between the delete and the wipe; it resumes only after the
 * wipe and sign-out are done. After a delete (or a partial one) the synced copies and cursors on the phone are cleared, otherwise the next sync
 * would upload everything again. 'data' also signs out.
 */
export async function deleteMyAccount(scope: DeleteScope, c: Pick<SupabaseClient, 'functions' | 'auth'>, wipe: () => Promise<void> = defaultWipe): Promise<DeleteResult> {
  await syncGate.pause();
  try {
    let data: unknown = null, error: unknown = null;
    try { ({ data, error } = await c.functions.invoke('delete-account', { body: { scope } })); } catch (e) { error = e; }
    if (error) {
      // Only an answer from the server can say "nothing was deleted". A lost request or answer leaves us not knowing.
      const st = await serverStatus(error);
      if (st === 'failed') return { status: 'failed' };
      if (st === 'reauth') return { status: 'reauth' };
      return { status: 'unconfirmed' };
    }
    const r = data as { status?: string; apple?: AppleResult } | null;
    if (!r || (r.status !== 'ok' && r.status !== 'partial')) return r?.status === 'failed' ? { status: 'failed' } : r?.status === 'reauth' ? { status: 'reauth' } : { status: 'unconfirmed' };
    const apple: AppleResult = r.apple === 'revoked' || r.apple === 'manual' ? r.apple : 'none';
    if (r.status === 'partial') { await wipe(); return { status: 'partial', apple }; }
    try { await c.auth.signOut({ scope: 'local' }); } catch { /* the user may no longer exist */ }
    await wipe();
    return { status: 'ok', apple };
  } finally {
    syncGate.resume();
  }
}

/** Sign out, then optionally forget the account's records on this phone. */
export async function signOutKeeping(keepCopy: boolean, enabled?: boolean): Promise<void> {
  await signOut(enabled);
  if (!keepCopy) await (await import('../sync/local')).wipeLocalAccountData();
}
