import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ADMIN_HEADER, checkRequest, parseAdminInput, secretMatches } from '../../../supabase/functions/_shared/adminAuth';
import { buildDeleteDeps, type AdminAuth, type RidgelineRpc } from '../../../supabase/functions/_shared/deleteDeps';
import { deleteAccount } from '../../../supabase/functions/_shared/deleteAccount';

const UID = '123e4567-e89b-42d3-a456-426614174000';

describe('the admin delete check: a secret in a header, compared in constant time', () => {
  it('a missing header, a missing secret, an empty value, or a wrong value is refused', async () => {
    expect(await secretMatches(null, 'the-secret')).toBe(false);
    expect(await secretMatches(undefined, 'the-secret')).toBe(false);
    expect(await secretMatches('', 'the-secret')).toBe(false);
    expect(await secretMatches('the-secret', undefined)).toBe(false);   // the function is not configured: nothing gets in
    expect(await secretMatches('the-secret', '')).toBe(false);
    expect(await secretMatches('wrong', 'the-secret')).toBe(false);
    expect(await secretMatches('the-secret ', 'the-secret')).toBe(false);
    expect(await secretMatches('the-secre', 'the-secret')).toBe(false);
    expect(await secretMatches('the-secret-and-more', 'the-secret')).toBe(false);
  });
  it('the right value is accepted', async () => { expect(await secretMatches('the-secret', 'the-secret')).toBe(true); });
  it('the comparison hashes both sides and never stops early: no length check, no === on the secret, a loop over fixed 32-byte digests', () => {
    const src = readFileSync('supabase/functions/_shared/adminAuth.ts', 'utf8');
    expect(src).toContain("crypto.subtle.digest('SHA-256'");
    expect(src).toContain('diff |= x[i] ^ y[i]');
    const body = src.slice(src.indexOf('export async function secretMatches'), src.indexOf('export const ADMIN_HEADER'));
    expect(body).not.toMatch(/\.length\s*(!==|===|<|>)/);        // no early exit on length
    expect(body).not.toMatch(/(header|secret)\s*(===|!==)\s*(header|secret)/);
    expect(body.split('return').length - 1).toBe(2);              // one early exit for "not configured / not given", one result
  });
  it('the function answers 401 and nothing else when the check fails, before it reads the body or touches the database', () => {
    const src = readFileSync('supabase/functions/admin-delete-account/index.ts', 'utf8');
    expect(ADMIN_HEADER).toBe('x-admin-delete-secret');
    const afterAuth = src.indexOf("return reply(401, { error: 'unauthorized' })");
    expect(afterAuth).toBeGreaterThan(0);
    expect(afterAuth).toBeLessThan(src.indexOf('req.json()'));
    expect(afterAuth).toBeLessThan(src.indexOf('createClient('));
    expect(src).not.toMatch(/(===|==)\s*secret|secret\s*(===|==)/);
  });
});

describe('the admin delete input: a request id and nothing else', () => {
  const RID = '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f';
  it('accepts a uuid request_id', () => {
    expect(parseAdminInput({ request_id: RID })).toEqual({ ok: true, requestId: RID });
    expect(parseAdminInput({ request_id: RID.toUpperCase() })).toEqual({ ok: true, requestId: RID });
  });
  it('refuses everything else, including any body that carries a user id or a mode', () => {
    for (const bad of [null, undefined, 'x', [], {}, { request_id: 'nope' }, { request_id: 12 }, { request_id: ` ${RID}` }, { request_id: RID, user_id: UID }, { request_id: RID, mode: 'account' }, { user_id: UID, mode: 'data' }, { user_id: UID }])
      expect(parseAdminInput(bad), JSON.stringify(bad)).toEqual({ ok: false });
  });
});

