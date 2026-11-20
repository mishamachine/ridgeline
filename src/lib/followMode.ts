// Follow-me button: off -> centre on me -> heading-up -> off. Pure logic, so it can be tested without a map or a sensor.

export type FollowMode = 'off' | 'centre' | 'heading';

/** The tap order. Heading-up needs a compass, so the tap only asks for it; `headingResult` says how that went. */
export type FollowEvent =
  | { type: 'tap' }
  | { type: 'drag' }                         // the person dragged the map: following ends
  | { type: 'rotate' }                       // the person rotated the map by hand: heading-up ends, centring stays
  | { type: 'headingResult'; ok: boolean }   // the sensor answered (or did not)
  | { type: 'noSensor' }                      // no reading came in time
  | { type: 'centre' };                       // a screen action asks to centre on me (e.g. Center)

export interface FollowState { mode: FollowMode; /** Heading-up was asked for and the sensor has not answered yet. */ pending: boolean; note: string | null }

export const FOLLOW_START: FollowState = { mode: 'off', pending: false, note: null };
export const NOTE_DENIED = 'Compass is off for this app, so the map stays centred on you.';
export const NOTE_NO_SENSOR = 'No compass on this device. The map stays centred on you.';

export function followStep(s: FollowState, e: FollowEvent): FollowState {
  switch (e.type) {
    case 'tap':
      if (s.mode === 'off') return { mode: 'centre', pending: false, note: null };
      if (s.mode === 'centre') return { mode: 'centre', pending: true, note: null }; // waits for the sensor
      return { mode: 'off', pending: false, note: null };
    case 'headingResult':
      if (!s.pending) return s;
      return e.ok ? { mode: 'heading', pending: false, note: null } : { mode: 'centre', pending: false, note: NOTE_DENIED };
    case 'noSensor': return s.pending ? { mode: 'centre', pending: false, note: NOTE_NO_SENSOR } : s;
    case 'centre': return s.mode === 'centre' && !s.pending ? s : { mode: 'centre', pending: false, note: null };
    case 'drag': return FOLLOW_START;
    case 'rotate': return s.mode === 'heading' ? { mode: 'centre', pending: false, note: null } : s;
  }
}

/** Compass degrees are a circle: 359 to 1 is a 2 degree step. */
export const angleDiff = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;

/** Moves `prev` toward `next` by `k` (0..1) the short way round, so the map does not shake on sensor noise. */
export function smoothHeading(prev: number | null, next: number, k = 0.35): number {
  if (prev == null) return ((next % 360) + 360) % 360;
  return (((prev + angleDiff(prev, next) * k) % 360) + 360) % 360;
}

/** Map bearing for heading-up, in MapLibre's -180..180 range. */
export const toBearing = (deg: number) => { const d = ((deg % 360) + 360) % 360; return d > 180 ? d - 360 : d; };

/** The north arrow shows when the map is turned or tilted by more than a hair. */
export const isRotated = (bearing: number, pitch = 0) => Math.abs(bearing) > 0.5 || pitch > 0.5;
