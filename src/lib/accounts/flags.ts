// The runtime pause switch. features.accounts (built into the app) says the app CAN offer accounts; this file says whether they are ON right now.
// A tiny static file on our own host, https://hike.bbprojectfactory.com/flags.json, holds {"accounts": true|false}. It is the same host that serves the
// web app and the trail data, so the apps need no third-party host, and its .json files already allow the apps' WebView origins (deploy/htaccess).
// Fail-safe: if the file cannot be fetched the last known value stays; before the first successful fetch on a new install the value is "off".
import { useSyncExternalStore } from 'react';
import { features } from '../features';
import { SITE_URL } from '../site';

export const FLAGS_URL = SITE_URL + '/flags.json';
export const FLAGS_KEY = 'ridgeline:flags';
export const FLAGS_REFRESH_MS = 60 * 60 * 1000;

interface Stored { accounts: boolean; at: number; tried: number }
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const listeners = new Set<() => void>();
const store = (): Store | null => { try { return localStorage; } catch { return null; } };

export function readFlags(s: Store | null = store()): Stored | null {
  try {
    const raw = JSON.parse(s?.getItem(FLAGS_KEY) ?? 'null');
    return raw && typeof raw.accounts === 'boolean' ? { accounts: raw.accounts, at: Number(raw.at) || 0, tried: Number(raw.tried) || 0 } : null;
  } catch { return null; }
}
function writeFlags(v: Stored, s: Store | null = store()) { try { s?.setItem(FLAGS_KEY, JSON.stringify(v)); } catch { /* keep going without it */ } listeners.forEach((l) => l()); }

/** 'unknown' before the first successful fetch; then 'on' or 'off' (the last known value). */
export type RemoteState = 'unknown' | 'on' | 'off';
export const remoteState = (s?: Store | null): RemoteState => { const f = readFlags(s); return !f ? 'unknown' : f.accounts ? 'on' : 'off'; };

/**
 * What the app shows:
 *   off      the build has no accounts (today's behaviour)
 *   unknown  accounts are built in but the flag has not been read yet: show nothing about accounts, run nothing
 *   paused   the flag says off: sign-in hidden, no sync, the local copy untouched
 *   live     everything on
 */
export type AccountsState = 'off' | 'unknown' | 'paused' | 'live';
export const accountsState = (build: boolean = features.accounts, s?: Store | null): AccountsState =>
  !build ? 'off' : ({ unknown: 'unknown', off: 'paused', on: 'live' } as const)[remoteState(s)];
/** True only when accounts are built in AND the flag is on. This is what gates sign-in, the client and sync. */
export const accountsLive = (build: boolean = features.accounts, s?: Store | null): boolean => accountsState(build, s) === 'live';

/** Reads the flag file. At most once an hour (failed tries count too); a failure keeps the last known value. Never throws. */
export async function refreshFlags(fetchFn: typeof fetch = fetch, now = Date.now(), force = false, s: Store | null = store()): Promise<void> {
  const cur = readFlags(s);
  if (!force && cur && now - cur.tried < FLAGS_REFRESH_MS) return;
  try {
    const res = await fetchFn(FLAGS_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('flags ' + res.status);
    const j = (await res.json()) as { accounts?: unknown };
    if (typeof j?.accounts !== 'boolean') throw new Error('flags: bad shape');
    writeFlags({ accounts: j.accounts, at: now, tried: now }, s);
  } catch {
    if (cur) writeFlags({ ...cur, tried: now }, s);   // keep the last known value; do not hammer the host
  }
}

/** Starts reading the flag: now, and again whenever the app returns to the front. Does nothing (no network) while the build has no accounts. */
export function startFlagRefresh(build: boolean = features.accounts): () => void {
  if (!build || typeof document === 'undefined') return () => {};
  refreshFlags();
  const vis = () => { if (document.visibilityState === 'visible') refreshFlags(); };
  document.addEventListener('visibilitychange', vis);
  return () => document.removeEventListener('visibilitychange', vis);
}

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
/** React: the current AccountsState, updated when the flag changes. An explicit `override` (tests, previews) wins. */
export function useAccountsState(build: boolean = features.accounts, override?: boolean): AccountsState {
  const state = useSyncExternalStore(subscribe, () => accountsState(build), () => accountsState(build));
  return override === undefined ? state : override ? 'live' : 'off';
}
