// Edge Function: the signed-in person deletes their Ridgeline data only ({scope:'data'}) or the whole shared account ({scope:'account'}).
// Secrets (dashboard only): APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY, APPLE_BUNDLE_ID. The platform provides the Supabase keys.
// Steps: delete_user_data (one SQL transaction), Apple revoke, Vault secret, auth user. 'partial' = data gone, account not closed.
// Deleting the auth user removes rows in every app that references it with ON DELETE CASCADE; this function touches only Ridgeline's own tables.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { buildDeleteDeps } from '../_shared/deleteDeps.ts';
import { deleteAccount, type Scope } from '../_shared/deleteAccount.ts';
import { jwtClaims, recentSignIn } from '../_shared/reauth.ts';

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
  try {
    // The same builder the owner's admin delete uses (admin-delete-account): one set of steps for both paths.
    const out = await deleteAccount(scope, buildDeleteDeps({
      uid, hasAppleIdentity: (u.user.identities ?? []).some((i) => i.provider === 'apple'),
      rl: admin.schema('ridgeline'), admin, env: (k) => Deno.env.get(k) ?? '',
      log: (ev) => console.log(JSON.stringify({ fn: 'delete-account', ev })),
    }));
    // 200 for ok and partial (the body says which); 502 only when nothing was deleted.
    return out.status === 'failed' ? reply(502, out) : reply(200, out);
  } catch (e) {
    console.error('delete-account failed', e instanceof Error ? e.message : 'unknown');
    return reply(500, { status: 'failed', error: 'delete failed' });
  }
});
