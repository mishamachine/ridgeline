// Sign-in nonce. The provider gets the SHA-256 hex of `raw`; Supabase gets `raw` and checks the two match.
export interface Nonce { raw: string; hashed: string }

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(s: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

export async function makeNonce(): Promise<Nonce> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('');
  return { raw, hashed: await sha256Hex(raw) };
}
