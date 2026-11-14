import { describe, it, expect, vi } from 'vitest';
import { appleClientSecret, exchangeAppleCode, jwtPayload } from '../../../supabase/functions/_shared/apple';

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const jwt = (payload: object) => `h.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.s`;

async function testKey() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  return { pem: `-----BEGIN PRIVATE KEY-----\n${b64(pkcs8)}\n-----END PRIVATE KEY-----`, pub: kp.publicKey };
}

describe('Apple client secret', () => {
  it('is an ES256 JWT with Apple\'s claims, signed by the key', async () => {
    const { pem, pub } = await testKey();
    const s = await appleClientSecret({ teamId: 'TEAM123456', keyId: 'KEY1234567', privateKeyPem: pem }, 'com.bbprojectfactory.ridgeline', 1000);
    const [h, p, sig] = s.split('.');
    expect(JSON.parse(new TextDecoder().decode(unb64url(h)))).toEqual({ alg: 'ES256', kid: 'KEY1234567', typ: 'JWT' });
    expect(JSON.parse(new TextDecoder().decode(unb64url(p)))).toEqual({ iss: 'TEAM123456', iat: 1000, exp: 1300, aud: 'https://appleid.apple.com', sub: 'com.bbprojectfactory.ridgeline' });
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64url(sig), new TextEncoder().encode(`${h}.${p}`))).toBe(true);
  });
  it('accepts a key pasted with literal \\n sequences (how dashboards often store it)', async () => {
    const { pem } = await testKey();
    await expect(appleClientSecret({ teamId: 't', keyId: 'k', privateKeyPem: pem.replace(/\n/g, '\\n') }, 'c')).resolves.toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  });
});

describe('Apple code exchange', () => {
  const ok = (body: object) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
  it('returns the refresh token and the Apple user id', async () => {
    const f = ok({ refresh_token: 'r1', id_token: jwt({ sub: 'apple-user-1' }) });
    expect(await exchangeAppleCode(f, 'cid', 'secret', 'code')).toEqual({ refreshToken: 'r1', sub: 'apple-user-1' });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://appleid.apple.com/auth/token');
    expect(String(init.body)).toContain('grant_type=authorization_code');
  });
  it('fails on an Apple error and on a response without tokens', async () => {
    await expect(exchangeAppleCode(vi.fn(async () => new Response('{}', { status: 400 })) as unknown as typeof fetch, 'c', 's', 'x')).rejects.toThrow('400');
    await expect(exchangeAppleCode(ok({ id_token: jwt({ sub: 'a' }) }), 'c', 's', 'x')).rejects.toThrow('missing');
  });
  it('parses a JWT payload', () => { expect(jwtPayload(jwt({ sub: 'z' }))).toEqual({ sub: 'z' }); });
});
