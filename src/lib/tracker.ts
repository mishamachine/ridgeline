// GPS track recording, saved to the device as it goes.
import { haversine } from './geo';
import { Activity, TrackPoint, putActivity } from './store';

const MAX_ACCURACY_M = 50; // ignore fixes worse than this
const MIN_STEP_M = 5;      // ignore jitter while standing still

export function trackDistance(points: TrackPoint[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversine([points[i - 1].lon, points[i - 1].lat], [points[i].lon, points[i].lat]);
  return d;
}

/** Adds a GPS fix to the activity if it is accurate and has moved. Returns true if added. */
export function addFix(a: Activity, pos: GeolocationPosition): boolean {
  const { longitude, latitude, altitude, accuracy } = pos.coords;
  if (accuracy > MAX_ACCURACY_M) return false;
  const last = a.points.at(-1);
  if (last && haversine([last.lon, last.lat], [longitude, latitude]) < MIN_STEP_M) return false;
  a.points.push({ lon: longitude, lat: latitude, alt: altitude, acc: accuracy, t: pos.timestamp });
  if (a.points.length % 10 === 0) putActivity(a);
  return true;
}

export function newActivity(name: string, trailId?: string): Activity {
  return { id: `${Date.now()}`, name, trailId, startedAt: Date.now(), points: [] };
}

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function toGPX(a: Activity): string {
  const pts = a.points
    .map((p) => `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${p.alt != null ? `<ele>${p.alt.toFixed(1)}</ele>` : ''}<time>${new Date(p.t).toISOString()}</time></trkpt>`)
    .join('\n      ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Ridgeline" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${esc(a.name)}</name>
    <trkseg>
      ${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

export function downloadGPX(a: Activity) {
  const blob = new Blob([toGPX(a)], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${a.name.replace(/[^\w-]+/g, '_')}.gpx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Keep the screen awake while navigating (where supported). */
export async function keepAwake(): Promise<() => void> {
  try {
    const lock = await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen');
    return () => { lock?.release().catch(() => {}); };
  } catch {
    return () => {};
  }
}
