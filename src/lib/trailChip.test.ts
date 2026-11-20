import { describe, expect, it } from 'vitest';
import { cumulative, pointAt, type LngLat } from './geo';
import { Frame } from './gps/frame';
import { GpsEngine } from './gps/engine';
import type { LocationSource } from './gps/source';
import { shortDistance } from './voice/units';
import { trailChip } from './trailChip';

const fr = new Frame([-121.7, 47.5]);
const stub: LocationSource = { start() {}, stop() {}, restart() {} };
const T0 = 1_700_000_000_000;
const route = (xy: [number, number][]) => { const coords: LngLat[] = xy.map(([x, y]) => fr.toLngLat(x, y)); return { coords, cum: cumulative(coords) }; };

/** Walks the route at 1.2 m/s with no noise and hands back the engine state and chip at each distance asked for. */
function walk(r: { coords: LngLat[]; cum: number[] }, at: number[], sideM = 0) {
  const eng = new GpsEngine(stub, { route: { coords: r.coords } });
  const total = r.cum.at(-1)!;
  const out: { d: number; along: number | null; chip: ReturnType<typeof trailChip>; toGo: string }[] = [];
  for (let t = 0; 1.2 * t <= Math.max(...at) + 1; t++) {
    const d = Math.min(total, 1.2 * t);
    const [x, y] = fr.toXY(pointAt(r.coords, r.cum, d));
    const p = fr.toLngLat(x, y + sideM);
    eng.ingest({ lon: p[0], lat: p[1], accuracy: 5, t: T0 + t * 1000 });
    if (at.some((a) => Math.abs(a - d) < 0.7)) {
      const s = eng.state;
      out.push({ d, along: s.along, chip: trailChip(s, total, 'imperial'), toGo: shortDistance(s.along != null ? total - s.along : total, 'imperial') });
    }
  }
  return out;
}

describe('Navigate chip', () => {
  it('shows nothing before the trail is reached', () => {
    expect(trailChip({ along: null, offRoute: false, offsetM: null }, 5000, 'imperial')).toBeNull();
  });
  it('says the distance left, in the app units', () => {
    expect(trailChip({ along: 1000, offRoute: false, offsetM: 3 }, 5000, 'imperial')).toEqual({ off: false, text: `${shortDistance(4000, 'imperial')} left` });
    expect(trailChip({ along: 1000, offRoute: false, offsetM: 3 }, 5000, 'metric')!.text).toBe('4.0 km left');
  });
  it('says "Off the trail" with the engine distance once off route', () => {
    const c = trailChip({ along: 1000, offRoute: true, offsetM: 120 }, 5000, 'metric')!;
    expect(c.off).toBe(true);
    expect(c.text).toBe('Off the trail · 120 m away · 4.0 km left');
  });
  it('matches the sheet\'s "to go" on a lollipop, outbound and on the return stem', () => {
    // stem 400 m east, a 600 m loop, then the same stem back
    const stem: [number, number][] = [[0, 0], [400, 0]];
    const loop: [number, number][] = [[400, 0], [400, 150], [550, 150], [550, 0], [400, 0]];
    const r = route([...stem, ...loop.slice(1), [0, 0]]);
    const total = r.cum.at(-1)!;
    const rows = walk(r, [200, 700, total - 250, total - 100]);
    for (const row of rows) {
      expect(row.chip, `at ${row.d.toFixed(0)} m`).not.toBeNull();
      expect(row.chip!.off).toBe(false);
      expect(row.chip!.text).toBe(`${row.toGo} left`);
    }
    const back = rows.at(-1)!; // on the return stem the chip counts down to the trailhead
    expect(back.along!).toBeGreaterThan(total - 200);
  });
  it('counts down to zero at the finish of a loop and is not off the trail', () => {
    const r = route([[0, 0], [300, 0], [300, 200], [0, 200], [0, 0]]);
    const total = r.cum.at(-1)!;
    const rows = walk(r, [100, total - 30, total]);
    for (const row of rows) { expect(row.chip!.off).toBe(false); expect(row.chip!.text).toBe(`${row.toGo} left`); }
    expect(rows.at(-1)!.chip!.text).toMatch(/^(0|[1-9]\d?) ft left$/);
  });
  it('warns once you are well off the route (engine off-route)', () => {
    const r = route([[0, 0], [600, 0]]);
    const eng = new GpsEngine(stub, { route: { coords: r.coords } });
    for (let t = 0; t < 120; t++) { const [x, y] = fr.toXY(pointAt(r.coords, r.cum, Math.min(1.2 * t, 150))); const p = fr.toLngLat(x, y); eng.ingest({ lon: p[0], lat: p[1], accuracy: 5, t: T0 + t * 1000 }); }
    for (let t = 120; t < 200; t++) { const p = fr.toLngLat(150, (t - 120) * 1.2); eng.ingest({ lon: p[0], lat: p[1], accuracy: 5, t: T0 + t * 1000 }); }
    const chip = trailChip(eng.state, r.cum.at(-1)!, 'imperial')!;
    expect(chip.off).toBe(true);
    expect(chip.text).toMatch(/^Off the trail · /);
  });
});
