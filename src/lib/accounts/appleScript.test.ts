import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { APPLE_JS_URL, loadAppleScript, resetAppleScriptForTests } from './appleWeb';
import { accountsLive } from './flags';
import { APPLE_PRIVACY_LINE, ACCOUNTS_SECTION_HTML } from './privacyAccounts';
import { FLAGS_KEY } from './flags';

// A document that only counts the script tags it is given (any request to Apple's CDN starts with one).
const fakeDoc = () => { const added: { src: string }[] = []; const doc = { createElement: () => ({ src: '', async: false, onload: null as (() => void) | null, onerror: null as (() => void) | null, remove() {} }), head: { appendChild: (s: { src: string; onload: (() => void) | null }) => { added.push(s); queueMicrotask(() => s.onload?.()); } } }; return { doc: doc as unknown as Document, added }; };
const mem = (accounts?: boolean) => ({ getItem: (k: string) => (k === FLAGS_KEY && accounts !== undefined ? JSON.stringify({ accounts, at: 1, tried: 1 }) : null), setItem: () => {} });

beforeEach(() => resetAppleScriptForTests());

describe('Apple\'s script is requested only when the web sign-in screen opens with accounts live', () => {
  it('the URL is Apple\'s documented one', () => {
    expect(APPLE_JS_URL).toBe('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js');
  });
  it('no request with the flag off (accounts not built in)', async () => {
    const { doc, added } = fakeDoc();
    await expect(loadAppleScript(doc, accountsLive(false, mem(true)))).rejects.toThrow();
    expect(added).toHaveLength(0);
  });
  it('no request while paused, or before the flag has been read', async () => {
    for (const store of [mem(false), mem(undefined)]) {
      const { doc, added } = fakeDoc();
      await expect(loadAppleScript(doc, accountsLive(true, store))).rejects.toThrow();
      expect(added).toHaveLength(0);
    }
  });
  it('exactly one request when the sign-in screen opens (and not again if it opens twice)', async () => {
    const { doc, added } = fakeDoc();
    await loadAppleScript(doc, accountsLive(true, mem(true)));
    await loadAppleScript(doc, accountsLive(true, mem(true)));
    expect(added).toHaveLength(1);
    expect(added[0].src).toBe(APPLE_JS_URL);
  });
});

describe('nothing else can request it', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const src = walk('src').filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));
  it('the CDN host appears only in appleWeb.ts (the script URL) and in the privacy line', () => {
    const hits = src.filter((f) => readFileSync(f, 'utf8').includes('appleid.cdn-apple.com'));
    expect(hits.sort()).toEqual(['src/lib/accounts/appleWeb.ts', 'src/lib/accounts/privacyAccounts.ts']);
  });
  it('loadAppleScript is called from exactly one place: the web Apple button, which only mounts on a sign-in screen', () => {
    const callers = src.filter((f) => /loadAppleScript\(/.test(readFileSync(f, 'utf8')) && !f.endsWith('appleWeb.ts'));
    expect(callers).toEqual(['src/components/AppleButton.tsx']);
    const btn = readFileSync('src/components/AppleButton.tsx', 'utf8');
    expect(btn.split('function WebButton')[1]).toContain('loadAppleScript()');
    expect(btn.split('function IosButton')[1].split('function WebButton')[0]).not.toContain('loadAppleScript');   // never in the native apps
  });
  it('the page and the app shell carry no Apple script tag', () => {
    expect(readFileSync('index.html', 'utf8')).not.toMatch(/appleid|cdn-apple/);
  });
});

describe('the privacy line names the host the app really loads', () => {
  it('is the approved sentence with that host in it', () => {
    expect(APPLE_PRIVACY_LINE).toBe("Apple, when you open the sign-in screen on the web: your browser loads Apple's Sign in with Apple button from Apple's servers (appleid.cdn-apple.com). Apple sees your IP address and browser details. If you choose Apple, it handles your sign-in under its own privacy policy.");
  });
  it('the host in the line equals the host of the script URL (if one changes, this fails)', () => {
    const host = new URL(APPLE_JS_URL).hostname;
    expect(APPLE_PRIVACY_LINE).toContain(`(${host})`);
    expect(ACCOUNTS_SECTION_HTML).toContain(APPLE_PRIVACY_LINE);
  });
});
