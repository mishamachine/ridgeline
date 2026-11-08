// The two delete paths, with every side effect injected so each failure point can be tested.
//   data    -> remove this person's Ridgeline rows only (ONE SQL transaction). The shared B&B account stays.
//   account -> the same data step, then Apple revoke (Apple users), the Vault secret, and last the auth user.
// Honesty rule: 'failed' means nothing was deleted (the data step is one transaction). Once the data step has run, any later
// failure is 'partial': the Ridgeline data is gone but the account is not closed, and the person is told so and can retry.

export type Scope = 'data' | 'account';

export interface DeleteDeps {
  hasAppleIdentity: boolean;
  /** ridgeline.delete_user_data(uid): all Ridgeline rows in one transaction. */
  deleteUserData(): Promise<void>;
  readAppleToken(): Promise<string | null>;
  revokeApple(token: string): Promise<void>;
  deleteAppleToken(): Promise<void>;
  deleteAuthUser(): Promise<void>;
  /** Event names only. Never a token, code, email or id. */
  log(event: string): void;
}

/** apple: 'revoked' (we disconnected Apple), 'manual' (an Apple user we could not revoke for: tell them how), 'none' (not an Apple user). */
export type AppleResult = 'revoked' | 'manual' | 'none';
export type DeleteOutcome =
  | { status: 'ok'; apple: AppleResult }
  | { status: 'partial'; apple: AppleResult }
  | { status: 'failed' };

export async function deleteAccount(scope: Scope, d: DeleteDeps): Promise<DeleteOutcome> {
  try { await d.deleteUserData(); } catch { d.log('data_delete_failed'); return { status: 'failed' }; }
  if (scope === 'data') return { status: 'ok', apple: 'none' };

  let apple: AppleResult = 'none';
  if (d.hasAppleIdentity) {
    try {
      const token = await d.readAppleToken();
      if (token) { await d.revokeApple(token); d.log('apple_revoked'); apple = 'revoked'; }
      else { d.log('apple_revoke_skipped_no_token'); apple = 'manual'; } // an Apple user from before token capture, or from the web flow
    } catch { d.log('apple_revoke_failed'); return { status: 'partial', apple: 'manual' }; }
  }
  try { await d.deleteAppleToken(); } catch { d.log('vault_delete_failed'); return { status: 'partial', apple }; }
  try { await d.deleteAuthUser(); } catch { d.log('auth_delete_failed'); return { status: 'partial', apple }; }
  return { status: 'ok', apple };
}
