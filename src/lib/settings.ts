// Device-only settings. Stored in localStorage on this phone; never sent anywhere.
import { useSyncExternalStore } from 'react';

export type Units = 'imperial' | 'metric';

export interface Settings {
  voice: boolean;
  units: Units;
  /** New hikes start marked "with a dog". */
  withDogDefault: boolean;
  onboardingSeen: boolean;
  /** Signed-in sync uploads hike summaries but never the GPS route. Device-only: never synced itself. */
  keepTracksLocal: boolean;
}

export const DEFAULT_SETTINGS: Settings = { voice: true, units: 'imperial', withDogDefault: false, onboardingSeen: false, keepTracksLocal: false };
export const SETTINGS_KEY = 'ridgeline:settings';
/** When the synced settings last changed (ms), for last-write-wins. */
export const SETTINGS_STAMP_KEY = 'ridgeline:settings:updatedAt';
/** Local edit stamp for the synced settings: rises on edits made on this phone only (never set by sync). */
export const SETTINGS_EDIT_KEY = 'ridgeline:settings:editedAt';
/** The settings that follow the person across devices. onboardingSeen and keepTracksLocal stay on this phone. */
export const SYNCED_SETTING_KEYS = ['voice', 'units', 'withDogDefault'] as const;

/** Keeps only known keys of the right type, so a bad or old value cannot break the app. */
export function sanitize(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    voice: typeof r.voice === 'boolean' ? r.voice : d.voice,
    units: r.units === 'metric' || r.units === 'imperial' ? r.units : d.units,
    withDogDefault: typeof r.withDogDefault === 'boolean' ? r.withDogDefault : d.withDogDefault,
    onboardingSeen: typeof r.onboardingSeen === 'boolean' ? r.onboardingSeen : d.onboardingSeen,
    keepTracksLocal: typeof r.keepTracksLocal === 'boolean' ? r.keepTracksLocal : d.keepTracksLocal,
  };
}

/** Keys Navigate used before settings were shared. Read once, copied into the settings, then removed. */
export const LEGACY_VOICE_KEY = 'ridgeline.voice';
export const LEGACY_UNITS_KEY = 'ridgeline.units';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Reads the settings and folds in the two legacy keys (they win once, because they were the only place the choice was ever made). */
export function loadSettings(store: Store): Settings {
  let s = { ...DEFAULT_SETTINGS };
  try {
    const t = store.getItem(SETTINGS_KEY);
    s = sanitize(t ? JSON.parse(t) : null);
  } catch { /* unreadable: defaults */ }
  try {
    const v = store.getItem(LEGACY_VOICE_KEY), u = store.getItem(LEGACY_UNITS_KEY);
    if (v === null && u === null) return s;
    if (v === 'on' || v === 'off') s = { ...s, voice: v === 'on' };
    if (u === 'metric' || u === 'imperial') s = { ...s, units: u };
    store.setItem(SETTINGS_KEY, JSON.stringify(s));
    store.removeItem(LEGACY_VOICE_KEY);
    store.removeItem(LEGACY_UNITS_KEY);
  } catch { /* private mode: keep what we have in memory */ }
  return s;
}

function load(): Settings {
  try { return loadSettings(localStorage); } catch { return { ...DEFAULT_SETTINGS }; }
}

let current: Settings = load();
const listeners = new Set<() => void>();

export const getSettings = () => current;

export function updateSettings(patch: Partial<Settings>, stamp = true) {
  const before = current;
  current = sanitize({ ...current, ...patch });
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(current)); } catch { /* private mode or full: keep in memory */ }
  if (stamp && SYNCED_SETTING_KEYS.some((k) => before[k] !== current[k])) {
    try {
      const now = Date.now();
      localStorage.setItem(SETTINGS_STAMP_KEY, String(now));
      localStorage.setItem(SETTINGS_EDIT_KEY, String(Math.max(now, (Number(localStorage.getItem(SETTINGS_EDIT_KEY)) || 0) + 1)));
    } catch { /* ignore */ }
  }
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
