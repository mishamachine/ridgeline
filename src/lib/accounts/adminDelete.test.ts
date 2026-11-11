import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ADMIN_HEADER, parseAdminInput, secretMatches } from '../../../supabase/functions/_shared/adminAuth';
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

describe('the admin delete input', () => {
  it('needs a uuid and a mode of data or account, and nothing else', () => {
    expect(parseAdminInput({ user_id: UID, mode: 'data' })).toEqual({ ok: true, userId: UID, scope: 'data' });
    expect(parseAdminInput({ user_id: UID.toUpperCase(), mode: 'account' })).toEqual({ ok: true, userId: UID, scope: 'account' });
    for (const bad of [null, undefined, 'x', {}, { user_id: UID }, { mode: 'data' }, { user_id: 'not-a-uuid', mode: 'data' }, { user_id: UID, mode: 'everything' }, { user_id: UID, mode: 'DATA' }, { user_id: 12, mode: 'data' }, { user_id: `${UID}; drop table x`, mode: 'data' }, { user_id: ` ${UID}`, mode: 'data' }])
      expect(parseAdminInput(bad), JSON.stringify(bad)).toEqual({ ok: false });
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

describe('the admin-delete workflow never echoes the secret or the full id', () => {
  const wf = readFileSync('.github/workflows/admin-delete.yml', 'utf8');
  it('is manual, read-only, and uses no actions (so there is nothing unpinned)', () => {
    expect(wf).toContain('workflow_dispatch:');
    expect(wf).not.toMatch(/^\s*pull_request|^\s*push:|^\s*schedule:/m);
    expect(wf).toMatch(/permissions:\n\s+contents: read/);
    const uses = wf.split('\n').filter((l) => /^\s*-?\s*uses:/.test(l));
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}/);      // any action would have to be pinned to a commit
  });
  it('masks the id, prints only its last 4 characters and the status, and never prints the secret', () => {
    expect(wf).toContain('echo "::add-mask::$USER_ID"');
    expect(wf).toContain('...${USER_ID: -4}');
    expect(wf).toContain('status $status');
    const echoes = (wf.match(/echo\s+"[^"]*"/g) ?? []).join('\n');
    expect(echoes).not.toMatch(/\$\{?ADMIN_DELETE_SECRET/);
    const idEchoes = (wf.match(/echo\s+"[^"]*"/g) ?? []).filter((l) => /USER_ID/.test(l));
    expect(idEchoes.length).toBe(2);                              // the mask line and the final status line only
    expect(idEchoes.some((l) => l.includes('::add-mask::'))).toBe(true);
    expect(idEchoes.some((l) => l.includes('USER_ID: -4'))).toBe(true);
    expect(wf).toContain('set -euo pipefail');
    expect(wf).not.toMatch(/set -x|-v\b.*curl|curl.*(--verbose|-v )/);
    expect(wf).toContain('rm -f out.json');                      // the response body is not kept
    expect(wf).toContain('x-admin-delete-secret: $ADMIN_DELETE_SECRET');
  });
  it('checks the inputs again before using them', () => {
    expect(wf).toContain('user_id is not a uuid');
    expect(wf).toContain('mode must be data or account');
  });
});
