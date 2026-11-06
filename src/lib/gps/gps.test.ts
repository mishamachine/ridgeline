import { describe, it, expect } from 'vitest';
import { Frame } from './frame';
import { PositionFilter } from './kalman';
import { RouteMatcher } from './matcher';
import { qualityOf, accuracyFt, isLocked } from './quality';
import { pickHeading, compassNeedsCalibration } from './compass';
import { GpsEngine, ANCHOR_MAX_MS } from './engine';
import { WebLocationSource, type Fix, type LocationSource } from './source';

const T0 = 1_700_000_000_000;
const fr = new Frame([-121.7, 47.5]);
const at = (x: number, y: number, t: number, accuracy = 8): Fix => { const p = fr.toLngLat(x, y); return { lon: p[0], lat: p[1], accuracy, t: T0 + t * 1000 }; };
const line = [fr.toLngLat(0, 0), fr.toLngLat(500, 0)];

describe('kalman', () => {
  it('drops poor accuracy and impossible jumps, keeps last good position', () => {
    const k = new PositionFilter();
    expect(k.update(at(0, 0, 0)).accepted).toBe(true);
    expect(k.update(at(1, 0, 1, 80))).toEqual({ accepted: false, reason: 'accuracy' });
    expect(k.update(at(2, 0, 2)).accepted).toBe(true);
    expect(k.update(at(150, 0, 3, 5))).toEqual({ accepted: false, reason: 'jump' });
    const p = fr.toXY(k.position()!);
    expect(p[0]).toBeLessThan(5);
  });
  it('re-locks after several consistent far fixes', () => {
    const k = new PositionFilter();
    k.update(at(0, 0, 0));
    for (let t = 1; t <= 6; t++) k.update(at(400, 0, t, 5));
    expect(fr.toXY(k.position()!)[0]).toBeGreaterThan(390);
  });
  it('allows a bigger step when the GPS reports a matching speed', () => {
    const k = new PositionFilter();
    k.update(at(0, 0, 0));
    expect(k.update({ ...at(10, 0, 1, 5), speed: 8 }).accepted).toBe(true);
  });
  it('grows the uncertainty radius during a dropout', () => {
    const k = new PositionFilter();
    k.update(at(0, 0, 0)); k.update(at(1, 0, 1));
    expect(k.radius(T0 + 31_000)).toBeGreaterThan(k.radius(T0 + 2000) + 25);
  });
});

describe('matcher', () => {
  it('snaps within max(accuracy, 25 m) and not beyond', () => {
    const m = new RouteMatcher(line);
    const a = m.match(fr.toLngLat(100, 20), 10, T0);
    expect(a.matched).toBe(true);
    expect(a.along).toBeCloseTo(100, 0);
    expect(m.match(fr.toLngLat(110, 30), 10, T0 + 1000).matched).toBe(false);
  });
  it('flags off-route only after 4 fixes and clears after 2', () => {
    const m = new RouteMatcher(line);
    const res = [0, 1, 2, 3].map((i) => m.match(fr.toLngLat(100, 60), 10, T0 + i * 1000).offRoute);
    expect(res).toEqual([false, false, false, true]);
    expect(m.match(fr.toLngLat(105, 0), 10, T0 + 4000).offRoute).toBe(true);
    expect(m.match(fr.toLngLat(106, 0), 10, T0 + 5000).offRoute).toBe(false);
  });
  it('does not hop to a parallel leg 20 m away on one noisy fix', () => {
    const route = [fr.toLngLat(0, 0), fr.toLngLat(300, 0), fr.toLngLat(300, 20), fr.toLngLat(0, 20)];
    const m = new RouteMatcher(route);
    for (let i = 0; i < 10; i++) m.match(fr.toLngLat(50 + i, 1), 10, T0 + i * 1000);
    const r = m.match(fr.toLngLat(60, 17), 10, T0 + 10_000);
    expect(r.along).toBeLessThan(100);
  });
});

describe('quality and compass', () => {
  it('bands the chip and goes weak when stale', () => {
    expect(qualityOf(8, 1000)).toBe('good');
    expect(qualityOf(20, 1000)).toBe('fair');
    expect(qualityOf(30, 1000)).toBe('weak');
    expect(qualityOf(5, 11_000)).toBe('weak');
    expect(qualityOf(null, 0)).toBeNull();
    expect(accuracyFt(10)).toBe(33);
    expect(isLocked(30)).toBe(true);
    expect(isLocked(31)).toBe(false);
  });
  it('uses GPS course when moving, compass when still', () => {
    expect(pickHeading(1.2, 90, { degrees: 10, accuracy: 5 })?.source).toBe('gps');
    expect(pickHeading(0.3, 90, { degrees: 10, accuracy: 5 })).toEqual({ degrees: 10, source: 'compass', needsCalibration: false });
    expect(pickHeading(0, null, null)).toBeNull();
    expect(compassNeedsCalibration(30)).toBe(true);
    expect(compassNeedsCalibration(null)).toBe(true);
    expect(compassNeedsCalibration(-1)).toBe(true);
  });
});

