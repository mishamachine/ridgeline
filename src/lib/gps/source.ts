// Location sources. The engine only sees this interface, so a native Capacitor source
// (FusedLocation on Android, CoreLocation on iOS) can replace the web one in a later PR.

export interface Fix {
  lat: number;
  lon: number;
  /** Horizontal accuracy radius, metres. */
  accuracy: number;
  altitude?: number;
  altitudeAccuracy?: number;
  /** Ground speed, m/s. */
  speed?: number;
  /** Course over ground, degrees clockwise from north. */
  heading?: number;
  /** Epoch ms. */
  t: number;
}

export interface GpsError {
  code: 'denied' | 'unavailable' | 'timeout' | 'unsupported';
  message: string;
}

export interface LocationSource {
  start(onFix: (f: Fix) => void, onError: (e: GpsError) => void): void;
  stop(): void;
  /** Tear the stream down and bring it up again (used by Recalibrate). */
  restart(): void;
}

const num = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function fixFromPosition(p: GeolocationPosition): Fix {
  const c = p.coords;
  return {
    lat: c.latitude,
    lon: c.longitude,
    accuracy: c.accuracy,
    altitude: num(c.altitude),
    altitudeAccuracy: num(c.altitudeAccuracy),
    speed: num(c.speed),
    heading: num(c.heading),
    t: p.timestamp,
  };
}

export class WebLocationSource implements LocationSource {
  private watch: number | null = null;
  private onFix: ((f: Fix) => void) | null = null;
  private onError: ((e: GpsError) => void) | null = null;

  constructor(private geo: Geolocation | undefined = typeof navigator === 'undefined' ? undefined : navigator.geolocation) {}

  start(onFix: (f: Fix) => void, onError: (e: GpsError) => void) {
    this.onFix = onFix;
    this.onError = onError;
    this.open();
  }

  stop() {
    this.close();
    this.onFix = this.onError = null;
  }

  restart() {
    if (!this.onFix) return;
    this.close();
    this.open();
  }

  private open() {
    if (!this.geo) {
      this.onError?.({ code: 'unsupported', message: 'This device has no location support.' });
      return;
    }
    this.watch = this.geo.watchPosition(
      (p) => this.onFix?.(fixFromPosition(p)),
      (e) =>
        this.onError?.(
          e.code === e.PERMISSION_DENIED
            ? { code: 'denied', message: 'Location is blocked. Allow it in your browser settings.' }
            : e.code === e.TIMEOUT
              ? { code: 'timeout', message: 'Looking for GPS…' }
              : { code: 'unavailable', message: 'Looking for GPS…' },
        ),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  }

  private close() {
    if (this.watch != null) this.geo?.clearWatch(this.watch);
    this.watch = null;
  }
}
