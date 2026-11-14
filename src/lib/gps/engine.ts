import { haversine, LngLat } from '../geo';
import { PositionFilter, KalmanOptions } from './kalman';
import { RouteMatcher, MatchResult, MatcherOptions } from './matcher';
import { METRIC_COPY } from '../metricCopy';
import { accuracyFt, isLocked, qualityOf, Quality } from './quality';
import { CompassReading, pickHeading } from './compass';
import type { Fix, GpsError, LocationSource } from './source';

export interface GpsRoute {
  coords: LngLat[];
  /** Elevation profile along the route (m), evenly spread from start to end. */
  elevation?: number[];
}

/** Native-only sensors. The web build leaves these out; a later native PR fills them in. */
export interface BarometerHook { altitudeM(): number | null }
export interface DeadReckoningHook {
  /** True while the step counter is carrying the position through a dropout. */
  active(): boolean;
}

export interface GpsEngineOptions {
  route?: GpsRoute | null;
  kalman?: Partial<KalmanOptions>;
  matcher?: Partial<MatcherOptions>;
  /** Called with each raw fix the filter accepted (for the track recorder). */
  onAccepted?: (f: Fix) => void;
  barometer?: BarometerHook;
  deadReckoning?: DeadReckoningHook;
  /** Monotonic clock in ms (performance.now by default). Used only for Recalibrate timing. */
  mono?: () => number;
}

export const NEAR_ROUTE_M = 250;
export const ANCHOR_GOOD_M = 15;
export const ANCHOR_MAX_MS = 120_000;
export const ANCHOR_RELEASE_FIXES = 3;
export const RECAL_TIMEOUT_MS = 30_000;

export interface GpsState {
  hasFix: boolean;
  /** Where to draw the dot: snapped to the trail when matched, else the filtered position. */
  position: LngLat | null;
  filtered: LngLat | null;
  uncertaintyM: number | null;
  accuracyFt: number | null;
  accuracyM: number | null;
  quality: Quality | null;
  warmingUp: boolean;
  recalibrating: boolean;
  /** Recalibrate has waited too long for a fresh fix. */
  recalTimedOut: boolean;
  /** Recalibrating, and the last known state before it was off route. */
  recalLastOffRoute: boolean;
  /** The dot is the last known position, shown while Recalibrate waits. */
  stalePosition: boolean;
  /** Compass bearing (deg) from you to the nearest trail point, for "X mi to the trail". */
  trailBearing: number | null;
  matched: boolean;
  /** Distance along the route (m); null when the route is more than 250 m away or there is no fix. */
  along: number | null;
  /** Distance from the filtered position to the route (m). */
  offsetM: number | null;
  offRoute: boolean;
  /** along / route length, 0..1. */
  progress: number | null;
  total: number;
  deadReckoning: boolean;
  anchored: boolean;
  /** Elevation from the DEM profile at the matched point (m). */
  altitudeM: number | null;
  baroAltitudeM: number | null;
  heading: number | null;
  headingSource: 'gps' | 'compass' | null;
  needsCalibration: boolean;
  compassAccuracy: number | null;
  error: GpsError | null;
}

export type AnchorResult = { ok: true } | { ok: false; reason: string };

const EMPTY: GpsState = {
  hasFix: false, position: null, filtered: null, uncertaintyM: null, accuracyFt: null, accuracyM: null, quality: null, warmingUp: true,
  recalibrating: false, recalTimedOut: false, recalLastOffRoute: false, stalePosition: false, trailBearing: null, matched: false, along: null, offsetM: null, offRoute: false, progress: null, total: 0,
  deadReckoning: false, anchored: false, altitudeM: null, baroAltitudeM: null, heading: null, headingSource: null,
  needsCalibration: false, compassAccuracy: null, error: null,
};

