// Sign in with Apple server helpers. Runtime-agnostic (WebCrypto + fetch), so Deno and Node tests both run it.
// No secret is read here: the caller passes the key in.

const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : new Uint8Array(b);
  let s = ''; for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export interface AppleKey { teamId: string; keyId: string; privateKeyPem: string }

/** Apple's "client secret": an ES256 JWT signed with the .p8 key, valid for minutes (we make a new one per call). */
export async function appleClientSecret(k: AppleKey, clientId: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const pem = k.privateKeyPem.replace(/\\n/g, '\n').replace(/-----(BEGIN|END) PRIVATE KEY-----|\s/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: k.keyId, typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iss: k.teamId, iat: nowSec, exp: nowSec + 300, aud: 'https://appleid.apple.com', sub: clientId }));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

export type Fetch = typeof fetch;

export interface AppleTokens { refreshToken: string; sub: string }

/** Reads the (unverified) payload of a JWT that came straight from Apple over TLS. */
export function jwtPayload(jwt: string): Record<string, unknown> {
  const p = jwt.split('.')[1];
  if (!p) throw new Error('bad jwt');
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(p.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
}

/** Exchanges the authorization code from the sign-in for Apple's refresh token. */
export async function exchangeAppleCode(f: Fetch, clientId: string, clientSecret: string, code: string): Promise<AppleTokens> {
  const res = await f('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code' }),
  });
  if (!res.ok) throw new Error(`apple token exchange failed: ${res.status}`);
  const j = await res.json() as { refresh_token?: string; id_token?: string };
  if (!j.refresh_token || !j.id_token) throw new Error('apple token exchange: missing tokens');
  const sub = jwtPayload(j.id_token).sub;
  if (typeof sub !== 'string') throw new Error('apple token exchange: no sub');
  return { refreshToken: j.refresh_token, sub };
}
