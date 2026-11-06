// Heading: GPS course when moving, device compass when standing still.

export const MOVING_MPS = 0.7;
export const POOR_COMPASS = 25;

export interface CompassReading { degrees: number; /** iOS webkitCompassAccuracy, degrees; null when the OS gives none. */ accuracy: number | null }
export interface Heading { degrees: number; source: 'gps' | 'compass'; needsCalibration: boolean }

/** Poor (over 25, or negative = uncalibrated on iOS) or absent accuracy means the compass needs a figure-8. */
export const compassNeedsCalibration = (accuracy: number | null | undefined) =>
  accuracy == null || accuracy < 0 || accuracy > POOR_COMPASS;

export function pickHeading(speedMps: number | null, courseDeg: number | null, compass: CompassReading | null): Heading | null {
  if (speedMps != null && courseDeg != null && speedMps > MOVING_MPS) {
    return { degrees: courseDeg, source: 'gps', needsCalibration: false };
  }
  if (compass) return { degrees: compass.degrees, source: 'compass', needsCalibration: compassNeedsCalibration(compass.accuracy) };
  return null;
}

type OrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number; webkitCompassAccuracy?: number };

export function readingFromEvent(e: OrientationEvent): CompassReading | null {
  if (typeof e.webkitCompassHeading === 'number') {
    return { degrees: e.webkitCompassHeading, accuracy: typeof e.webkitCompassAccuracy === 'number' ? e.webkitCompassAccuracy : null };
  }
  if (e.absolute && typeof e.alpha === 'number') return { degrees: (360 - e.alpha) % 360, accuracy: null };
  return null;
}

/** iOS asks permission, and only from a tap. Returns whether orientation events may flow. */
export async function requestCompassPermission(): Promise<boolean> {
  const D = (typeof DeviceOrientationEvent === 'undefined' ? undefined : DeviceOrientationEvent) as
    | (typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> })
    | undefined;
  if (!D) return false;
  if (typeof D.requestPermission !== 'function') return true;
  try { return (await D.requestPermission()) === 'granted'; } catch { return false; }
}

/** Listen for compass readings (web). Returns a stop function. */
export function startCompass(onReading: (r: CompassReading) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const h = (e: Event) => { const r = readingFromEvent(e as OrientationEvent); if (r) onReading(r); };
  window.addEventListener('deviceorientationabsolute', h);
  window.addEventListener('deviceorientation', h);
  return () => {
    window.removeEventListener('deviceorientationabsolute', h);
    window.removeEventListener('deviceorientation', h);
  };
}
