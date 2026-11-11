// Edge Function: after a native Sign in with Apple, the app sends Apple's authorization code here.
// We exchange it for Apple's refresh token and keep it in Supabase Vault (never returned to the client),
// so deleting the whole account can later tell Apple to disconnect Ridgeline (App Store 5.1.1(v)).
// Secrets (set in the Supabase dashboard, never in the repo): APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY, APPLE_BUNDLE_ID.
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { appleClientSecret, exchangeAppleCode } from '../_shared/apple.ts';

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info', 'access-control-allow-methods': 'POST, OPTIONS' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'method' });
  const auth = req.headers.get('authorization') ?? '';
  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { authorization: auth } } });
  const { data: u, error } = await asUser.auth.getUser();
  if (error || !u.user) return reply(401, { error: 'not signed in' });

  let code = '';
  try { code = String((await req.json()).code ?? ''); } catch { /* falls through */ }
  if (!code || code.length > 2000) return reply(400, { error: 'code' });

  // Only a caller who signed in with Apple can park an Apple token: check BEFORE spending the code on Apple.
  const apple = (u.user.identities ?? []).find((i) => i.provider === 'apple');
  if (!apple) return reply(403, { error: 'no apple identity' });

  const env = (k: string) => Deno.env.get(k) ?? '';
  const clientId = env('APPLE_BUNDLE_ID') || 'com.bbprojectfactory.ridgeline';
  try {
    const secret = await appleClientSecret({ teamId: env('APPLE_TEAM_ID'), keyId: env('APPLE_KEY_ID'), privateKeyPem: env('APPLE_PRIVATE_KEY') }, clientId);
    const t = await exchangeAppleCode(fetch, clientId, secret, code);
    // The token must belong to the Apple identity of the caller, or anyone could park a token on someone else's account.
    if (apple.identity_data?.sub !== t.sub) return reply(403, { error: 'identity mismatch' });
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { error: e } = await admin.schema('ridgeline').rpc('store_apple_token', { p_user: u.user.id, p_token: t.refreshToken });
    if (e) throw e;
    return reply(200, { ok: true });
  } catch (e) {
    console.error('apple-token failed', e instanceof Error ? e.message : 'unknown'); // never log tokens or codes
    return reply(502, { error: 'exchange failed' });
  }
});
