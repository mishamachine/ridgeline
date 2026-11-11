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
export type AdminInput = { ok: true; userId: string; scope: AdminMode } | { ok: false };

/** user_id must be a UUID and mode 'data' or 'account'. Nothing else is accepted. */
export function parseAdminInput(body: unknown): AdminInput {
  const b = (body && typeof body === 'object' ? body : {}) as { user_id?: unknown; mode?: unknown };
  if (typeof b.user_id !== 'string' || !UUID.test(b.user_id)) return { ok: false };
  if (b.mode !== 'data' && b.mode !== 'account') return { ok: false };
  return { ok: true, userId: b.user_id.toLowerCase(), scope: b.mode };
}