export class GpsEngine {
  state: GpsState = EMPTY;
  private filter: PositionFilter;
  private matcher: RouteMatcher | null = null;
  private elevation: number[] | undefined;
  private listeners = new Set<(s: GpsState) => void>();
  private lastRaw: Fix | null = null;
  private locked = false;
  private recalMono: number | null = null;
  private staleT = -Infinity;
  private fallback: LngLat | null = null;
  private joined = false;
  private prevOffRoute = false;
  private goodRun = 0;
  private nowMono = 0;
  private compass: CompassReading | null = null;
  private anchor: { point: LngLat; t: number } | null = null;
  private lastMatch: MatchResult | null = null;
  private error: GpsError | null = null;
  private clock = 0;

  constructor(private source: LocationSource, private opts: GpsEngineOptions = {}) {
    this.filter = new PositionFilter(opts.kalman);
    this.setRoute(opts.route ?? null);
  }

  setRoute(route: GpsRoute | null) {
    this.matcher = route && route.coords.length > 1 ? new RouteMatcher(route.coords, this.opts.matcher) : null;
    this.elevation = route?.elevation;
    this.anchor = null;
    this.lastMatch = null;
    this.joined = false;
    this.publish(this.clock);
  }

  start() {
    this.source.start((f) => this.ingest(f), (e) => { this.error = e; this.publish(this.clock); });
  }

  stop() { this.source.stop(); }

