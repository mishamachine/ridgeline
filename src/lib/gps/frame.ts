import type { LngLat } from '../geo';

const R = 6371008.8;
const D = Math.PI / 180;

/** Local east/north metres around an origin (flat Earth; fine at trail scale). */
export class Frame {
  private kx: number;
  private ky = D * R;
  constructor(readonly origin: LngLat) {
    this.kx = Math.cos(origin[1] * D) * D * R;
  }
  toXY(p: LngLat): [number, number] {
    return [(p[0] - this.origin[0]) * this.kx, (p[1] - this.origin[1]) * this.ky];
  }
  toLngLat(x: number, y: number): LngLat {
    return [this.origin[0] + x / this.kx, this.origin[1] + y / this.ky];
  }
}
