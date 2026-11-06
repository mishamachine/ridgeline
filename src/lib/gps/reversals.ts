import { cumulative, pointAt, LngLat } from '../geo';

const LOOK_M = 20;        // compare the way in and the way out over this distance
const TURN_DEG = 150;     // sharper than this is a reversal
const MERGE_M = 40;       // one tip, even if its vertices are noisy

const bearing = (a: LngLat, b: LngLat) => Math.atan2((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), b[1] - a[1]);

/** Distances along the route (m) where it doubles back on itself: the tip of an out-and-back spur. */
export function findReversals(coords: LngLat[], cum: number[] = cumulative(coords)): number[] {
  const total = cum.at(-1) ?? 0;
  const found: { along: number; turn: number }[] = [];
  for (let i = 1; i < coords.length - 1; i++) {
    const d = cum[i];
    if (d < LOOK_M || d > total - LOOK_M) continue;
    const before = pointAt(coords, cum, d - LOOK_M), after = pointAt(coords, cum, d + LOOK_M);
    let turn = Math.abs(bearing(before, coords[i]) - bearing(coords[i], after)) * (180 / Math.PI);
    if (turn > 180) turn = 360 - turn;
    if (turn >= TURN_DEG) found.push({ along: d, turn });
  }
  const out: { along: number; turn: number }[] = [];
  for (const f of found) {
    const last = out.at(-1);
    if (last && f.along - last.along < MERGE_M) { if (f.turn > last.turn) out[out.length - 1] = f; }
    else out.push(f);
  }
  return out.map((o) => o.along);
}
