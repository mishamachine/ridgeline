// Edge Function: the signed-in person deletes their Ridgeline data only ({scope:'data'}) or the whole shared account ({scope:'account'}).
// Secrets (dashboard only): APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY, APPLE_BUNDLE_ID. The platform provides the Supabase keys.
// Steps: delete_user_data (one SQL transaction), Apple revoke, Vault secret, auth user. 'partial' = data gone, account not closed.
// Deleting the auth user removes rows in every app that references it with ON DELETE CASCADE; this function touches only Ridgeline's own tables.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { appleClientSecret, revokeAppleToken } from '../_shared/apple.ts';
import { deleteAccount, type Scope } from '../_shared/deleteAccount.ts';
import { jwtClaims, recentSignIn } from '../_shared/reauth.ts';
import { retryOnDeadlock } from '../_shared/retry.ts';

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info', 'access-control-allow-methods': 'POST, OPTIONS' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'method' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { authorization: req.headers.get('authorization') ?? '' } } });
  const { data: u, error } = await asUser.auth.getUser();
  if (error || !u.user) return reply(401, { error: 'not signed in' });

  let scope: Scope | '' = '';
  try { const s = (await req.json()).scope; scope = s === 'data' || s === 'account' ? s : ''; } catch { /* falls through */ }
  if (!scope) return reply(400, { error: 'scope' });

  // Closing the whole account needs a session created in the last 10 minutes (data-only delete does not). The token was accepted by getUser above.
  if (scope === 'account' && !recentSignIn(jwtClaims((req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')))) return reply(401, { status: 'reauth' });

  const uid = u.user.id;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const rl = admin.schema('ridgeline');
  const env = (k: string) => Deno.env.get(k) ?? '';
  const clientId = env('APPLE_BUNDLE_ID') || 'com.bbprojectfactory.ridgeline';
  try {
    const out = await deleteAccount(scope, {
      hasAppleIdentity: (u.user.identities ?? []).some((i) => i.provider === 'apple'),
      async readAppleToken() { const { data, error: e } = await rl.rpc('read_apple_token', { p_user: uid }); if (e) throw e; return (data as string | null) ?? null; },
      async revokeApple(token) {
        const secret = await appleClientSecret({ teamId: env('APPLE_TEAM_ID'), keyId: env('APPLE_KEY_ID'), privateKeyPem: env('APPLE_PRIVATE_KEY') }, clientId);
        await revokeAppleToken(fetch, clientId, secret, token);
      },
      async deleteAppleToken() { const { error: e } = await rl.rpc('delete_apple_token', { p_user: uid }); if (e) throw e; },
      // one transaction; retried if the database picks it as a deadlock victim (40P01)
      async deleteUserData() { await retryOnDeadlock(async () => { const { error: e } = await rl.rpc('delete_user_data', { uid }); if (e) throw e; }); },
      async deleteAuthUser() { const { error: e } = await admin.auth.admin.deleteUser(uid); if (e) throw e; },
      log: (ev) => console.log(JSON.stringify({ fn: 'delete-account', ev })),
    });
    // 200 for ok and partial (the body says which); 502 only when nothing was deleted.
    return out.status === 'failed' ? reply(502, out) : reply(200, out);
  } catch (e) {
    console.error('delete-account failed', e instanceof Error ? e.message : 'unknown');
    return reply(500, { status: 'failed', error: 'delete failed' });
  }
});
