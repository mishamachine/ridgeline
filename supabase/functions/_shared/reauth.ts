// Deleting a whole account needs a recent sign-in: a stolen or left-open session must not be able to close the account.
export const REAUTH_WINDOW_MS = 10 * 60 * 1000;

/** True when `lastSignInAt` (Supabase's user.last_sign_in_at) is within the window and not in the future. */
export function recentSignIn(lastSignInAt: string | null | undefined, now = Date.now(), windowMs = REAUTH_WINDOW_MS): boolean {
  const t = Date.parse(lastSignInAt ?? '');
  return Number.isFinite(t) && now - t <= windowMs && t - now < 60_000;
}
