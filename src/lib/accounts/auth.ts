// Sign in with Google and Apple. Web: Supabase OAuth redirect. Native: the platform sheet gives an ID token for signInWithIdToken.
import type { SupabaseClient } from '@supabase/supabase-js';
import { appBase } from '../origin';
import { SITE_URL } from '../site';
import { nativePlatform } from '../native/platform';
import { CALLBACK_PATH, GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from './config';
import { getClient } from './client';
import { makeNonce } from './nonce';
import { ensureProfile } from './profile';

export type Provider = 'google' | 'apple';
export type SignInResult = { ok: true } | { ok: false; reason: 'cancelled' | 'unavailable' | 'failed' };

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

export async function signInNative(provider: Provider, c: SupabaseClient, plugin: NativeLogin): Promise<SignInResult> {
  const nonce = await makeNonce();
  let r: { idToken: string | null; authorizationCode?: string };
  try { r = await plugin.login(provider, nonce.hashed); } catch (e) { return { ok: false, reason: cancelled(e) ? 'cancelled' : 'failed' }; }
  if (!r.idToken) return { ok: false, reason: 'failed' };
  const { data, error } = await c.auth.signInWithIdToken({ provider, token: r.idToken, nonce: nonce.raw });
  if (error || !data.user) return { ok: false, reason: 'failed' };
  try { await ensureProfile(c, data.user.id); } catch { /* retried on next launch (ensureProfile is idempotent) */ }
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
export async function signIn(provider: Provider, enabled?: boolean): Promise<SignInResult> {
  const p = getClient(enabled);
  if (!p) return { ok: false, reason: 'unavailable' };
  const c = await p;
  const platform = nativePlatform();
  if (!providersFor(platform).includes(provider)) return { ok: false, reason: 'unavailable' };
  if (platform === 'web') return signInWeb(provider, c);
  return signInNative(provider, c, await capacitorLogin());
}

export async function signOut(enabled?: boolean): Promise<void> {
  const p = getClient(enabled);
  if (!p) return;
  await (await p).auth.signOut();
}

/** On /auth/callback: let supabase-js swap the code for a session, make the profile, then send the person home. */
export async function completeWebSignIn(c: SupabaseClient): Promise<boolean> {
  const { data } = await c.auth.getSession();
  if (!data.session) return false;
  try { await ensureProfile(c, data.session.user.id); } catch { /* retried next launch */ }
  return true;
}

export const isCallbackPath = (pathname: string, base = '/') => pathname.replace(/\/+$/, '') === (base.replace(/\/?$/, '/') + CALLBACK_PATH);