describe('a request is executed only when it is confirmed, unused and unexpired', () => {
  const now = Date.parse('2026-11-20T00:00:00Z');
  const row = (over: Record<string, unknown> = {}) => ({ id: 'r', user_id: UID, mode: 'account', status: 'confirmed', expires_at: '2026-12-01T00:00:00Z', used_at: null, ...over }) as never;
  it('a confirmed request gives the account and the mode (from the row, never from the caller)', () => {
    expect(checkRequest(row(), now)).toEqual({ ok: true, userId: UID, scope: 'account' });
    expect(checkRequest(row({ mode: 'data' }), now)).toEqual({ ok: true, userId: UID, scope: 'data' });
  });
  it('refuses a missing, pending, executing, done, closed, refused, used, expired or odd-mode request', () => {
    expect(checkRequest(null, now)).toEqual({ ok: false, reason: 'not_found' });
    for (const status of ['pending', 'executing', 'done', 'closed', 'refused']) expect(checkRequest(row({ status }), now), status).toEqual({ ok: false, reason: 'not_confirmed' });
    expect(checkRequest(row({ used_at: '2026-11-19T00:00:00Z' }), now)).toEqual({ ok: false, reason: 'used' });
    expect(checkRequest(row({ expires_at: '2026-11-19T23:59:59Z' }), now)).toEqual({ ok: false, reason: 'expired' });
    expect(checkRequest(row({ expires_at: '2026-11-20T00:00:00Z' }), now)).toEqual({ ok: false, reason: 'expired' });   // expired AT the moment
    expect(checkRequest(row({ mode: 'everything' }), now)).toEqual({ ok: false, reason: 'bad_mode' });
  });
  it('the function claims the request once (confirmed to executing, unused, unexpired) before it deletes, and refuses a user without a Ridgeline profile with 404', () => {
    const src = readFileSync('supabase/functions/admin-delete-account/index.ts', 'utf8');
    const profileAt = src.indexOf("from('profiles')"), claimAt = src.indexOf("status: 'executing'"), deleteAt = src.indexOf('deleteAccount(check.scope');
    expect(profileAt).toBeGreaterThan(0); expect(claimAt).toBeGreaterThan(profileAt); expect(deleteAt).toBeGreaterThan(claimAt);   // profile check, then the claim, then the delete
    expect(src).toContain("if (!profile) return reply(404");
    expect(src).toContain(".eq('status', 'confirmed').is('used_at', null).gt('expires_at'");
    expect(src).toContain("check.reason === 'not_found' ? 404 : 409");
    expect(src).not.toMatch(/input\.userId|input\.scope|body\.user_id|body\.mode/);   // the account and the mode come from the stored request only
  });
});

