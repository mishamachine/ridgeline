import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { RETURN_KEY, rememberReturn, takeReturn } from './auth';

const store = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };

describe('signing in again from the delete page brings the person back to it', () => {
  it('remembers the delete page, hands it back once, and then forgets it', () => {
    const s = store();
    rememberReturn('account-delete', s);
    expect(s.m.get(RETURN_KEY)).toBe('account-delete');
    expect(takeReturn(s)).toBe('account-delete');
    expect(takeReturn(s)).toBeNull();
  });
  it('a normal sign-in forgets an old marker, and a junk value is ignored', () => {
    const s = store(); s.m.set(RETURN_KEY, 'account-delete');
    rememberReturn(undefined, s);
    expect(takeReturn(s)).toBeNull();
    s.m.set(RETURN_KEY, 'https://evil.example/');
    expect(takeReturn(s)).toBeNull();
  });
  it('the delete page opens the sign-in screen with a return to it; the screen remembers it for the web redirect, and the callback goes there', () => {
    expect(readFileSync('src/App.tsx', 'utf8')).toContain("onSignIn={() => go({ kind: 'sign-in', returnTo: 'account-delete' })}");
    expect(readFileSync('src/screens/SignIn.tsx', 'utf8')).toContain('signIn(p, features.accounts, returnTo)');
    expect(readFileSync('src/App.tsx', 'utf8')).toContain("takeReturn() === 'account-delete'");
  });
});
