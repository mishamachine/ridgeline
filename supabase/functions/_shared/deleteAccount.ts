// The two delete paths, with every side effect injected so the order can be tested.
//   data    -> remove this person's Ridgeline rows only. The shared B&B account stays.
//   account -> Apple revoke (if they signed in with Apple), delete the Vault secret, delete Ridgeline rows, delete the auth user.
// Apple revoke happens FIRST: if Apple refuses, nothing is deleted and the person can retry.

export type Scope = 'data' | 'account';

export interface DeleteDeps {
  hasAppleIdentity: boolean;
  readAppleToken(): Promise<string | null>;
  revokeApple(token: string): Promise<void>;
  deleteAppleToken(): Promise<void>;
  deleteRidgelineRows(): Promise<void>;
  deleteAuthUser(): Promise<void>;
  /** Event names only. Never a token, code, email or id. */
  log(event: string): void;
}

/** apple: 'revoked' (we disconnected Apple), 'manual' (an Apple user we could not revoke for: tell them how), 'none' (not an Apple user). */
export type AppleResult = 'revoked' | 'manual' | 'none';
/** partial: the Ridgeline rows are gone but the auth user could not be deleted. Never report that as success. */
export type DeleteOutcome =
  | { status: 'ok'; apple: AppleResult }
  | { status: 'partial'; apple: AppleResult }
  | { status: 'failed'; reason: 'apple_revoke_failed' };

export async function deleteAccount(scope: Scope, d: DeleteDeps): Promise<DeleteOutcome> {
  if (scope === 'data') {
    await d.deleteRidgelineRows();
    return { status: 'ok', apple: 'none' };
  }
  let apple: AppleResult = 'none';
  if (d.hasAppleIdentity) {
    const token = await d.readAppleToken();
    if (token) {
      try { await d.revokeApple(token); } catch { d.log('apple_revoke_failed'); return { status: 'failed', reason: 'apple_revoke_failed' }; }
      d.log('apple_revoked');
      apple = 'revoked';
    } else {
      // An Apple user from before token capture, or from the web flow: we hold nothing to revoke with.
      d.log('apple_revoke_skipped_no_token');
      apple = 'manual';
    }
  }
  await d.deleteAppleToken();
  await d.deleteRidgelineRows();
  try { await d.deleteAuthUser(); } catch { d.log('auth_delete_failed_after_rows'); return { status: 'partial', apple }; }
  return { status: 'ok', apple };
}
