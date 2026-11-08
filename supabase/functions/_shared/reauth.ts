// Deleting a whole account needs a recent sign-in: a stolen or left-open session must not be able to close the account.
// "Recent" is read from THIS session's own token, not from the person's last sign-in on any device: a token carries `amr`, the list of the
// authentication methods used to create the session, each with the time it happened. Refreshing the token does not change those times.
export const REAUTH_WINDOW_MS = 10 * 60 * 1000;

/** The payload of a JWT. Call it only on a token the auth server has already accepted (getUser does that). */
export function jwtClaims(jwt: string): Record<string, unknown> {
  try {
    const p = jwt.split('.')[1] ?? '';
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(p.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
  } catch { return {}; }
}

/** When this session was created: the latest `amr` timestamp, in ms, or null when the token has none. */
export function sessionStartedAt(claims: Record<string, unknown>): number | null {
  const amr = claims.amr;
  if (!Array.isArray(amr)) return null;
  const times = amr.map((a) => Number((a as { timestamp?: unknown })?.timestamp)).filter((t) => Number.isFinite(t) && t > 0);
  return times.length ? Math.max(...times) * 1000 : null;
}

/** True when this session was created within the window (and not in the future). A token without session times is not recent. */
export function recentSignIn(claims: Record<string, unknown>, now = Date.now(), windowMs = REAUTH_WINDOW_MS): boolean {
  const t = sessionStartedAt(claims);
  return t !== null && now - t <= windowMs && t - now < 60_000;
}