describe('web source', () => {
  it('watches with high accuracy and no cache, and restarts', () => {
    const calls: PositionOptions[] = [];
    let cleared = 0;
    const geo = { watchPosition: (_: unknown, __: unknown, o: PositionOptions) => (calls.push(o), calls.length), clearWatch: () => { cleared++; } } as unknown as Geolocation;
    const s = new WebLocationSource(geo);
    s.start(() => {}, () => {});
    s.restart();
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 });
    expect(cleared).toBe(1);
  });
  it('reports unsupported without a geolocation API', () => {
    const errs: string[] = [];
    new WebLocationSource(undefined).start(() => {}, (e) => errs.push(e.code));
    expect(errs).toEqual(['unsupported']);
  });
});

describe('engine', () => {
  const mk = () => {
    let restarts = 0;
    const src: LocationSource = { start() {}, stop() {}, restart() { restarts++; } };
    const accepted: Fix[] = [];
    const e = new GpsEngine(src, { route: { coords: line, elevation: [100, 200] }, onAccepted: (f) => accepted.push(f), now: () => T0 });
    return { e, accepted, restarts: () => restarts };
  };

  it('is warming up until a fix at or under 30 m, then reports state, DEM and progress', () => {
    const { e } = mk();
    expect(e.state.warmingUp).toBe(true);
    e.ingest(at(0, 0, 0, 40));
    expect(e.state.warmingUp).toBe(true);
    e.ingest(at(100, 3, 1, 12));
    expect(e.state.warmingUp).toBe(false);
    for (let t = 2; t < 6; t++) e.ingest(at(100 + t, 3, t, 8));
    expect(e.state.matched).toBe(true);
    expect(e.state.quality).toBe('good');
    expect(e.state.progress).toBeCloseTo(0.2, 1);
    expect(e.state.altitudeM).toBeCloseTo(120, -1);
    expect(e.state.accuracyFt).toBe(26);
  });

  it('records only accepted raw fixes', () => {
    const { e, accepted } = mk();
    e.ingest(at(0, 0, 0)); e.ingest(at(1, 0, 1, 90));
    expect(accepted).toHaveLength(1);
  });

  it('recalibrate restarts the source, resets and ignores stale fixes', () => {
    const { e, restarts } = mk();
    e.ingest(at(10, 0, 0));
    e.recalibrate();
    expect(restarts()).toBe(1);
    expect(e.state.hasFix).toBe(false);
    expect(e.state.recalibrating).toBe(true);
    e.ingest(at(10, 0, -30)); // older than the recalibrate time (T0)
    expect(e.state.hasFix).toBe(false);
    e.ingest(at(12, 0, 1));
    expect(e.state.hasFix).toBe(true);
    expect(e.state.recalibrating).toBe(false);
  });

  it('manual anchor: refuses taps outside the circle, snaps inside, then releases on a good agreeing fix', () => {
    const { e } = mk();
    expect(e.manualAnchor(fr.toLngLat(0, 0)).ok).toBe(false); // no fix yet
    for (let t = 0; t < 5; t++) e.ingest(at(200, 12, t, 20));
    const far = e.manualAnchor(fr.toLngLat(300, 0));
    expect(far.ok).toBe(false);
    const ok = e.manualAnchor(fr.toLngLat(205, 0));
    expect(ok.ok).toBe(true);
    expect(e.state.anchored).toBe(true);
    expect(e.state.along).toBeCloseTo(205, 0);
    e.ingest(at(207, 3, 6, 10)); // good again but not <=15 m of agreement? it is: released
    expect(e.state.anchored).toBe(false);
  });

  it('manual anchor expires after 2 minutes', () => {
    const { e } = mk();
    for (let t = 0; t < 5; t++) e.ingest(at(200, 12, t, 20));
    e.manualAnchor(fr.toLngLat(205, 0));
    e.tick(T0 + 4000 + ANCHOR_MAX_MS - 1000);
    expect(e.state.anchored).toBe(true);
    e.tick(T0 + 4000 + ANCHOR_MAX_MS + 1000);
    expect(e.state.anchored).toBe(false);
  });

  it('goes weak and grows the circle with no fixes, and keeps the last position', () => {
    const { e } = mk();
    for (let t = 0; t < 5; t++) e.ingest(at(50, 0, t, 6));
    const r0 = e.state.uncertaintyM!, p0 = e.state.position;
    e.tick(T0 + 30_000);
    expect(e.state.quality).toBe('weak');
    expect(e.state.uncertaintyM!).toBeGreaterThan(r0 + 15);
    expect(e.state.position).toEqual(p0);
  });

  it('works with no route and no fix', () => {
    const e = new GpsEngine({ start() {}, stop() {}, restart() {} });
    expect(e.state.hasFix).toBe(false);
    e.ingest(at(0, 0, 0));
    expect(e.state.position).not.toBeNull();
    expect(e.state.matched).toBe(false);
  });
});
