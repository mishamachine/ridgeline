// Edge Function: the owner's delete for a deletion request that arrived by email (see docs/DELETE_BY_EMAIL.md). NOT the in-app path.
//   verify_jwt is OFF for this function (deploy with --no-verify-jwt) and it does its own check: the header x-admin-delete-secret must equal the secret
//   ADMIN_DELETE_SECRET (constant-time compare). The secret is never logged or returned.
//   The ONLY input is {request_id: uuid}. A user id never travels in a workflow input, an environment variable or a log: the function reads the request from
//   ridgeline.deletion_requests and takes the account and the mode from there. It refuses unless the request is 'confirmed', unused and not expired, and unless the
//   account has a Ridgeline profile (so a stray id cannot delete someone who never used Ridgeline).
//   It then runs EXACTLY the same code as the in-app delete (shared deleteAccount + buildDeleteDeps) and returns the same result: ok / partial / failed.
//   It does NOT check for a recent sign-in: that check exists to prove the person is at the keyboard, and the email confirmation (a one-time code sent to the
//   account's own address) replaces it. Nothing here is reachable without the secret.
// Secrets (dashboard only): ADMIN_DELETE_SECRET, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY, APPLE_BUNDLE_ID. The platform provides the Supabase keys.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { ADMIN_HEADER, checkRequest, parseAdminInput, secretMatches } from '../_shared/adminAuth.ts';
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
  const rl = admin.schema('ridgeline');
  let claimedNow = false;
  try {
    const { data: row } = await rl.from('deletion_requests').select('id,user_id,mode,status,expires_at,used_at').eq('id', input.requestId).maybeSingle();
    const check = checkRequest(row, Date.now());
    if (!check.ok) return reply(check.reason === 'not_found' ? 404 : 409, { status: 'failed', error: check.reason });
    // Only an account that has a Ridgeline profile can be deleted here.
    const { data: profile } = await rl.from('profiles').select('user_id').eq('user_id', check.userId).maybeSingle();
    if (!profile) return reply(404, { status: 'failed', error: 'no ridgeline account' });
    const { data, error } = await admin.auth.admin.getUserById(check.userId);
    if (error || !data.user) return reply(404, { status: 'failed', error: 'no such user' });
    // Claim the request (single use): only one caller can move it from confirmed to executing.
    const { data: claimed } = await rl.from('deletion_requests').update({ status: 'executing', used_at: new Date().toISOString() })
      .eq('id', input.requestId).eq('status', 'confirmed').is('used_at', null).gt('expires_at', new Date().toISOString()).select('id');
    if (!claimed || claimed.length !== 1) return reply(409, { status: 'failed', error: 'used' });
    claimedNow = true;

    const out = await deleteAccount(check.scope, buildDeleteDeps({
      uid: check.userId, hasAppleIdentity: (data.user.identities ?? []).some((i) => i.provider === 'apple'),
      rl, admin, env: (k) => Deno.env.get(k) ?? '',
      log: (ev) => console.log(JSON.stringify({ fn: 'admin-delete-account', ev })),   // event names only: never the id, the secret or a token
    }));
    // done (the row is already gone when the whole account was deleted: it cascades). A failed or partial delete is released so the same request can be retried.
    await rl.from('deletion_requests').update(out.status === 'ok' ? { status: 'done' } : { status: 'confirmed', used_at: null }).eq('id', input.requestId);
    return out.status === 'failed' ? reply(502, out) : reply(200, out);
  } catch {
    console.error('admin-delete-account failed');
    if (claimedNow) { try { await rl.from('deletion_requests').update({ status: 'confirmed', used_at: null }).eq('id', input.requestId); } catch { /* the request stays 'executing' and is looked at by hand */ } }
    return reply(500, { status: 'failed' });
  }
});
