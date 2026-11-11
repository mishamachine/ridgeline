// Checks for the admin delete function: who may call it, and what it may be asked. Pure, so it is tested without Deno.
const te = new TextEncoder();

/**
 * Constant-time comparison of a header value with the secret. Both sides are hashed first, so the comparison always runs over two 32-byte values
 * (the length of the secret is not revealed) and never stops at the first difference.
 */
export async function secretMatches(header: string | null | undefined, secret: string | undefined): Promise<boolean> {
  if (!secret || !header) return false;
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', te.encode(header)), crypto.subtle.digest('SHA-256', te.encode(secret))]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export const ADMIN_HEADER = 'x-admin-delete-secret';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type AdminMode = 'data' | 'account';
export type AdminInput = { ok: true; requestId: string } | { ok: false };

/** The only input is a request id (a UUID). A body that carries a user id or a mode is refused outright: the account and the mode come from the stored, confirmed request. */
export function parseAdminInput(body: unknown): AdminInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false };
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some((k) => k !== 'request_id')) return { ok: false };
  if (typeof b.request_id !== 'string' || !UUID.test(b.request_id)) return { ok: false };
  return { ok: true, requestId: b.request_id.toLowerCase() };
}

export interface RequestRow { id: string; user_id: string; mode: string; status: string; expires_at: string; used_at: string | null }
export type RequestCheck = { ok: true; userId: string; scope: AdminMode } | { ok: false; reason: 'not_found' | 'not_confirmed' | 'used' | 'expired' | 'bad_mode' };

/** A request may be executed only when it exists, is confirmed, is unused and has not expired. */
export function checkRequest(row: RequestRow | null | undefined, now: number): RequestCheck {
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.used_at) return { ok: false, reason: 'used' };
  if (row.status !== 'confirmed') return { ok: false, reason: 'not_confirmed' };
  if (!(Date.parse(row.expires_at) > now)) return { ok: false, reason: 'expired' };
  if (row.mode !== 'data' && row.mode !== 'account') return { ok: false, reason: 'bad_mode' };
  return { ok: true, userId: row.user_id, scope: row.mode };
}
