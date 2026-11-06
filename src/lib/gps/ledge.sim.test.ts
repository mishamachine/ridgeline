import { describe, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { haversine, LngLat, projectOnLine, cumulative } from '../geo';
import { GpsEngine } from './engine';
import { TurnBack } from '../voice/turnback';
import type { LocationSource } from './source';

const A = '/Users/misha/bb-project-factory/projects/ridgeline/test-pass-assets/';
const ok = existsSync(A + 'ledge-route.json');
const route = (ok ? JSON.parse(readFileSync(A + 'ledge-route.json', 'utf8')) : []) as LngLat[];
const S = (ok ? JSON.parse(readFileSync(A + 'ledge-sim-samples.json', 'utf8')) : []) as [number, number | null, number | null, number, number, number, number, string, string][];
const CUM = cumulative(route);
const stub: LocationSource = { start() {}, stop() {}, restart() {} };
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

describe.skipIf(!existsSync(A + 'ledge-route.json'))('Ledge replay (real geometry; fixtures from the CTO test pass, Drive/projects/ridgeline/test-pass-assets)', () => {
  it('reports metrics', () => {
    const e = new GpsEngine(stub, { route: { coords: route } });
    const T0 = 1_700_000_000_000;
    const err: number[] = [], rawErr: number[] = [], alerts: { t: number; ev: string }[] = [], clears: number[] = [];
    let off = false, firstExc: number | null = null, lastExc = 0, flagged: number | null = null, falseAlerts = 0, finishAlong = 0;
    const log: string[] = [];
    const tb = new TurnBack(CUM.at(-1)!, false); let tbAt: number | null = null; let maxAlong = 0, endHits = 0;
    for (const s of S) {
      const [t, lo, la, acc, tlo, tla, d, ev] = s;
      if (lo == null || la == null) { e.tick(T0 + t * 1000); continue; }
      e.ingest({ lon: lo, lat: la, accuracy: acc, t: T0 + t * 1000 });
      const st = e.state;
      const truth: LngLat = [tlo, tla];
      if (ev !== 'excursion') err.push(haversine(st.position!, truth));
      rawErr.push(haversine([lo, la], truth));
      if (t>=1790&&t<=1930&&t%5==0) console.log('[DBG]',t,ev,'off',st.offRoute,'offsetM',st.offsetM?.toFixed(0),'along',st.along?.toFixed(0),'truthd',d,'pos-truth',haversine(st.position!,truth).toFixed(0),'acc',acc,'TRUE-min-dist-to-trail',projectOnLine(route,CUM,truth).offset.toFixed(0));
      if (ev === 'excursion') { firstExc ??= t; lastExc = t; }
      if (st.offRoute && !off) {
        alerts.push({ t, ev });
        if (ev !== 'excursion') falseAlerts++; else if (flagged == null) flagged = t;
        log.push(`off-route at t=${t}s ev=${ev} trueOffset~`);
      }
      if (!st.offRoute && off) clears.push(t);
      off = st.offRoute;
      finishAlong = st.progress ?? 0;
      if (st.along != null) { maxAlong = Math.max(maxAlong, st.along); if (st.along >= CUM.at(-1)! - 30) endHits++; if (tbAt == null && tb.update(st.along, st.offRoute)) tbAt = t; }
    }
    const hours = S.length / 3600;
    console.log('[LEDGE] n=' + S.length + ' hours=' + hours.toFixed(2));
    console.log('[LEDGE] median snapped error (engine position vs truth, excl excursion) m =', med(err).toFixed(1), ' raw median =', med(rawErr).toFixed(1));
    console.log('[LEDGE] p90 engine err', [...err].sort((a, b) => a - b)[Math.floor(err.length * 0.9)].toFixed(1));
    console.log('[LEDGE] alerts', JSON.stringify(alerts), 'clears', JSON.stringify(clears));
    console.log('[LEDGE] excursion window', firstExc, lastExc, 'flagged at', flagged, 'lag s', flagged == null ? null : flagged - (firstExc as number));
    console.log('[LEDGE] false alerts', falseAlerts, '=> per hour', (falseAlerts / hours).toFixed(2));
    console.log('[LEDGE] final progress', finishAlong, 'route m', CUM.at(-1)!.toFixed(0), 'engine max along', maxAlong.toFixed(0), 'fixes within 30 m of end', endHits, 'TurnBack fires at t=', tbAt);
  });
});
