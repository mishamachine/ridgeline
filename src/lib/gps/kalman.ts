import type { LngLat } from '../geo';
import { Frame } from './frame';
import type { Fix } from './source';

export interface KalmanOptions {
  /** Fixes with a worse accuracy radius are dropped. */
  maxAccuracyM: number;
  /** Fastest believable ground speed, m/s (walking/hiking). A fix with a GPS speed raises this for that step. */
  maxSpeedMps: number;
  /** Process noise: how hard a hiker accelerates, m/s^2. */
  accelSigma: number;
  minAccuracyM: number;
  /** After this many consistent "impossible" fixes in a row, believe them and re-lock. */
  relockAfter: number;
  /** Uncertainty growth while holding through a dropout, m/s. */
  holdGrowthMps: number;
}

export const KALMAN_DEFAULTS: KalmanOptions = {
  maxAccuracyM: 50,
  maxSpeedMps: 4,
  accelSigma: 0.4,
  minAccuracyM: 3,
  relockAfter: 5,
  holdGrowthMps: 1,
};

export type Rejection = 'accuracy' | 'jump' | 'stale';
export interface FilterResult { accepted: boolean; reason?: Rejection }

// One axis of a constant-velocity filter: state [p, v], covariance [[pp, pv], [pv, vv]].
class Axis {
  p = 0; v = 0; pp = 0; pv = 0; vv = 0;
  init(z: number, r: number) { this.p = z; this.v = 0; this.pp = r; this.pv = 0; this.vv = 4; }
  predict(dt: number, q: number) {
    this.p += this.v * dt;
    const pp = this.pp + dt * (2 * this.pv + dt * this.vv) + (q * dt ** 4) / 4;
    const pv = this.pv + dt * this.vv + (q * dt ** 3) / 2;
    this.pp = pp; this.pv = pv; this.vv += q * dt * dt;
  }
  update(z: number, r: number) {
    const s = this.pp + r;
    const kp = this.pp / s, kv = this.pv / s, y = z - this.p;
    this.p += kp * y;
    this.v += kv * y;
    this.vv -= kv * this.pv;
    this.pp *= 1 - kp;
    this.pv *= 1 - kp;
  }
}

/** Constant-velocity Kalman filter in local metres around the first accepted fix. */
export class PositionFilter {
  private o: KalmanOptions;
  private frame: Frame | null = null;
  private x = new Axis();
  private y = new Axis();
  private lastT = 0;
  private lastAcc = 0;
  private jumps: { x: number; y: number; acc: number }[] = [];

  constructor(opts: Partial<KalmanOptions> = {}) {
    this.o = { ...KALMAN_DEFAULTS, ...opts };
  }

  get started() { return this.frame != null; }
  get lastFixT() { return this.lastT; }
  get lastAccuracy() { return this.lastAcc; }

  reset() {
    this.frame = null;
    this.jumps = [];
    this.lastT = 0;
    this.lastAcc = 0;
  }

  update(f: Fix): FilterResult {
    if (!(f.accuracy <= this.o.maxAccuracyM)) return { accepted: false, reason: 'accuracy' };
    const r = Math.max(f.accuracy, this.o.minAccuracyM) ** 2;
    if (!this.frame) {
      this.frame = new Frame([f.lon, f.lat]);
      this.x.init(0, r); this.y.init(0, r);
      this.lastT = f.t; this.lastAcc = f.accuracy;
      return { accepted: true };
    }
    const dt = (f.t - this.lastT) / 1000;
    if (dt <= 0) return { accepted: false, reason: 'stale' };
    const [zx, zy] = this.frame.toXY([f.lon, f.lat]);
    const vmax = Math.max(this.o.maxSpeedMps, (f.speed ?? 0) * 1.5);
    const gate = vmax * dt + 3 * Math.sqrt((this.x.pp + this.y.pp) / 2 + r);
    if (Math.hypot(zx - this.x.p, zy - this.y.p) > gate) {
      const prev = this.jumps.at(-1);
      if (prev && Math.hypot(zx - prev.x, zy - prev.y) <= 2 * f.accuracy + 15) this.jumps.push({ x: zx, y: zy, acc: f.accuracy });
      else this.jumps = [{ x: zx, y: zy, acc: f.accuracy }];
      if (this.jumps.length >= this.o.relockAfter) {
        // Several fixes agree with each other but not with us: we were wrong, not them.
        this.x.init(zx, r); this.y.init(zy, r);
        this.lastT = f.t; this.lastAcc = f.accuracy; this.jumps = [];
        return { accepted: true };
      }
      return { accepted: false, reason: 'jump' };
    }
    this.jumps = [];
    if (dt > 3) { // long gap: do not coast on an old velocity
      const k = Math.exp(-(dt - 3) / 8);
      this.x.v *= k; this.y.v *= k;
    }
    const q = this.o.accelSigma ** 2;
    this.x.predict(dt, q); this.y.predict(dt, q);
    this.x.update(zx, r); this.y.update(zy, r);
    const sp = Math.hypot(this.x.v, this.y.v);
    if (sp > vmax) { this.x.v *= vmax / sp; this.y.v *= vmax / sp; }
    this.lastT = f.t; this.lastAcc = f.accuracy;
    return { accepted: true };
  }

  /** Last good position (held, not extrapolated). */
  position(): LngLat | null {
    return this.frame ? this.frame.toLngLat(this.x.p, this.y.p) : null;
  }

  /** Move the estimate (used by the manual anchor). */
  setPosition(p: LngLat, sigmaM: number, t: number) {
    if (!this.frame) this.frame = new Frame(p);
    const [px, py] = this.frame.toXY(p);
    this.x.init(px, sigmaM ** 2); this.y.init(py, sigmaM ** 2);
    this.lastT = t; this.lastAcc = sigmaM; this.jumps = [];
  }

  /** Radius (m) we believe the true position lies within, growing while no fix arrives. */
  radius(nowT: number): number {
    if (!this.frame) return Infinity;
    const sigma = Math.sqrt((this.x.pp + this.y.pp) / 2);
    const gap = Math.max(0, (nowT - this.lastT) / 1000 - 2);
    return Math.max(1.5 * sigma, this.lastAcc * 0.8, 5) + gap * this.o.holdGrowthMps;
  }

  speed(): number { return Math.hypot(this.x.v, this.y.v); }
  /** Course over ground from the velocity estimate, degrees clockwise from north. */
  course(): number { return ((Math.atan2(this.x.v, this.y.v) * 180) / Math.PI + 360) % 360; }
}
