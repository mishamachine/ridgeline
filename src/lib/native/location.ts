// Native location for a hike: background updates, a lock-screen notification, nothing leaves the phone.
// Implements LocationSource from src/lib/gps/source.ts; the GpsEngine takes it in place of WebLocationSource.
import { isNative } from './platform';
import { RidgelineHike, type NavNotification } from './hikePlugin';
import type { PluginListenerHandle } from '@capacitor/core';
import type { Fix, GpsError, LocationSource } from '../gps/source';

const CODES: GpsError['code'][] = ['unavailable', 'denied', 'unavailable', 'timeout']; // native: 1 denied, 2 unavailable, 3 timeout
const toError = (e: { code: number; message: string }): GpsError => ({ code: CODES[e.code] ?? 'unavailable', message: e.message });

const START_NOTE: NavNotification = { title: 'Ridgeline hike in progress', text: 'Finding your position…', progress: 0 };

export function createNativeLocationSource(initial: NavNotification = START_NOTE): LocationSource {
  let handles: Promise<PluginListenerHandle>[] = [];
  let cbs: { onFix: (f: Fix) => void; onError: (e: GpsError) => void } | null = null;
  let run = 0;

  const detach = () => { const h = handles; handles = []; h.forEach((p) => p.then((x) => x.remove()).catch(() => {})); };

  const begin = async () => {
    const me = ++run;
    const { onFix, onError } = cbs!;
    try {
      let perms = await RidgelineHike.checkPermissions();
      if (perms.location !== 'granted') perms = await RidgelineHike.requestPermissions();
      if (me !== run) return;
      if (perms.location !== 'granted') { onError({ code: 'denied', message: 'Location is off for Ridgeline. Allow it in Settings.' }); return; }
      handles = [
        RidgelineHike.addListener('fix', onFix),
        RidgelineHike.addListener('locationError', (e) => onError(toError(e))),
      ];
      await RidgelineHike.startHike(initial);
    } catch (e) {
      if (me === run) onError({ code: 'unavailable', message: e instanceof Error ? e.message : 'Could not start GPS.' });
    }
  };

  return {
    start(onFix, onError) { cbs = { onFix, onError }; void begin(); },
    stop() { run++; cbs = null; detach(); void RidgelineHike.stopHike().catch(() => {}); },
    restart() { if (!cbs) return; const c = cbs; run++; detach(); void RidgelineHike.stopHike().catch(() => {}).then(() => { cbs = c; void begin(); }); },
  };
}

/** Begin a hike: location updates plus the ongoing notification (Android) / background indicator (iOS). */
export async function startHike(note: NavNotification = START_NOTE): Promise<void> {
  if (!isNative()) return;
  await RidgelineHike.startHike(note);
}
export async function stopHike(): Promise<void> {
  if (!isNative()) return;
  await RidgelineHike.stopHike();
}
/** Refresh the lock-screen notification: next instruction, distance to the fork, distance left, % done. */
export async function updateNavNotification(n: NavNotification): Promise<void> {
  if (!isNative()) return;
  await RidgelineHike.updateNotification(n);
}