  subscribe(fn: (s: GpsState) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private mono() { return this.opts.mono?.() ?? (typeof performance !== 'undefined' ? performance.now() : Date.now()); }

  /** Restart the stream and reset the filter. Fixes are judged by arrival, never by comparing their clock to ours. */
  recalibrate() {
    this.recalMono = this.nowMono = this.mono();
    this.staleT = this.lastRaw?.t ?? this.staleT;
    this.fallback = this.state.position ?? this.fallback;
    this.prevOffRoute = this.state.offRoute || this.state.recalLastOffRoute;
    this.filter.reset();
    this.anchor = null;
    this.lastRaw = null;
    this.locked = false;
    this.lastMatch = null;
    this.goodRun = 0; // `joined` and the matcher's off-route state survive: an off-trail hiker stays alerted
    this.error = null;
    this.source.restart();
    this.publish(this.clock);
  }

  /** "I'm here on the trail": only if the tap is inside the circle we are showing. */
  manualAnchor(tap: LngLat, units: 'imperial' | 'metric' = 'imperial'): AnchorResult {
    const here = this.filter.position();
    if (!here || !this.lastRaw) return { ok: false, reason: 'No GPS position yet.' };
    if (!this.matcher) return { ok: false, reason: 'There is no trail to snap to.' };
    const radius = this.filter.radius(this.clock); // the circle the hiker sees
    if (haversine(tap, here) > radius) return { ok: false, reason: units === 'metric' ? METRIC_COPY.tapInside(Math.round(radius)) : `Tap inside the circle around your dot (about ${accuracyFt(radius)} ft).` };
    const n = this.matcher.nearest(tap, this.lastMatch?.along ?? null);
    if (!n || n.offset > Math.max(radius, 25)) return { ok: false, reason: 'No trail near that spot.' };
    if (haversine(n.point, here) > radius) return { ok: false, reason: units === 'metric' ? METRIC_COPY.pointOutside(Math.round(radius)) : `That trail point is outside the circle around your dot (about ${accuracyFt(radius)} ft).` };
    this.filter.setPosition(n.point, 8, this.clock);
    this.matcher.seed(n.along, this.clock);
    this.anchor = { point: n.point, t: this.clock };
    this.goodRun = 0;
    this.joined = true;
    this.lastMatch = { snapped: n.point, along: n.along, offset: 0, matched: true, offRoute: false, routeOffset: 0 };
    this.publish(this.clock);
    return { ok: true };
  }

  ingestCompass(r: CompassReading) {
    this.compass = r;
    this.publish(this.clock);
  }

  /** Feed one raw fix (the source calls this; tests call it directly). */
  ingest(f: Fix) {
    this.clock = Math.max(this.clock, f.t);
    this.error = null;
    this.nowMono = this.mono();
    if (this.recalMono != null) {
      // A fix with the same timestamp as the last one before Recalibrate is a cached repeat, unless we have waited a long time.
      if (f.t <= this.staleT && this.nowMono - this.recalMono < RECAL_TIMEOUT_MS) return;
      this.recalMono = null;
      this.fallback = null;
    }
    this.lastRaw = f;
    if (isLocked(f.accuracy)) this.locked = true;
    if (this.filter.update(f).accepted) {
      this.opts.onAccepted?.(f);
      if (this.matcher) {
        this.lastMatch = this.matcher.match(this.filter.position()!, this.filter.radius(f.t), f.t);
        this.prevOffRoute = false; // a real match has landed
      }
      if (this.lastMatch?.matched) this.joined = true;
      this.goodRun = f.accuracy <= ANCHOR_GOOD_M ? this.goodRun + 1 : 0;
      if (this.anchor && f.accuracy <= ANCHOR_GOOD_M && (this.goodRun >= ANCHOR_RELEASE_FIXES || haversine([f.lon, f.lat], this.anchor.point) <= f.accuracy + 15)) this.anchor = null;
    }
    this.publish(f.t);
  }

  /** Call about once a second so staleness and dropout growth show without new fixes. */
  tick(now: number) {
    this.clock = Math.max(this.clock, now);
    this.nowMono = this.mono();
    this.publish(now);
  }

  private publish(now: number) {
    if (this.anchor && now - this.anchor.t >= ANCHOR_MAX_MS) this.anchor = null;
    const filtered = this.filter.position();
    const raw = this.lastRaw;
    const m = this.lastMatch;
    const near = m != null && m.routeOffset <= NEAR_ROUTE_M;
    const total = this.matcher?.total ?? 0;
    const along = near ? m.along : null;
    const recal = this.recalMono != null;
    const speed = filtered ? this.filter.speed() : null;
    const head = pickHeading(speed, speed != null ? this.filter.course() : null, this.compass);
    const dem = along != null && this.elevation && this.elevation.length > 1 && total > 0 ? demAt(this.elevation, along / total) : null;
    const next: GpsState = {
      hasFix: filtered != null,
      position: m?.matched && m.snapped ? m.snapped : filtered ?? (recal ? this.fallback : null),
      filtered,
      uncertaintyM: filtered ? this.filter.radius(now) : null,
      accuracyFt: raw ? accuracyFt(raw.accuracy) : null,
      accuracyM: raw ? raw.accuracy : null,
      quality: raw ? qualityOf(raw.accuracy, now - raw.t) : null,
      warmingUp: !this.locked,
      recalibrating: recal,
      recalTimedOut: recal && this.nowMono - this.recalMono! >= RECAL_TIMEOUT_MS,
      recalLastOffRoute: this.prevOffRoute && this.lastMatch == null,
      stalePosition: recal && filtered == null && this.fallback != null,
      trailBearing: m && !m.matched && m.nearestPoint ? bearing(filtered!, m.nearestPoint) : null,
      matched: !!m?.matched,
      along,
      offsetM: m ? m.routeOffset : null,
      // Never alert before the hiker has joined the route (car park); once joined, always alert, however far.
      offRoute: !!m?.offRoute && this.joined && !this.anchor,
      progress: along != null && total > 0 ? Math.min(1, Math.max(0, along / total)) : null,
      total,
      deadReckoning: this.opts.deadReckoning?.active() ?? false,
      anchored: this.anchor != null,
      altitudeM: dem,
      baroAltitudeM: this.opts.barometer?.altitudeM() ?? null,
      heading: head?.degrees ?? null,
      headingSource: head?.source ?? null,
      // Only when the OS reports an accuracy; web Android gives none, so it would nag forever.
      needsCalibration: head?.source === 'compass' && this.compass?.accuracy != null ? head.needsCalibration : false,
      compassAccuracy: this.compass?.accuracy ?? null,
      error: this.error,
    };
    this.state = next;
    for (const fn of this.listeners) fn(next);
  }
}

function demAt(profile: number[], frac: number): number {
  const x = Math.min(1, Math.max(0, frac)) * (profile.length - 1);
  const i = Math.min(profile.length - 2, Math.floor(x));
  return profile[i] + (profile[i + 1] - profile[i]) * (x - i);
}

function bearing(a: LngLat, b: LngLat): number {
  const dx = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), dy = b[1] - a[1];
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}
