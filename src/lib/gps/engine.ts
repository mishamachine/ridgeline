import { haversine, LngLat } from '../geo';
import { PositionFilter, KalmanOptions } from './kalman';
import { RouteMatcher, MatchResult, MatcherOptions } from './matcher';
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
  now?: () => number;
}

export const NEAR_ROUTE_M = 250;
export const ANCHOR_GOOD_M = 15;
export const ANCHOR_MAX_MS = 120_000;

export interface GpsState {
  hasFix: boolean;
  /** Where to draw the dot: snapped to the trail when matched, else the filtered position. */
  position: LngLat | null;
  filtered: LngLat | null;
  uncertaintyM: number | null;
  accuracyFt: number | null;
  quality: Quality | null;
  warmingUp: boolean;
  recalibrating: boolean;
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
  hasFix: false, position: null, filtered: null, uncertaintyM: null, accuracyFt: null, quality: null, warmingUp: true,
  recalibrating: false, matched: false, along: null, offsetM: null, offRoute: false, progress: null, total: 0,
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
  private recalAt: number | null = null;
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

  /** Restart the stream, reset the filter and throw away anything older than now. */
  recalibrate() {
    this.recalAt = this.opts.now?.() ?? Date.now();
    this.filter.reset();
    this.matcher?.reset();
    this.anchor = null;
    this.lastRaw = null;
    this.locked = false;
    this.lastMatch = null;
    this.error = null;
    this.source.restart();
    this.publish(this.clock);
  }

  /** "I'm here on the trail": only if the tap is inside the circle we are showing. */
  manualAnchor(tap: LngLat): AnchorResult {
    const here = this.filter.position();
    if (!here || !this.lastRaw) return { ok: false, reason: 'No GPS position yet.' };
    if (!this.matcher) return { ok: false, reason: 'There is no trail to snap to.' };
    const radius = Math.max(this.filter.radius(this.clock), this.lastRaw.accuracy);
    if (haversine(tap, here) > radius) return { ok: false, reason: `Tap inside the circle around your dot (about ${accuracyFt(radius)} ft).` };
    const n = this.matcher.nearest(tap, this.lastMatch?.along ?? null);
    if (!n || n.offset > Math.max(radius, 25)) return { ok: false, reason: 'No trail near that spot.' };
    this.filter.setPosition(n.point, 8, this.clock);
    this.matcher.seed(n.along, this.clock);
    this.anchor = { point: n.point, t: this.clock };
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
    if (this.recalAt != null) {
      if (f.t < this.recalAt - 1000) return; // a cached fix from before Recalibrate
      this.recalAt = null;
    }
    this.lastRaw = f;
    if (isLocked(f.accuracy)) this.locked = true;
    if (this.filter.update(f).accepted) {
      this.opts.onAccepted?.(f);
      if (this.matcher) this.lastMatch = this.matcher.match(this.filter.position()!, this.filter.radius(f.t), f.t);
      if (this.anchor && f.accuracy <= ANCHOR_GOOD_M && haversine([f.lon, f.lat], this.anchor.point) <= f.accuracy + 15) this.anchor = null;
    }
    this.publish(f.t);
  }

  /** Call about once a second so staleness and dropout growth show without new fixes. */
  tick(now: number) {
    this.clock = Math.max(this.clock, now);
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
    const speed = filtered ? this.filter.speed() : null;
    const head = pickHeading(speed, speed != null ? this.filter.course() : null, this.compass);
    const dem = along != null && this.elevation && this.elevation.length > 1 && total > 0 ? demAt(this.elevation, along / total) : null;
    const next: GpsState = {
      hasFix: filtered != null,
      position: m?.matched && m.snapped ? m.snapped : filtered,
      filtered,
      uncertaintyM: filtered ? this.filter.radius(now) : null,
      accuracyFt: raw ? accuracyFt(raw.accuracy) : null,
      quality: raw ? qualityOf(raw.accuracy, now - raw.t) : null,
      warmingUp: !this.locked,
      recalibrating: this.recalAt != null,
      matched: !!m?.matched,
      along,
      offsetM: m ? m.routeOffset : null,
      offRoute: !!m?.offRoute && !this.anchor,
      progress: along != null && total > 0 ? Math.min(1, Math.max(0, along / total)) : null,
      total,
      deadReckoning: this.opts.deadReckoning?.active() ?? false,
      anchored: this.anchor != null,
      altitudeM: dem,
      baroAltitudeM: this.opts.barometer?.altitudeM() ?? null,
      heading: head?.degrees ?? null,
      headingSource: head?.source ?? null,
      needsCalibration: head?.source === 'compass' ? head.needsCalibration : false,
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
