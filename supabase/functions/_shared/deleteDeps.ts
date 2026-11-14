// The side effects of a delete, built ONE way for both paths: the signed-in person's own delete (delete-account) and the owner's admin delete
// (admin-delete-account, used for deletion requests received by email). Same steps, same order, same results: only who is allowed to call differs.
import { appleClientSecret, revokeAppleToken, type Fetch } from './apple.ts';
import type { DeleteDeps } from './deleteAccount.ts';
import { retryOnDeadlock } from './retry.ts';

/** What the builder needs from the Supabase clients (kept minimal so it can be tested without a database). */
export interface RidgelineRpc { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> }
export interface AdminAuth { auth: { admin: { deleteUser(id: string): PromiseLike<{ error: { message?: string } | null }> } } }

export function buildDeleteDeps(o: {
  uid: string; hasAppleIdentity: boolean; rl: RidgelineRpc; admin: AdminAuth;
  env: (k: string) => string; fetchFn?: Fetch; log: (event: string) => void; wait?: (ms: number) => Promise<void>;
}): DeleteDeps {
  const { uid, rl, admin, env } = o;
  const clientId = env('APPLE_BUNDLE_ID') || 'com.bbprojectfactory.ridgeline';
  return {
    hasAppleIdentity: o.hasAppleIdentity,
    async readAppleToken() { const { data, error } = await rl.rpc('read_apple_token', { p_user: uid }); if (error) throw error; return (data as string | null) ?? null; },
    async revokeApple(token) {
      const secret = await appleClientSecret({ teamId: env('APPLE_TEAM_ID'), keyId: env('APPLE_KEY_ID'), privateKeyPem: env('APPLE_PRIVATE_KEY') }, clientId);
      await revokeAppleToken(o.fetchFn ?? fetch, clientId, secret, token);
    },
    async deleteAppleToken() { const { error } = await rl.rpc('delete_apple_token', { p_user: uid }); if (error) throw error; },
    // one transaction; retried if the database picks it as a deadlock victim (40P01)
    async deleteUserData() { await retryOnDeadlock(async () => { const { error } = await rl.rpc('delete_user_data', { uid }); if (error) throw error; }, 3, o.wait); },
    async deleteAuthUser() { const { error } = await admin.auth.admin.deleteUser(uid); if (error) throw error; },
    log: o.log,
  };
}
