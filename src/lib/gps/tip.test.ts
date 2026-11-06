import { describe, it, expect } from 'vitest';
import { LngLat, cumulative, pointAt } from '../geo';
import { Frame } from './frame';
import { GpsEngine } from './engine';
import { findReversals } from './reversals';
import type { LocationSource } from './source';

// Out-and-back to a viewpoint: 500 m east, a little bend, a 400 m spur to the tip, and the same way back.
const fr = new Frame([-121.7, 47.5]);
const OUT: [number, number][] = [[0, 0], [250, 0], [500, 30], [900, 30]];
const XY = [...OUT, ...[...OUT].reverse().slice(1).map(([x, y]) => [x, y + 2] as [number, number])];
const ROUTE: LngLat[] = XY.map(([x, y]) => fr.toLngLat(x, y));
const CUM = cumulative(ROUTE);
const TOTAL = CUM.at(-1)!;
const TIP = cumulative(ROUTE)[OUT.length - 1];
const T0 = 1_700_000_000_000;
const stub: LocationSource = { start() {}, stop() {}, restart() {} };

function rng(seed: number) {
  let a = seed >>> 0;
  const u = () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return () => Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u());
}

/** Walk the whole route once at 1.2 m/s with sigma metres of noise; return the share of fixes matched to the wrong leg. */
function wrongLeg(sigma: number, seed: number) {
  const g = rng(seed);
  const eng = new GpsEngine(stub, { route: { coords: ROUTE } });
  let wrong = 0, n = 0, tipJump = 0, last: number | null = null;
  for (let t = 0; 1.2 * t < TOTAL; t++) {
    const d = 1.2 * t;
    const [x, y] = fr.toXY(pointAt(ROUTE, CUM, d));
    const p = fr.toLngLat(x + g() * sigma, y + g() * sigma);
    eng.ingest({ lon: p[0], lat: p[1], accuracy: 1.5 * sigma, t: T0 + t * 1000 });
    const a = eng.state.along;
    if (a == null) continue;
    n++;
    if (Math.abs(a - d) > 50) wrong++;
    if (Math.abs(d - TIP) < 60 && last != null) tipJump = Math.max(tipJump, Math.abs(a - last));
    last = a;
  }
  return { wrong: wrong / n, tipJump };
}

describe('route reversal (spur tip)', () => {
  it('finds one tip at the end of the way out', () => {
    const r = findReversals(ROUTE);
    expect(r).toHaveLength(1);
    expect(Math.abs(r[0] - TIP)).toBeLessThan(5);
  });
  it('finds none on a plain loop with a switchback bend', () => {
    const c = [[0, 0], [200, 0], [200, 100], [0, 100], [0, 10]].map(([x, y]) => fr.toLngLat(x, y));
    expect(findReversals(c)).toEqual([]);
  });
  it('a V hairpin is not a spur tip', () => {
    // Two legs 10 and 20 degrees apart: a sharp turn, but the legs separate.
    const hairpin = (deg: number) => { const r = (deg * Math.PI) / 180; return [fr.toLngLat(0, 0), fr.toLngLat(400, 0), fr.toLngLat(400 - 400 * Math.cos(r), 400 * Math.sin(r))]; };
    expect(findReversals(hairpin(10))).toEqual([]);
    expect(findReversals(hairpin(20))).toEqual([]);
  });
  it('stacked switchbacks 20 m apart are not spur tips', () => {
    const sw = [[0, 0], [300, 0], [300, 20], [0, 20], [0, 40], [300, 40], [300, 60], [0, 60]].map(([x, y]) => fr.toLngLat(x, y));
    expect(findReversals(sw)).toEqual([]);
  });
  it('sigma 15 m: under 1% of fixes land on the wrong leg, and progress never jumps at the tip', () => {
    const runs = [1, 2, 3, 4, 5].map((s) => wrongLeg(15, s));
    const wrong = runs.reduce((a, r) => a + r.wrong, 0) / runs.length;
    const jump = Math.max(...runs.map((r) => r.tipJump));
    console.log(`[tip] sigma 15 m | wrong-leg ${(wrong * 100).toFixed(2)}% | biggest step at the tip ${jump.toFixed(0)} m`);
    expect(wrong).toBeLessThan(0.01);
    expect(jump).toBeLessThan(60);
  });
});
