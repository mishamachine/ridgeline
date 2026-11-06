// Device-only settings. Stored in localStorage on this phone; never sent anywhere.
import { useSyncExternalStore } from 'react';

export type Units = 'imperial' | 'metric';

export interface Settings {
  voice: boolean;
  units: Units;
  /** New hikes start marked "with a dog". */
  withDogDefault: boolean;
  onboardingSeen: boolean;
}

export const DEFAULT_SETTINGS: Settings = { voice: true, units: 'imperial', withDogDefault: false, onboardingSeen: false };
export const SETTINGS_KEY = 'ridgeline:settings';

/** Keeps only known keys of the right type, so a bad or old value cannot break the app. */
export function sanitize(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    voice: typeof r.voice === 'boolean' ? r.voice : d.voice,
    units: r.units === 'metric' || r.units === 'imperial' ? r.units : d.units,
    withDogDefault: typeof r.withDogDefault === 'boolean' ? r.withDogDefault : d.withDogDefault,
    onboardingSeen: typeof r.onboardingSeen === 'boolean' ? r.onboardingSeen : d.onboardingSeen,
  };
}

function load(): Settings {
  try {
    const t = localStorage.getItem(SETTINGS_KEY);
    return sanitize(t ? JSON.parse(t) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let current: Settings = load();
const listeners = new Set<() => void>();

export const getSettings = () => current;

export function updateSettings(patch: Partial<Settings>) {
  current = sanitize({ ...current, ...patch });
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(current)); } catch { /* private mode or full: keep in memory */ }
  listeners.forEach((l) => l());
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const s = useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, getSettings, getSettings);
  return [s, updateSettings];
}

/** True when the tour should show: first run, or `?onboarding` in the URL. */
export function shouldShowOnboarding(search = typeof location === 'undefined' ? '' : location.search): boolean {
  return new URLSearchParams(search).has('onboarding') || !current.onboardingSeen;
}
