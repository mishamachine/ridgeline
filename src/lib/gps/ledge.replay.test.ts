// Rattlesnake Ledge, replayed on real geometry. This is the gate: a change that makes the GPS worse, or stops the turn-back, fails the PR.
//
// Route: the trail exactly as the app stitches it from the hosted cell (fixtures/wa-cells.json holds the real relation 5588030 from cell 232_549).
// Walk: the CTO test pass simulation (fixtures/ledge-sim.json.gz, generator gen_ledge_sim.py in the Ridgeline project folder): 1 Hz, 1.4 h, walking 1.2 m/s,
// correlated noise sigma 8 to 15 m, a 40 s dropout, an 80 m multipath burst, a 150 m side excursion, 60 s rest at the end, then back down.
// Columns: t, lon, lat, accuracy, truth lon, truth lat, event ('' | dropout | multipath80 | excursion), phase (out | rest | back).
import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { cumulative, haversine, type LngLat } from '../geo';
import { cellsToTrails } from '../cells';
import { Announcer, type Utterance } from '../voice/announcer';
import { OffRouteWords, offRouteSide } from '../voice/offroute';
import { TurnBack } from '../voice/turnback';
import { GpsEngine } from './engine';
import type { LocationSource } from './source';

type Row = [number, number | null, number | null, number, number, number, string, string];
const rows = JSON.parse(gunzipSync(readFileSync(new URL('../fixtures/ledge-sim.json.gz', import.meta.url))).toString()) as Row[];
const cells = JSON.parse(readFileSync(new URL('../fixtures/wa-cells.json', import.meta.url), 'utf8')) as Record<string, Parameters<typeof cellsToTrails>[0]>;
const trail = cellsToTrails(cells.ledge).find((t) => t.id === 'osm-r5588030')!;
const route = trail.coords;
const total = cumulative(route).at(-1)!;
const T0 = 1_700_000_000_000;
const stub: LocationSource = { start() {}, stop() {}, restart() {} };
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

/** The same wiring as Navigate: engine -> side words -> announcer, and the turn-back detector on the stitched route. */
function replay() {
  const engine = new GpsEngine(stub, { route: { coords: route } });
  const announcer = new Announcer({ forks: [], turnarounds: [], total });
  const words = new OffRouteWords();
  const tb = new TurnBack(total, false);
  const err: number[] = [];
  const said: { t: number; u: Utterance }[] = [];
  const sides: string[] = [];
  const alerts: { t: number; ev: string }[] = [];
  let off = false, turnBackAt: number | null = null, maxAlong = 0, firstBackT: number | null = null;
  for (const [t, lon, lat, acc, tlon, tlat, ev, phase] of rows) {
    if (phase === 'back') firstBackT ??= t;
    if (lon == null || lat == null) { engine.tick(T0 + t * 1000); continue; }
    engine.ingest({ lon, lat, accuracy: acc, t: T0 + t * 1000 });
    const g = engine.state;
    if (ev !== 'excursion' && g.position) err.push(haversine(g.position, [tlon, tlat] as LngLat));
    if (g.offRoute && !off) alerts.push({ t, ev });
    off = g.offRoute;
    const w = words.push(g.filtered && (g.offRoute || (g.offsetM ?? 0) > 25) ? offRouteSide(route, g.filtered, g.heading) : null);
    if (g.offRoute && w) sides.push(w.side);
    for (const u of announcer.update({ t: T0 + t * 1000, along: g.along, offRoute: g.offRoute, holdOff: g.recalLastOffRoute, off: w?.settled && g.offRoute ? w : undefined, closing: g.offRoute ? w?.closing : false })) said.push({ t, u });
    if (g.along != null) {
      maxAlong = Math.max(maxAlong, g.along);
      if (turnBackAt == null && tb.update(g.along, g.offRoute)) turnBackAt = t;
    }
  }
  return { err, said, sides, alerts, turnBackAt, maxAlong, firstBackT };
}

describe('Rattlesnake Ledge replay on the stitched route', () => {
  const r = replay();

  it('the fixture is the route the app builds: the walk ends short of the mapped end, as in the test pass', () => {
    expect(route.length).toBe(163);
    expect(total).toBeGreaterThan(3000);
    expect(total - r.maxAlong).toBeGreaterThan(30); // this is why the old "within 30 m of the end" rule never fired
  });
  it('snapped position error: median under 8 m', () => {
    expect(median(r.err)).toBeLessThan(8);
  });
  it('no false off-route alerts in 1.4 h; the real excursion is flagged once', () => {
    expect(r.alerts.filter((a) => a.ev !== 'excursion')).toEqual([]);
    expect(r.alerts.filter((a) => a.ev === 'excursion').length).toBe(1);
  });
  it('turn-back fires on the way down (B-3), not before the walk reaches the end', () => {
    expect(r.turnBackAt).not.toBeNull();
    expect(r.turnBackAt!).toBeGreaterThan(rows.findIndex((x) => x[7] === 'rest'));
    expect(r.turnBackAt!).toBeLessThan(r.firstBackT! + 120); // within ~60 m of walking back
  });
  it('off-route words: the side settles and does not flap, and there is no reminder while walking back', () => {
    const flips = r.sides.filter((s, i) => i > 0 && s !== r.sides[i - 1]).length;
    expect(flips).toBeLessThanOrEqual(3);
    const off = r.said.filter((s) => s.u.kind === 'off-route');
    expect(off.length).toBeLessThanOrEqual(2);
    expect(r.said.filter((s) => s.u.kind === 'back-on').length).toBe(1);
  });
});
