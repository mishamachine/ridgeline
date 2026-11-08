import { describe, it, expect, vi, beforeEach } from 'vitest';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } });

import { DEFAULT_SETTINGS, LEGACY_UNITS_KEY, LEGACY_VOICE_KEY, SETTINGS_KEY, getSettings, loadSettings, sanitize, shouldShowOnboarding, updateSettings } from './settings';
import { getUnits, getVoiceOn, setVoiceOn } from './voice/prefs';

beforeEach(() => { mem.clear(); updateSettings(DEFAULT_SETTINGS); });

describe('settings', () => {
  it('starts with sensible defaults', () => expect(DEFAULT_SETTINGS).toEqual({ voice: true, units: 'imperial', withDogDefault: false, onboardingSeen: false, keepTracksLocal: false }));
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

describe('one source for voice and units', () => {
  const store = () => {
    const m = new Map<string, string>();
    return { m, s: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } } };
  };
  it('moves the old Navigate keys into settings once, then removes them', () => {
    const { m, s } = store();
    m.set(LEGACY_VOICE_KEY, 'off');
    m.set(LEGACY_UNITS_KEY, 'metric');
    expect(loadSettings(s)).toEqual({ ...DEFAULT_SETTINGS, voice: false, units: 'metric' });
    expect(m.has(LEGACY_VOICE_KEY) || m.has(LEGACY_UNITS_KEY)).toBe(false);
    expect(JSON.parse(m.get(SETTINGS_KEY)!)).toMatchObject({ voice: false, units: 'metric' });
    expect(loadSettings(s)).toEqual({ ...DEFAULT_SETTINGS, voice: false, units: 'metric' }); // second load: same, nothing left to migrate
  });
  it('ignores junk in the old keys and keeps other saved settings', () => {
    const { m, s } = store();
    m.set(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, onboardingSeen: true, withDogDefault: true }));
    m.set(LEGACY_VOICE_KEY, 'maybe');
    m.set(LEGACY_UNITS_KEY, 'metric');
    expect(loadSettings(s)).toMatchObject({ onboardingSeen: true, withDogDefault: true, voice: true, units: 'metric' });
  });
  it('leaves settings alone when there are no old keys', () => {
    const { m, s } = store();
    expect(loadSettings(s)).toEqual(DEFAULT_SETTINGS);
    expect(m.size).toBe(0);
  });
  it('Navigate prefs read and write the same values Profile edits', () => {
    updateSettings({ units: 'metric', voice: false });
    expect(getUnits()).toBe('metric');
    expect(getVoiceOn()).toBe(false);
    setVoiceOn(true);
    expect(getSettings().voice).toBe(true);
  });
});
