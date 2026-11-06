import { describe, it, expect, vi, beforeEach } from 'vitest';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } });

import { DEFAULT_SETTINGS, SETTINGS_KEY, getSettings, sanitize, shouldShowOnboarding, updateSettings } from './settings';

beforeEach(() => { mem.clear(); updateSettings(DEFAULT_SETTINGS); });

describe('settings', () => {
  it('starts with sensible defaults', () => expect(DEFAULT_SETTINGS).toEqual({ voice: true, units: 'imperial', withDogDefault: false, onboardingSeen: false }));
  it('sanitize drops unknown keys and wrong types', () => {
    expect(sanitize({ voice: 'x', units: 'metric', extra: 1 })).toEqual({ ...DEFAULT_SETTINGS, units: 'metric' });
    expect(sanitize(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitize('string')).toEqual(DEFAULT_SETTINGS);
  });
  it('update persists to localStorage and is readable', () => {
    updateSettings({ units: 'metric' });
    expect(getSettings().units).toBe('metric');
    expect(JSON.parse(mem.get(SETTINGS_KEY)!).units).toBe('metric');
  });
  it('keeps working in memory when storage throws', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(() => updateSettings({ voice: false })).not.toThrow();
    expect(getSettings().voice).toBe(false);
  });
  it('shows the tour on first run, not after, and always for ?onboarding', () => {
    expect(shouldShowOnboarding('')).toBe(true);
    updateSettings({ onboardingSeen: true });
    expect(shouldShowOnboarding('')).toBe(false);
    expect(shouldShowOnboarding('?onboarding')).toBe(true);
    expect(shouldShowOnboarding('?x=1&onboarding=1')).toBe(true);
  });
});
