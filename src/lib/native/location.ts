// Native location for a hike: background updates, a lock-screen notification, nothing leaves the phone.
// Shape matches the LocationSource in src/lib/gps/source.ts (cto/gps-core); connect the two after both merge.
import { isNative } from './platform';
import { RidgelineHike, type NavNotification, type NativeFix } from './hikePlugin';
import type { PluginListenerHandle } from '@capacitor/core';

export type Fix = NativeFix;
export interface LocationError { code: number; message: string } // 1 denied, 2 unavailable, 3 timeout (like GeolocationPositionError)
export interface LocationSource {
  start(onFix: (f: Fix) => void, onError: (e: LocationError) => void): void;
  stop(): void;
  restart(): void;
}

const START_NOTE: NavNotification = { title: 'Ridgeline hike in progress', text: 'Finding your position…', progress: 0 };

export function createNativeLocationSource(initial: NavNotification = START_NOTE): LocationSource {
  let handles: Promise<PluginListenerHandle>[] = [];
  let cbs: { onFix: (f: Fix) => void; onError: (e: LocationError) => void } | null = null;
  let run = 0;

  const detach = () => { const h = handles; handles = []; h.forEach((p) => p.then((x) => x.remove()).catch(() => {})); };

  const begin = async () => {
    const me = ++run;
    const { onFix, onError } = cbs!;
    try {
      let perms = await RidgelineHike.checkPermissions();
      if (perms.location !== 'granted') perms = await RidgelineHike.requestPermissions();
      if (me !== run) return;
      if (perms.location !== 'granted') { onError({ code: 1, message: 'Location is off for Ridgeline. Allow it in Settings.' }); return; }
      handles = [
        RidgelineHike.addListener('fix', onFix),
        RidgelineHike.addListener('locationError', onError),
      ];
      await RidgelineHike.startHike(initial);
    } catch (e) {
      if (me === run) onError({ code: 2, message: e instanceof Error ? e.message : 'Could not start GPS.' });
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
