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
