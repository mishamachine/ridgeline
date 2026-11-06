import { describe, it, expect } from 'vitest';
import { LngLat, haversine, projectOnLine, cumulative } from '../geo';
import { Frame } from './frame';
import { GpsEngine } from './engine';
import type { Fix, LocationSource } from './source';

// ---- Synthetic trail (metres east/north of the trailhead) ----
// Leg 1 east, then a switchback stack with legs 20 m apart (parallel paths), a 160 m out-and-back spur, and a run to the end.
const XY: [number, number][] = [
  [0, 0], [300, 0], [300, 20], [100, 20], [100, 40], [400, 40], [600, 40],
  [600, 200], [600, 40], // spur out and back along the same line
  [900, 40], [900, 60], [700, 60],
];
const frame = new Frame([-121.7, 47.5]);
const ROUTE: LngLat[] = XY.map(([x, y]) => frame.toLngLat(x, y));
const CUM = cumulative(ROUTE);
const TOTAL = CUM.at(-1)!;
const SPEED = 1.2;

function rng(seed: number) {
  let a = seed >>> 0;
  const u = () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = () => Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u());
  return { u, g };
}

function pointAlong(d: number): LngLat {
  const i = Math.max(1, CUM.findIndex((c) => c >= d));
  const k = i < 0 ? CUM.length - 1 : i;
  const t = (d - CUM[k - 1]) / (CUM[k] - CUM[k - 1] || 1);
  return [ROUTE[k - 1][0] + t * (ROUTE[k][0] - ROUTE[k - 1][0]), ROUTE[k - 1][1] + t * (ROUTE[k][1] - ROUTE[k - 1][1])];
}

interface Sample { t: number; truth: LngLat; d: number; fix: Fix | null }

interface Scenario { rho?: number; sigma: number; seconds: number; seed: number; dropouts?: number[]; multipathRate?: number; treeBursts?: number[]; excursion?: { from: number; to: number } }

/** Walk back and forth along the route at 1.2 m/s, one fix per second, then damage the fixes. */
function trace(s: Scenario): Sample[] {
  const { u, g } = rng(s.seed);
  const out: Sample[] = [];
  let d = 0, dir = 1, ex = 0, ey = 0;
  const rho = s.rho ?? 0;
  for (let t = 0; t < s.seconds; t++) {
    d += dir * SPEED;
    if (d >= TOTAL) { d = TOTAL; dir = -1; } else if (d <= 0) { d = 0; dir = 1; }
    let truth = pointAlong(d);
    if (s.excursion && t >= s.excursion.from && t < s.excursion.to) {
      // leave the trail northwards at walking speed
      const [x, y] = frame.toXY(truth);
      truth = frame.toLngLat(x, y - (t - s.excursion.from) * SPEED);
    }
    const [tx, ty] = frame.toXY(truth);
    const inDrop = (s.dropouts ?? []).some((a) => t >= a && t < a + 30);
    const inTree = (s.treeBursts ?? []).some((a) => t >= a && t < a + 40);
    let sigma = s.sigma, acc = 1.5 * s.sigma;
    if (inTree) { acc = 30 + u() * 30; sigma = acc / 1.5; }
    ex = rho * ex + Math.sqrt(1 - rho * rho) * g() * sigma; ey = rho * ey + Math.sqrt(1 - rho * rho) * g() * sigma;
    let nx = rho ? ex : g() * sigma, ny = rho ? ey : g() * sigma;
    if (!inDrop && u() < (s.multipathRate ?? 0)) { const a = u() * 2 * Math.PI; nx += 80 * Math.cos(a); ny += 80 * Math.sin(a); }
    const p = frame.toLngLat(tx + nx, ty + ny);
    out.push({ t, truth, d, fix: inDrop ? null : { lon: p[0], lat: p[1], accuracy: acc, t: 1_700_000_000_000 + t * 1000 } });
  }
  return out;
}

const stub: LocationSource = { start() {}, stop() {}, restart() {} };
const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
const T0 = 1_700_000_000_000;

interface Metrics { wrongLeg: number; rawMedian: number; engineMedian: number; rawAlerts: number; engineAlerts: number; hours: number; rawSnappedMedian: number }

