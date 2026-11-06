// "Drive there": hand the trailhead to the phone's own maps app.
import type { Trail } from './trails';

export type Platform = 'ios' | 'other';
export interface MapsOption { label: string; url: string }

/** Where to drive: the mapped trailhead when we have one, else where the route starts. */
export function trailheadOf(t: Pick<Trail, 'coords' | 'trailhead'>): { lat: number; lon: number } {
  if (t.trailhead) return { lon: t.trailhead[0], lat: t.trailhead[1] };
  return { lon: t.coords[0][0], lat: t.coords[0][1] };
}

/** Button wording: honest about whether we know a parking lot. */
export const driveLabel = (t: Pick<Trail, 'trailhead' | 'trailheadIsParking'>) =>
  t.trailhead && t.trailheadIsParking ? 'Drive to parking' : 'Drive to trail start';

export function mapsOptions(t: Pick<Trail, 'coords' | 'trailhead'>, platform: Platform): MapsOption[] {
  const { lat, lon } = trailheadOf(t);
  const ll = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  const google = { label: 'Google Maps', url: `https://www.google.com/maps/dir/?api=1&destination=${ll}` };
  if (platform === 'ios') return [{ label: 'Apple Maps', url: `https://maps.apple.com/?daddr=${ll}&dirflg=d` }, google];
  return [google];
}

export function detectPlatform(ua = navigator.userAgent): Platform {
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'ios' : 'other';
}
