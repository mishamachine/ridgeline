// Edge Function: the owner's delete for a deletion request that arrived by email (see docs/DELETE_BY_EMAIL.md). NOT the in-app path.
//   verify_jwt is OFF for this function (deploy with --no-verify-jwt) and it does its own check: the header x-admin-delete-secret must equal the secret
//   ADMIN_DELETE_SECRET (constant-time compare). The secret is never logged or returned.
//   Input {user_id: uuid, mode: 'data' | 'account'}. It runs EXACTLY the same code as the in-app delete (shared deleteAccount + buildDeleteDeps) and returns the
//   same result: ok / partial / failed.
//   It does NOT check for a recent sign-in: that check exists to prove the person is at the keyboard, and the email confirmation (a one-time code sent to the
//   account's own address) replaces it. Nothing here is reachable without the secret.
// Secrets (dashboard only): ADMIN_DELETE_SECRET, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY, APPLE_BUNDLE_ID. The platform provides the Supabase keys.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { ADMIN_HEADER, parseAdminInput, secretMatches } from '../_shared/adminAuth.ts';
import { deleteAccount } from '../_shared/deleteAccount.ts';
import { buildDeleteDeps } from '../_shared/deleteDeps.ts';

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'method' });
  if (!(await secretMatches(req.headers.get(ADMIN_HEADER), Deno.env.get('ADMIN_DELETE_SECRET')))) return reply(401, { error: 'unauthorized' });   // nothing else is revealed
  let body: unknown = null;
  try { body = await req.json(); } catch { /* falls through to validation */ }
  const input = parseAdminInput(body);
  if (!input.ok) return reply(400, { error: 'bad input' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await admin.auth.admin.getUserById(input.userId);
  if (error || !data.user) return reply(404, { status: 'failed', error: 'no such user' });
  try {
    const out = await deleteAccount(input.scope, buildDeleteDeps({
      uid: input.userId, hasAppleIdentity: (data.user.identities ?? []).some((i) => i.provider === 'apple'),
      rl: admin.schema('ridgeline'), admin, env: (k) => Deno.env.get(k) ?? '',
      log: (ev) => console.log(JSON.stringify({ fn: 'admin-delete-account', ev })),   // event names only: never the id, the secret or a token
    }));
    return out.status === 'failed' ? reply(502, out) : reply(200, out);
  } catch {
    console.error('admin-delete-account failed');
    return reply(500, { status: 'failed' });
  }
});
