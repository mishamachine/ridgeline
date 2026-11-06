import { cumulative, pointAt, LngLat } from '../geo';
import { Frame } from './frame';

export interface MatcherOptions {
  /** Snap when within max(accuracy, snapMinM). */
  snapMinM: number;
  /** Extra along-route slack beyond the accuracy that one step may move. */
  hysteresisM: number;
  /** Along-route speed allowed on top, m/s (covers gaps between fixes). */
  walkMps: number;
  /** Consistent fixes needed before accepting a jump along the route. */
  jumpConfirm: number;
  /** Off-route after this many consecutive fixes beyond max(offMinM, offFactor x accuracy). */
  offN: number;
  offMinM: number;
  offFactor: number;
  /** Back on route after this many consecutive fixes within that threshold. */
  backN: number;
}

export const MATCHER_DEFAULTS: MatcherOptions = {
  snapMinM: 25, hysteresisM: 30, walkMps: 2, jumpConfirm: 3, offN: 4, offMinM: 40, offFactor: 1.5, backN: 2,
};

export interface MatchResult {
  /** Point on the route, or null when not snapped. */
  snapped: LngLat | null;
  /** Distance along the route (m). When not matched this is the nearest point's. */
  along: number;
  /** Perpendicular distance from the (filtered) position to the chosen route point, m. */
  offset: number;
  matched: boolean;
  offRoute: boolean;
  /** Distance to the route's nearest point anywhere, m (what off-route is judged on). */
  routeOffset: number;
  /** Nearest route point to the position, for pointing the way back. */
  nearestPoint?: LngLat;
}

interface Cand { along: number; d: number }

export class RouteMatcher {
  readonly coords: LngLat[];
  readonly cum: number[];
  readonly total: number;
  private o: MatcherOptions;
  private frame: Frame;
  private seg: { ax: number; ay: number; dx: number; dy: number; len2: number; c0: number; cl: number }[] = [];
  private prevAlong: number | null = null;
  private prevT = 0;
  private rate = 0; // smoothed along-route speed, m/s (signed): which way we are heading
  private pending: { along: number; n: number } | null = null;
  private offCount = 0;
  private backCount = 0;
  private off = false;

  constructor(coords: LngLat[], opts: Partial<MatcherOptions> = {}) {
    this.o = { ...MATCHER_DEFAULTS, ...opts };
    this.coords = coords;
    this.cum = cumulative(coords);
    this.total = this.cum.at(-1) ?? 0;
    this.frame = new Frame(coords[0] ?? [0, 0]);
    const xy = coords.map((c) => this.frame.toXY(c));
    for (let i = 0; i < xy.length - 1; i++) {
      const dx = xy[i + 1][0] - xy[i][0], dy = xy[i + 1][1] - xy[i][1];
      this.seg.push({ ax: xy[i][0], ay: xy[i][1], dx, dy, len2: dx * dx + dy * dy, c0: this.cum[i], cl: this.cum[i + 1] - this.cum[i] });
    }
  }

  reset() {
    this.prevAlong = null; this.pending = null; this.rate = 0;
    this.offCount = this.backCount = 0; this.off = false;
  }

  /** Tell the matcher where we are on the route (manual anchor). */
  seed(along: number, t: number) {
    this.prevAlong = along; this.prevT = t; this.pending = null; this.rate = 0;
    this.offCount = this.backCount = 0; this.off = false;
  }

  /** One candidate per segment within `maxD` metres of p. */
  private candidates(px: number, py: number, maxD: number): { all: Cand[]; min: number } {
    const all: Cand[] = [];
    let min = Infinity;
    for (const s of this.seg) {
      const t = s.len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.ax) * s.dx + (py - s.ay) * s.dy) / s.len2));
      const d = Math.hypot(s.ax + t * s.dx - px, s.ay + t * s.dy - py);
      if (d < min) min = d;
      if (d <= maxD) all.push({ along: s.c0 + t * s.cl, d });
    }
    return { all, min };
  }

  /** Nearest route point to p; among ties (out-and-back) the one closest to `prefer`. */
  nearest(p: LngLat, prefer: number | null = this.prevAlong): { along: number; offset: number; point: LngLat } | null {
    if (!this.seg.length) return null;
    const [px, py] = this.frame.toXY(p);
    const { all, min } = this.candidates(px, py, Infinity);
    let best = all.filter((c) => c.d <= min + 3);
    if (prefer != null) best = best.sort((a, b) => Math.abs(a.along - prefer) - Math.abs(b.along - prefer));
    const c = best[0];
    return { along: c.along, offset: c.d, point: pointAt(this.coords, this.cum, c.along) };
  }

  match(p: LngLat, accuracy: number, t: number): MatchResult {
    if (!this.seg.length) return { snapped: null, along: 0, offset: Infinity, matched: false, offRoute: false, routeOffset: Infinity };
    const [px, py] = this.frame.toXY(p);
    const snapR = Math.max(accuracy, this.o.snapMinM);
    const { all, min } = this.candidates(px, py, snapR);
    let cands = all;
    if (!cands.length) cands = this.candidates(px, py, min + 15).all; // nothing in range: still track the nearest
    const dt = Math.max(0, (t - this.prevT) / 1000);
    const allow = accuracy + this.o.hysteresisM + this.o.walkMps * Math.min(dt, 60);

    let pick = cands.reduce((a, b) => (b.d < a.d ? b : a));
    if (this.prevAlong != null) {
      const prev = this.prevAlong;
      const near = cands.filter((c) => Math.abs(c.along - prev) <= allow);
      // Among near candidates prefer the closest, but break out-and-back ties by momentum:
      // keep going the way we were going along the route.
      const predicted = prev + this.rate * Math.min(dt, 5);
      const score = (c: Cand) => c.d + 0.2 * Math.abs(c.along - predicted);
      const bestNear = near.length ? near.reduce((a, b) => (score(b) < score(a) ? b : a)) : null;
      const far = Math.abs(pick.along - prev) > allow;
      // A far candidate wins only if it is clearly better, and only after it repeats.
      const farWins = far && (!bestNear || pick.d < 0.5 * bestNear.d - 3);
      if (farWins) {
        const pd = this.pending;
        this.pending = pd && Math.abs(pd.along - pick.along) <= allow ? { along: pick.along, n: pd.n + 1 } : { along: pick.along, n: 1 };
        if (this.pending.n >= this.o.jumpConfirm) this.pending = null;
        else pick = bestNear ?? { along: prev, d: pick.d };
      } else {
        this.pending = null;
        pick = bestNear ?? pick;
      }
    }
    if (this.prevAlong != null && dt >= 0.5 && dt <= 5) this.rate = 0.7 * this.rate + 0.3 * ((pick.along - this.prevAlong) / dt);
    else if (dt > 5) this.rate = 0;
    this.prevAlong = pick.along;
    this.prevT = t;

    // Off-route is judged on the distance to the route anywhere, so parallel legs never fake an alert.
    const thr = Math.max(this.o.offMinM, this.o.offFactor * accuracy);
    if (min > thr) { this.offCount++; this.backCount = 0; } else { this.backCount++; this.offCount = 0; }
    if (!this.off && this.offCount >= this.o.offN) this.off = true;
    else if (this.off && this.backCount >= this.o.backN) this.off = false;

    const matched = pick.d <= snapR;
    const nearest = matched ? undefined : this.nearest(p, null)?.point;
    return {
      nearestPoint: nearest,
      snapped: matched ? pointAt(this.coords, this.cum, pick.along) : null,
      along: pick.along,
      offset: pick.d,
      matched,
      offRoute: this.off,
      routeOffset: min,
    };
  }
}