describe('the admin delete runs the SAME code as the in-app delete, and returns the same results', () => {
  const rig = (over: { rpcError?: Record<string, { code?: string } | null>; deleteUserError?: boolean; token?: string | null; revokeStatus?: number } = {}) => {
    const calls: string[] = [];
    const rl: RidgelineRpc = { rpc: async (fn, args) => { calls.push(`rpc:${fn}:${String(args.uid ?? args.p_user) === UID ? 'uid' : 'other'}`); return { data: fn === 'read_apple_token' ? (over.token === undefined ? 'refresh-1' : over.token) : null, error: over.rpcError?.[fn] ?? null }; } };
    const admin: AdminAuth = { auth: { admin: { deleteUser: async (id) => { calls.push(`deleteUser:${id === UID ? 'uid' : 'other'}`); return { error: over.deleteUserError ? { message: 'x' } : null }; } } } };
    const fetchFn = vi.fn(async () => new Response('', { status: over.revokeStatus ?? 200 })) as unknown as typeof fetch;
    return { calls, deps: buildDeleteDeps({ uid: UID, hasAppleIdentity: true, rl, admin, env: () => '', fetchFn, log: (e) => calls.push('log:' + e), wait: async () => {} }), fetchFn };
  };
  const secretFree = async () => { const { generateKey } = await import('node:crypto'); return generateKey; };
  void secretFree;
  it('ok for the whole account (Apple revoked), in the same order as the in-app delete', async () => {
    // the Apple client secret needs a real key: give it one
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8))}\n-----END PRIVATE KEY-----`;
    const calls: string[] = [];
    const rl: RidgelineRpc = { rpc: async (fn) => { calls.push(fn); return { data: fn === 'read_apple_token' ? 'refresh-1' : null, error: null }; } };
    const admin: AdminAuth = { auth: { admin: { deleteUser: async () => { calls.push('deleteUser'); return { error: null }; } } } };
    const fetchFn = vi.fn(async () => { calls.push('apple-revoke'); return new Response('', { status: 200 }); }) as unknown as typeof fetch;
    const env = (k: string) => ({ APPLE_TEAM_ID: 'T', APPLE_KEY_ID: 'K', APPLE_PRIVATE_KEY: pem, APPLE_BUNDLE_ID: 'b' }[k] ?? '');
    const out = await deleteAccount('account', buildDeleteDeps({ uid: UID, hasAppleIdentity: true, rl, admin, env, fetchFn, log: () => {} }));
    expect(out).toEqual({ status: 'ok', apple: 'revoked' });
    expect(calls).toEqual(['delete_user_data', 'read_apple_token', 'apple-revoke', 'delete_apple_token', 'deleteUser']);
  });
  it('data mode only deletes the Ridgeline data', async () => {
    const { calls, deps } = rig();
    expect(await deleteAccount('data', deps)).toEqual({ status: 'ok', apple: 'none' });
    expect(calls).toEqual(['rpc:delete_user_data:uid']);
  });
  it('ok with a manual Apple line when no token is stored', async () => {
    const { calls, deps } = rig({ token: null });
    expect(await deleteAccount('account', deps)).toEqual({ status: 'ok', apple: 'manual' });
    expect(calls).toContain('log:apple_revoke_skipped_no_token');
    expect(calls).toContain('deleteUser:uid');
  });
  it('partial when the auth delete fails after the data is gone', async () => {
    const { deps } = rig({ token: null, deleteUserError: true });
    expect(await deleteAccount('account', deps)).toEqual({ status: 'partial', apple: 'manual' });
  });
  it('failed when the data step fails, and nothing else ran', async () => {
    const { calls, deps } = rig({ rpcError: { delete_user_data: { code: '23503' } } });
    expect(await deleteAccount('account', deps)).toEqual({ status: 'failed' });
    expect(calls.filter((c) => c.startsWith('deleteUser'))).toEqual([]);
  });
  it('a deadlock in the data step is retried, as in the in-app delete', async () => {
    let n = 0;
    const calls: string[] = [];
    const rl: RidgelineRpc = { rpc: async (fn) => { calls.push(fn); if (fn === 'delete_user_data' && ++n < 3) return { data: null, error: { code: '40P01' } }; return { data: null, error: null }; } };
    const deps = buildDeleteDeps({ uid: UID, hasAppleIdentity: false, rl, admin: { auth: { admin: { deleteUser: async () => ({ error: null }) } } }, env: () => '', log: () => {}, wait: async () => {} });
    expect(await deleteAccount('data', deps)).toEqual({ status: 'ok', apple: 'none' });
    expect(n).toBe(3);
  });
  it('both functions are built on the same two shared modules, and the admin one has no delete logic of its own', () => {
    const admin = readFileSync('supabase/functions/admin-delete-account/index.ts', 'utf8');
    const own = readFileSync('supabase/functions/delete-account/index.ts', 'utf8');
    for (const src of [admin, own]) { expect(src).toContain("from '../_shared/deleteAccount.ts'"); expect(src).toContain("from '../_shared/deleteDeps.ts'"); expect(src).toContain('buildDeleteDeps('); }
    const code = (t: string) => t.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    for (const dup of ['delete_user_data', 'read_apple_token', 'delete_apple_token', 'deleteUser(', 'revokeAppleToken', 'appleClientSecret']) { expect(code(admin)).not.toContain(dup); expect(code(own)).not.toContain(dup); }
  });
  it('it skips the recent-sign-in check on purpose (the email confirmation replaces it), and says so', () => {
    const admin = readFileSync('supabase/functions/admin-delete-account/index.ts', 'utf8');
    expect(admin).not.toContain('recentSignIn');
    expect(admin).toContain('does NOT check for a recent sign-in');
    expect(admin).toContain('the email confirmation');
    expect(readFileSync('supabase/functions/delete-account/index.ts', 'utf8')).toContain('recentSignIn');
  });
  it('it logs event names only: never the id, the secret or a token', () => {
    const admin = readFileSync('supabase/functions/admin-delete-account/index.ts', 'utf8');
    const logs = admin.split('\n').filter((l) => /console\.(log|error)/.test(l)).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    expect(logs).not.toMatch(/input|userId|secret|token|ADMIN_DELETE/i);
  });
});

describe('the admin-delete workflow takes a request id only and never echoes the secret or an id', () => {
  const wf = readFileSync('.github/workflows/admin-delete.yml', 'utf8');
  it('is manual, read-only, runs in the admin-delete environment, and uses no actions (so there is nothing unpinned)', () => {
    expect(wf).toContain('workflow_dispatch:');
    expect(wf).not.toMatch(/^\s*pull_request|^\s*push:|^\s*schedule:/m);
    expect(wf).toMatch(/permissions:\n\s+contents: read/);
    expect(wf).toMatch(/\n    environment: admin-delete\n/);
    expect(wf).not.toMatch(/reviewers/);                          // no required reviewers: the owner chose that agents handle deletions
    for (const u of wf.split('\n').filter((l) => /^\s*-?\s*uses:/.test(l))) expect(u).toMatch(/@[0-9a-f]{40}/);
  });
  it('has exactly one input, request_id: no user id and no mode anywhere (inputs, env, script, comments about inputs)', () => {
    const inputs = wf.slice(wf.indexOf('inputs:'), wf.indexOf('permissions:'));
    expect(inputs.match(/^      \w+:$/gm)).toEqual(['      request_id:']);
    expect(wf).not.toMatch(/user_id|USER_ID|\bMODE\b|"mode"/);
    expect(wf).toContain('{\\"request_id\\":\\"$REQUEST_ID\\"}');
  });
  it('prints only the last 4 characters of the request id and the status, and never the secret', () => {
    expect(wf).toContain('...${REQUEST_ID: -4}');
    expect(wf).toContain('status $status');
    const echoes = (wf.match(/echo\s+"[^"]*"/g) ?? []).join('\n');
    expect(echoes).not.toMatch(/\$\{?ADMIN_DELETE_SECRET/);
    const idEchoes = (wf.match(/echo\s+"[^"]*"/g) ?? []).filter((l) => /REQUEST_ID/.test(l));
    expect(idEchoes).toHaveLength(1);
    expect(idEchoes[0]).toContain('REQUEST_ID: -4');
    expect(wf).toContain('set -euo pipefail');
    expect(wf).not.toMatch(/set -x|--verbose|curl -v/);
    expect(wf).toContain('rm -f out.json');
    expect(wf).toContain('x-admin-delete-secret: $ADMIN_DELETE_SECRET');
  });
  it('checks the input again before using it', () => { expect(wf).toContain('request_id is not a uuid'); });
});
