import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

let plat: 'ios' | 'android' | 'web' = 'web';
vi.mock('./platform', () => ({ nativePlatform: () => plat, isNative: () => plat !== 'web' }));
vi.mock('../features', () => ({ features: { accounts: true } }));

import { deviceWord, thisDevice } from './deviceWord';
import { pausedNote, AccountRow } from '../../components/AccountRow';
import { promptBody } from '../../components/GuestPrompt';
import { differentAccountMessage } from '../accounts/session';
import { deleteCopy, resultText } from '../../screens/DeleteAccount';
import { FLAGS_KEY } from '../accounts/flags';

beforeEach(() => { plat = 'web'; });

describe('device wording by platform', () => {
  it('web says device, ios and android say phone, and the platform is read when no argument is given', () => {
    expect(deviceWord('web')).toBe('device');
    expect(deviceWord('ios')).toBe('phone');
    expect(deviceWord('android')).toBe('phone');
    expect(thisDevice('web')).toBe('this device');
    expect(thisDevice('ios', true)).toBe('This phone');
    expect(thisDevice('web', true)).toBe('This device');
    plat = 'web'; expect(thisDevice()).toBe('this device');
    plat = 'android'; expect(thisDevice()).toBe('this phone');
  });
  it('the shared lines read both ways', () => {
    expect(pausedNote('web')).toBe('Sign-in is paused for now. Your hikes are safe on this device.');
    expect(pausedNote('ios')).toBe('Sign-in is paused for now. Your hikes are safe on this phone.');
    expect(promptBody('web')).toBe("Right now they're saved only on this device. Sign in to keep them if you lose or switch phones.");
    expect(promptBody('android')).toContain('only on this phone.');
    expect(differentAccountMessage('web')).toContain('not the account used on this device,');
    expect(differentAccountMessage('ios')).toContain('not the account used on this phone,');
    expect(deleteCopy('web').data.warn).toContain('This device is signed out and its copies are removed.');
    expect(deleteCopy('ios').data.warn).toContain('This phone is signed out and its copies are removed.');
    expect(resultText('data', { status: 'ok', apple: 'none' }, 'web')).toContain('and this device is signed out with its copies removed');
    expect(resultText('data', { status: 'ok', apple: 'none' }, 'ios')).toContain('and this phone is signed out with its copies removed');
  });
  it('a rendered screen follows the platform it is on', () => {
    const store = (() => { const m = new Map([[FLAGS_KEY, JSON.stringify({ accounts: false, at: 1, tried: 1 })]]); return { getItem: (k: string) => m.get(k) ?? null, setItem: () => {} }; })();
    vi.stubGlobal('localStorage', store);
    try {
      plat = 'web';
      expect(renderToStaticMarkup(<AccountRow build />)).toContain('safe on this device.');
      plat = 'ios';
      expect(renderToStaticMarkup(<AccountRow build />)).toContain('safe on this phone.');
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('the one exception: the setting name', () => {
  it('stays "Keep hike tracks on this phone only" on every platform (it is a proper name quoted in the privacy page)', () => {
    const src = readFileSync(join(__dirname, '../../screens/Profile.tsx'), 'utf8');
    const name = 'Keep hike tracks on this phone only';
    expect(src.split(`<span>${name}</span>`)).toHaveLength(2);
    expect(src).toContain(`label="${name}"`);
    expect(src).not.toMatch(/Keep hike tracks on \$\{/);
    expect(src).not.toContain('Keep hike tracks on this device');
    // and the privacy page still quotes it verbatim
    expect(readFileSync(join(__dirname, '../accounts/privacyAccounts.ts'), 'utf8')).toContain(name);
  });
});

describe('no hard-coded "this phone" is left in running text', () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  // Allowed: the setting name, the privacy page and its go-live swaps, the two files that pick the word per platform on their own.
  const allowed = [/Keep hike tracks on this phone only/, /deviceWord\.ts$/, /privacyAccounts\.ts$/, /goLiveCopy\.ts$/, /guestContinue\.ts$/, /fullNote\.ts$/];
  it('every remaining literal is an allowed one', () => {
    const root = join(__dirname, '../..');
    const bad: string[] = [];
    for (const f of walk(root).filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p))) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((l, i) => {
        if (/^\s*(\*|\/\*|\/\/)/.test(l)) return;
        const code = l.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
        if (/\bthis phone\b/i.test(code) && !allowed.some((a) => a.test(f) || a.test(l))) bad.push(`${f}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
