import { cumulative, projectOnLine, pointAt, LngLat } from '../geo';
import { Frame } from '../gps/frame';

export type OffSide = 'left' | 'right' | 'behind' | 'ahead';

const deg = (r: number) => ((r * 180) / Math.PI + 360) % 360;

/** Which way the trail lies from where you stand, relative to the way you are facing. */
export function offRouteSide(coords: LngLat[], pos: LngLat, headingDeg: number | null): { side: OffSide; distM: number; target: LngLat } {
  const cum = cumulative(coords);
  const p = projectOnLine(coords, cum, pos);
  const target = pointAt(coords, cum, p.along);
  const fr = new Frame(pos);
  const [tx, ty] = fr.toXY(target);
  // Facing: your heading, else the way the route runs at the nearest point.
  let facing = headingDeg;
  if (facing == null) {
    const [bx, by] = fr.toXY(pointAt(coords, cum, Math.max(0, p.along - 10)));
    const [ax, ay] = fr.toXY(pointAt(coords, cum, Math.min(cum.at(-1)!, p.along + 10)));
    facing = deg(Math.atan2(ax - bx, ay - by));
  }
  const rel = (deg(Math.atan2(tx, ty)) - facing + 540) % 360 - 180; // -180..180, positive = to your right
  const side: OffSide = Math.abs(rel) <= 45 ? 'ahead' : Math.abs(rel) >= 135 ? 'behind' : rel > 0 ? 'right' : 'left';
  return { side, distM: p.offset, target };
}

export const SIDE_STABLE_FIXES = 3;   // the same side this many fixes in a row before the words change
export const CLOSING_FIXES = 6;       // distance to the trail this many fixes ago...
export const CLOSING_M = 5;           // ...minus now, at least this much: the hiker is walking back to it

export type OffWords = { side: OffSide; distM: number; target: LngLat; closing: boolean; settled: boolean };

/**
 * Steadies what is said when off the trail. Feed one reading per fix (null when well on the trail: clears it).
 * The side only changes after the new one has held for SIDE_STABLE_FIXES fixes in a row; until the first one has,
 * `settled` is false and the raw side is shown but should not be spoken. `closing` is true while the distance is shrinking.
 */
export class OffRouteWords {
  private cand: OffSide | null = null;
  private n = 0;
  private side: OffSide | null = null;
  private dists: number[] = [];

  push(r: { side: OffSide; distM: number; target: LngLat } | null): OffWords | null {
    if (!r) { this.cand = null; this.n = 0; this.side = null; this.dists = []; return null; }
    this.n = r.side === this.cand ? this.n + 1 : 1;
    this.cand = r.side;
    if (this.n >= SIDE_STABLE_FIXES) this.side = r.side;
    this.dists.push(r.distM);
    if (this.dists.length > CLOSING_FIXES) this.dists.shift();
    const closing = this.dists.length >= CLOSING_FIXES && this.dists[0] - r.distM >= CLOSING_M;
    return { side: this.side ?? r.side, distM: r.distM, target: r.target, closing, settled: this.side != null };
  }
}