function run(s: Scenario): Metrics {
  const samples = trace(s);
  const eng = new GpsEngine(stub, { route: { coords: ROUTE } });
  let wrong = 0, n = 0;
  const rawErr: number[] = [], rawSnapErr: number[] = [], engErr: number[] = [];
  let rawOff = false, engOff = false, rawAlerts = 0, engAlerts = 0;
  for (const smp of samples) {
    if (!smp.fix) { eng.tick(T0 + smp.t * 1000); continue; }
    const f = smp.fix;
    eng.ingest(f);
    // Baseline = what Navigate did before: nearest point on the route to the raw fix, instant off-route test.
    const raw: LngLat = [f.lon, f.lat];
    const pr = projectOnLine(ROUTE, CUM, raw);
    const rawOffNow = pr.offset > Math.max(40, 1.5 * f.accuracy);
    if (rawOffNow && !rawOff) rawAlerts++;
    rawOff = rawOffNow;
    const st = eng.state;
    if (st.offRoute && !engOff) engAlerts++;
    engOff = st.offRoute;
    rawErr.push(haversine(raw, smp.truth));
    const snap = pointAlongRoute(pr.along);
    rawSnapErr.push(haversine(snap, smp.truth));
    engErr.push(haversine(st.position!, smp.truth));
    n++;
    if (st.along == null || Math.abs(st.along - smp.d) > 50) wrong++;
  }
  return { wrongLeg: wrong / n, rawMedian: median(rawErr), rawSnappedMedian: median(rawSnapErr), engineMedian: median(engErr), rawAlerts, engineAlerts: engAlerts, hours: s.seconds / 3600 };
}
const pointAlongRoute = pointAlong;

const HOUR: Omit<Scenario, 'sigma' | 'seed'> = { seconds: 3600, dropouts: [300, 1500, 2700], multipathRate: 0.005, treeBursts: [900, 2100, 3200] };

describe('GPS replay: walking 1.2 m/s, 1 Hz, one hour on a switchback + spur trail', () => {
  const rows: string[] = [];
  for (const sigma of [5, 15]) {
    it(`sigma ${sigma} m: engine beats raw, off-route alerts stay low`, () => {
      // Average several seeds so one lucky run cannot pass.
      const runs = [1, 2, 3].map((seed) => run({ ...HOUR, sigma, seed }));
      const sum = (k: keyof Metrics) => runs.reduce((a, r) => a + (r[k] as number), 0);
      const hours = sum('hours');
      const m = {
        raw: median(runs.map((r) => r.rawMedian)),
        rawSnapped: median(runs.map((r) => r.rawSnappedMedian)),
        engine: median(runs.map((r) => r.engineMedian)),
        rawAlerts: sum('rawAlerts') / hours,
        engAlerts: sum('engineAlerts') / hours,
        wrong: sum('wrongLeg') / runs.length,
      };
      rows.push(`sigma ${sigma} m | raw median ${m.raw.toFixed(1)} m | raw snapped (old Navigate) ${m.rawSnapped.toFixed(1)} m | engine ${m.engine.toFixed(1)} m | false off-route/h raw ${m.rawAlerts.toFixed(1)} -> engine ${m.engAlerts.toFixed(2)} | wrong-leg ${(m.wrong * 100).toFixed(1)}% of fixes`);
      console.log(`[replay] ${rows.at(-1)}`);
      expect(m.engine).toBeLessThan(m.rawSnapped);
      expect(m.engine).toBeLessThan(m.raw);
      expect(m.engAlerts).toBeLessThanOrEqual(1);
      expect(m.wrong).toBeLessThan(0.05);
      if (sigma === 15) expect(m.rawAlerts).toBeGreaterThan(m.engAlerts);
    });
  }

  it('correlated errors (rho 0.9): no worse than the old snap, reported, not better by design', () => {
    const runs = [1, 2, 3].map((seed) => run({ ...HOUR, sigma: 15, rho: 0.9, seed }));
    const eng = median(runs.map((r) => r.engineMedian)), raw = median(runs.map((r) => r.rawSnappedMedian));
    const alerts = runs.reduce((a, r) => a + r.engineAlerts, 0) / runs.reduce((a, r) => a + r.hours, 0);
    console.log(`[replay] sigma 15 m, rho 0.9 | raw snapped ${raw.toFixed(1)} m | engine ${eng.toFixed(1)} m | engine off-route/h ${alerts.toFixed(2)}`);
    expect(eng).toBeLessThan(raw * 1.1);
    expect(alerts).toBeLessThanOrEqual(4);
  });

  it('a real 200 m excursion is flagged within a few fixes of crossing the threshold', () => {
    for (const sigma of [5, 15]) {
      const exc = { from: 100, to: 100 + Math.ceil(200 / SPEED) };
      const samples = trace({ sigma, seconds: exc.to + 5, seed: 7, excursion: exc });
      const eng = new GpsEngine(stub, { route: { coords: ROUTE } });
      let flaggedAt: number | null = null;
      for (const smp of samples) {
        if (smp.fix) eng.ingest(smp.fix);
        if (flaggedAt == null && eng.state.offRoute) flaggedAt = smp.t;
      }
      const thr = Math.max(40, 1.5 * 1.5 * sigma);
      const crossedAt = exc.from + Math.ceil(thr / SPEED); // first fix truly beyond the threshold
      expect(flaggedAt).not.toBeNull();
      const lag = flaggedAt! - crossedAt;
      console.log(`[replay] excursion sigma ${sigma} m: flagged ${lag} fixes after crossing ${thr.toFixed(0)} m`);
      expect(lag).toBeGreaterThanOrEqual(0);
      expect(lag).toBeLessThanOrEqual(sigma === 5 ? 6 : 10);
    }
  });
});
